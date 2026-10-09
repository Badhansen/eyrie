/**
 * Rust language adapter.
 *
 * Records `use` trees (as `crate::a::b` sources), `mod x;` child modules,
 * structs / enums / traits, `impl` blocks (methods attach to their type,
 * trait impls become `implements`), call references (`self` becomes
 * `this`, `Type::new()` a construction), axum / actix / rocket routes,
 * and diesel / sea-orm / sqlx models.
 */
import type { Node } from 'web-tree-sitter';
import type { ArgFact, FieldFact, ImportFact, SymbolFact, SymbolKind } from '@eyrie/core';
import { BaseExtractor, cleanComment, joinRoute, line } from './base.js';

const MAX_CHAIN = 6;
const ROUTE_ATTRS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
const WRAPPERS = new Set(['Arc', 'Rc', 'Box', 'Option', 'RefCell', 'Mutex', 'RwLock', 'Cow', 'Data', 'State', 'Extension']);
const MODEL_DERIVES = /\b(Queryable|Insertable|Identifiable|Selectable|AsChangeset|DeriveEntityModel|FromRow)\b/;
const CONSTRUCTORS = /^(new|default|builder|create|from|with_\w+|open|connect)$/;

const pascal = (s: string) => s.split(/[_-]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');

function stringValue(n: Node | null | undefined): string | null {
  if (!n) return null;
  if (n.type === 'string_literal' || n.type === 'raw_string_literal') {
    const content = n.namedChildren.filter((c) => c?.type === 'string_content' || c?.type === 'escape_sequence');
    return content.map((c) => c!.text).join('');
  }
  return null;
}

function literal(n: Node): ArgFact {
  const inner = n.type === 'reference_expression' ? n.childForFieldName('value') : n;
  return stringValue(inner);
}

/** `&Arc<OrderRepo>` → 'OrderRepo', `openai::Client` → 'openai.Client'. */
function typeRoot(n: Node | null | undefined): string | undefined {
  if (!n) return undefined;
  switch (n.type) {
    case 'type_identifier':
    case 'identifier':
      return n.text;
    case 'scoped_type_identifier':
    case 'scoped_identifier':
      return n.text.replace(/::/g, '.');
    case 'reference_type':
    case 'pointer_type':
      return typeRoot(n.childForFieldName('type'));
    case 'generic_type': {
      const base = n.childForFieldName('type');
      const name = base?.text.split('::').pop();
      if (name && WRAPPERS.has(name)) return typeRoot(n.childForFieldName('type_arguments')?.namedChildren[0]);
      return typeRoot(base);
    }
    case 'dynamic_type':
    case 'abstract_type':
      return typeRoot(n.childForFieldName('trait'));
    default:
      return undefined;
  }
}

const isPub = (n: Node) => n.namedChildren.some((c) => c?.type === 'visibility_modifier');

export class RustExtractor extends BaseExtractor {
  /** Type whose `impl` block is being walked (for `Self`). */
  private selfType: string | null = null;

  protected visitRoot(root: Node): void {
    this.items(root.namedChildren);
  }

  private items(nodes: (Node | null)[]): void {
    for (const child of nodes) {
      if (!child) continue;
      switch (child.type) {
        case 'use_declaration': {
          const arg = child.childForFieldName('argument');
          if (arg) this.useTree(arg, [], child);
          break;
        }
        case 'mod_item':
          this.modItem(child);
          break;
        case 'struct_item':
        case 'enum_item':
        case 'union_item':
          this.typeItem(child, child.type === 'enum_item' ? 'enum' : 'class');
          break;
        case 'trait_item':
          this.traitItem(child);
          break;
        case 'type_item':
          this.typeItem(child, 'type');
          break;
        case 'impl_item':
          this.implItem(child);
          break;
        case 'function_item':
          this.func(child, undefined);
          break;
        case 'const_item':
        case 'static_item':
          this.constItem(child);
          break;
        case 'line_comment':
        case 'block_comment':
        case 'attribute_item':
        case 'inner_attribute_item':
          break;
        default:
          this.walk(child);
      }
    }
  }

  // ── use / mod ────────────────────────────────────────────────────────────

  private useTree(node: Node, prefix: string[], decl: Node): void {
    const push = (path: string[], imported: string, local: string) => {
      const imp: ImportFact = { source: path.join('::'), line: line(decl), typeOnly: false, specifiers: [{ imported, local }] };
      this.facts.imports.push(imp);
    };
    switch (node.type) {
      case 'identifier':
      case 'crate':
      case 'super':
      case 'self': {
        const name = node.text;
        if (name === 'self' && prefix.length) push(prefix, '*', prefix[prefix.length - 1]!);
        else if (prefix.length) push(prefix, name, name);
        else push([name], '*', name);
        return;
      }
      case 'scoped_identifier': {
        const parts = node.text.split('::');
        const name = parts.pop()!;
        const path = [...prefix, ...parts];
        if (name === 'self') push(path, '*', path[path.length - 1]!);
        else push(path, name, name);
        return;
      }
      case 'use_as_clause': {
        const path = node.childForFieldName('path');
        const alias = node.childForFieldName('alias')?.text;
        if (!path || !alias) return;
        const parts = [...prefix, ...path.text.split('::')];
        const name = parts.pop()!;
        if (parts.length) push(parts, name === 'self' ? '*' : name, alias);
        else push([name], '*', alias);
        return;
      }
      case 'scoped_use_list': {
        const path = node.childForFieldName('path');
        const list = node.childForFieldName('list');
        const next = path ? [...prefix, ...path.text.split('::')] : prefix;
        for (const c of list?.namedChildren ?? []) if (c) this.useTree(c, next, decl);
        return;
      }
      case 'use_list':
        for (const c of node.namedChildren) if (c) this.useTree(c, prefix, decl);
        return;
      case 'use_wildcard': {
        const inner = node.namedChildren[0];
        const path = [...prefix, ...(inner ? inner.text.split('::') : [])];
        this.facts.imports.push({ source: path.join('::'), line: line(decl), typeOnly: false, specifiers: [], wildcard: true });
        return;
      }
    }
  }

  private modItem(node: Node): void {
    const name = node.childForFieldName('name')?.text;
    if (!name) return;
    const body = node.childForFieldName('body');
    if (!body) {
      // `mod handlers;` pulls in handlers.rs / handlers/mod.rs.
      this.facts.imports.push({ source: `self::${name}`, line: line(node), typeOnly: false, specifiers: [{ imported: '*', local: name }] });
      return;
    }
    const attrs = this.attributes(node);
    if (name === 'tests' || attrs.some((a) => /cfg\(test\)/.test(a.text))) return;
    this.items(body.namedChildren);
  }

  // ── declarations ─────────────────────────────────────────────────────────

  /** Attributes and doc comments directly above an item. */
  private attributes(node: Node): Node[] {
    const out: Node[] = [];
    for (let p = node.previousSibling; p && (p.type === 'attribute_item' || p.type === 'line_comment' || p.type === 'block_comment'); p = p.previousSibling) {
      if (p.type === 'attribute_item') out.push(p);
    }
    return out;
  }

  private doc(node: Node): string | undefined {
    const lines: string[] = [];
    let expect = node.startPosition.row;
    for (let p = node.previousSibling; p; p = p.previousSibling) {
      if (p.endPosition.row < expect - 1) break;
      if (p.type === 'attribute_item') {
        expect = p.startPosition.row;
        continue;
      }
      if ((p.type === 'line_comment' || p.type === 'block_comment') && /^(\/\/\/|\/\*\*)/.test(p.text)) {
        lines.unshift(p.text.trimEnd());
        expect = p.startPosition.row;
        continue;
      }
      break;
    }
    return lines.length ? cleanComment(lines.join('\n')) : undefined;
  }

  private typeItem(node: Node, kind: SymbolKind): void {
    const name = node.childForFieldName('name')?.text;
    if (!name) return;
    const sym = this.symbol(name, kind, node, isPub(node));
    const doc = this.doc(node);
    if (doc) sym.doc = doc;
    const fields: FieldFact[] = [];
    for (const fd of node.childForFieldName('body')?.namedChildren ?? []) {
      if (fd?.type !== 'field_declaration') continue;
      const fname = fd.childForFieldName('name')?.text;
      const t = typeRoot(fd.childForFieldName('type'));
      if (fname) fields.push(t ? { name: fname, type: t } : { name: fname });
    }
    if (kind === 'class') sym.fields = fields;
    this.addSymbol(sym);
    const derive = this.attributes(node).map((a) => a.text).join(' ');
    if (kind === 'class' && MODEL_DERIVES.test(derive)) {
      const orm = /DeriveEntityModel/.test(derive) ? 'sea-orm' : /FromRow/.test(derive) ? 'sqlx' : 'diesel';
      // sea-orm entities are all called `Model`; name them after their file.
      const stem = this.facts.path.split('/').pop()!.replace(/\.rs$/, '');
      const modelName = name === 'Model' && stem !== 'mod' ? pascal(stem) : name;
      const relations = fields.map((f) => f.type).filter((t): t is string => !!t && /^[A-Z]/.test(t) && t !== name && !t.includes('.'));
      (this.facts.models ??= []).push({ name: modelName, line: sym.startLine, endLine: sym.endLine, fields: fields.map((f) => f.name), relations: [...new Set(relations)], orm, symbol: sym.qualifiedName });
    }
  }

  private traitItem(node: Node): void {
    const name = node.childForFieldName('name')?.text;
    if (!name) return;
    const sym = this.symbol(name, 'interface', node, isPub(node));
    const doc = this.doc(node);
    if (doc) sym.doc = doc;
    this.addSymbol(sym);
    for (const m of node.childForFieldName('body')?.namedChildren ?? []) {
      if (m?.type === 'function_signature_item') {
        const mname = m.childForFieldName('name')?.text;
        if (mname) this.addSymbol(this.symbol(mname, 'method', m, true, name));
      } else if (m?.type === 'function_item') this.func(m, name);
    }
  }

  private implItem(node: Node): void {
    const owner = typeRoot(node.childForFieldName('type'));
    if (!owner) return;
    const trait = typeRoot(node.childForFieldName('trait'));
    const ownerSym = this.symbolsByName.get(owner);
    if (trait && ownerSym) {
      const impl = (ownerSym.implements ??= []);
      if (!impl.includes(trait)) impl.push(trait);
    }
    const prev = this.selfType;
    this.selfType = owner;
    for (const m of node.childForFieldName('body')?.namedChildren ?? []) {
      if (m?.type === 'function_item') this.func(m, owner);
    }
    this.selfType = prev;
  }

  private func(node: Node, owner: string | undefined): void {
    const name = node.childForFieldName('name')?.text;
    if (!name) return;
    const sym = this.symbol(name, owner ? 'method' : 'function', node, isPub(node) || !!owner, owner);
    if (node.namedChildren.some((c) => c?.type === 'function_modifiers' && /async/.test(c.text))) sym.async = true;
    const doc = this.doc(node);
    if (doc) sym.doc = doc;
    sym.locals = {};
    this.addSymbol(sym);
    for (const p of node.childForFieldName('parameters')?.namedChildren ?? []) {
      if (p?.type !== 'parameter') continue;
      const pat = p.childForFieldName('pattern');
      const t = typeRoot(p.childForFieldName('type'));
      if (pat?.type === 'identifier' && t) sym.locals[pat.text] = t;
    }
    if (!owner) this.attrRoutes(node, sym);
    const body = node.childForFieldName('body');
    if (body) this.withScope({ name: sym.qualifiedName, locals: sym.locals }, () => this.walk(body));
  }

  private constItem(node: Node): void {
    const name = node.childForFieldName('name')?.text;
    if (!name) return;
    const sym = this.symbol(name, 'variable', node, isPub(node));
    const t = typeRoot(node.childForFieldName('type'));
    if (t) sym.typeName = t;
    this.addSymbol(sym);
    const v = node.childForFieldName('value');
    if (v) this.withScope({ name }, () => this.walk(v));
  }

  /** actix-web / rocket: `#[get("/orders/{id}")]`. */
  private attrRoutes(node: Node, sym: SymbolFact): void {
    for (const a of this.attributes(node)) {
      const attr = a.namedChildren[0];
      const name = attr?.namedChildren[0]?.text ?? '';
      const args = attr?.childForFieldName('arguments');
      const path = stringValue(args?.namedChildren.find((c) => c?.type === 'string_literal'));
      if (path === null) continue;
      let method: string | undefined;
      if (ROUTE_ATTRS.has(name)) method = name.toUpperCase();
      else if (name === 'route') method = /method\s*=\s*"(\w+)"/.exec(args?.text ?? '')?.[1]?.toUpperCase() ?? 'ANY';
      if (method) this.addRoute({ method, path: joinRoute(undefined, path), line: line(a), router: 'attr', handlers: [sym.qualifiedName], framework: 'rust' });
    }
  }

  // ── references ───────────────────────────────────────────────────────────

  private chain(node: Node | null | undefined): string[] | null {
    if (!node) return null;
    switch (node.type) {
      case 'identifier':
      case 'field_identifier':
      case 'type_identifier':
        return [node.text === 'Self' && this.selfType ? this.selfType : node.text];
      case 'self':
        return ['this'];
      case 'scoped_identifier':
      case 'scoped_type_identifier': {
        // `super::f()` names a sibling module we cannot see from here.
        if (node.text.startsWith('super::')) return null;
        const parts = node.text.split('::').filter((p) => p !== 'crate' && p !== 'self');
        if (parts[0] === 'Self' && this.selfType) parts[0] = this.selfType;
        return parts.length && parts.length <= MAX_CHAIN ? parts : null;
      }
      case 'field_expression': {
        const obj = this.chain(node.childForFieldName('value'));
        const field = node.childForFieldName('field');
        if (!obj || !field || obj.length >= MAX_CHAIN) return null;
        return [...obj, field.text];
      }
      case 'call_expression': {
        const inner = this.chain(node.childForFieldName('function'));
        if (!inner) return null;
        return [...inner.slice(0, -1), `${inner[inner.length - 1]}()`];
      }
      case 'generic_function':
        return this.chain(node.childForFieldName('function'));
      case 'index_expression': {
        const obj = this.chain(node.namedChildren[0]);
        return obj ? [...obj, '[]'] : null;
      }
      case 'await_expression':
      case 'try_expression':
      case 'parenthesized_expression':
      case 'reference_expression':
        return this.chain(node.childForFieldName('value') ?? node.namedChildren[0]);
      default:
        return null;
    }
  }

  private walk(node: Node): void {
    switch (node.type) {
      case 'line_comment':
      case 'block_comment':
      case 'string_literal':
      case 'raw_string_literal':
      case 'integer_literal':
      case 'attribute_item':
      case 'macro_invocation':
        return;
      case 'call_expression':
        return this.call(node);
      case 'struct_expression': {
        const t = this.chain(node.childForFieldName('name'));
        if (t && /^[A-Z]/.test(t[t.length - 1]!)) this.addRef('new', t, node);
        const body = node.childForFieldName('body');
        if (body) this.walk(body);
        return;
      }
      case 'let_declaration':
        return this.letDecl(node);
      case 'closure_expression': {
        const body = node.childForFieldName('body');
        if (body) this.walk(body);
        return;
      }
      case 'function_item':
      case 'impl_item':
      case 'mod_item':
        return;
    }
    for (const c of node.namedChildren) if (c) this.walk(c);
  }

  private letDecl(node: Node): void {
    const pat = node.childForFieldName('pattern');
    const value = node.childForFieldName('value');
    const locals = this.scope().locals;
    if (pat?.type === 'identifier' && locals) {
      const t = typeRoot(node.childForFieldName('type'));
      const inst = value ? this.instanceType(value) : undefined;
      if (t) locals[pat.text] = t;
      else if (inst) locals[pat.text] = inst;
      else if (value) {
        const call = this.unwrapCall(value);
        const c = call && this.chain(call.childForFieldName('function'));
        if (c) locals[pat.text] = `call:${c.join('.')}`;
      }
    }
    if (value) this.walk(value);
  }

  private unwrapCall(v: Node): Node | null {
    let cur: Node | null = v;
    while (cur && (cur.type === 'await_expression' || cur.type === 'try_expression' || cur.type === 'parenthesized_expression')) cur = cur.namedChildren[0] ?? null;
    return cur?.type === 'call_expression' ? cur : null;
  }

  /** `Type::new(..)`, `Type { .. }` → 'Type'. */
  private instanceType(v: Node): string | undefined {
    if (v.type === 'struct_expression') return this.chain(v.childForFieldName('name'))?.join('.');
    const call = this.unwrapCall(v);
    if (!call) return undefined;
    const c = this.chain(call.childForFieldName('function'));
    if (!c || c.length < 2) return undefined;
    const last = c[c.length - 1]!;
    const owner = c[c.length - 2]!;
    return CONSTRUCTORS.test(last) && /^[A-Z]/.test(owner) ? c.slice(0, -1).join('.') : undefined;
  }

  private call(node: Node): void {
    const fn = node.childForFieldName('function');
    const args = (node.childForFieldName('arguments')?.namedChildren ?? []).filter((a): a is Node => !!a && !a.type.includes('comment'));
    const c = this.chain(fn);
    if (c) {
      if (this.axumRoute(node, c, args)) return;
      this.addRef('call', c, node, args.slice(0, 3).map(literal));
      if (fn?.type === 'field_expression') {
        const obj = fn.childForFieldName('value');
        if (obj) this.walk(obj);
      }
    } else if (fn) this.walk(fn);
    for (const a of args) this.argument(a);
  }

  private argument(a: Node): void {
    const v = a.type === 'reference_expression' ? (a.childForFieldName('value') ?? a) : a;
    if (v.type === 'identifier' || v.type === 'field_expression' || v.type === 'scoped_identifier') {
      const c = this.chain(v);
      if (c) this.addRef('ref', c, v);
    } else this.walk(v);
  }

  /** axum: `.route("/orders", get(list).post(create))`. */
  private axumRoute(node: Node, c: string[], args: Node[]): boolean {
    if (c[c.length - 1] !== 'route' || args.length < 2) return false;
    const path = stringValue(args[0]);
    if (path === null || !path.startsWith('/')) return false;
    const full = joinRoute(undefined, path);
    const found: [string, string[]][] = [];
    const collect = (n: Node | null | undefined) => {
      if (n?.type !== 'call_expression') return;
      const f = n.childForFieldName('function');
      const verbNode = f?.type === 'field_expression' ? f.childForFieldName('field') : f;
      const verb = verbNode?.text.split('::').pop() ?? '';
      const handlerArgs = n.childForFieldName('arguments')?.namedChildren ?? [];
      if (ROUTE_ATTRS.has(verb) || verb === 'any') {
        const handlers = handlerArgs.map((h) => (h ? this.chain(h)?.join('.') : undefined)).filter((h): h is string => !!h);
        found.push([verb === 'any' ? 'ANY' : verb.toUpperCase(), handlers]);
      }
      if (f?.type === 'field_expression') collect(f.childForFieldName('value'));
    };
    collect(args[1]);
    if (!found.length) return false;
    for (const [method, handlers] of found) {
      this.addRoute({ method, path: full, line: line(node), router: 'axum', handlers, framework: 'axum' });
    }
    const fn = node.childForFieldName('function');
    if (fn?.type === 'field_expression') {
      const obj = fn.childForFieldName('value');
      if (obj) this.walk(obj);
    }
    return true;
  }
}
