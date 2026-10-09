/**
 * Go language adapter.
 *
 * A Go package spans every file in its directory; the graph resolves
 * same-package names across sibling files, so this adapter only records
 * what each file declares. Method receivers become `this` so
 * `s.repo.Find()` resolves through the struct's fields.
 */
import type { Node } from 'web-tree-sitter';
import type { ArgFact, FieldFact, ImportFact, ModelFact, SymbolFact } from '@eyrie/core';
import { BaseExtractor, joinRoute, line } from './base.js';

const HTTP_VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'any']);
const MAX_CHAIN = 6;

const exported = (name: string) => /^[A-Z]/.test(name);

/** Package name Go would bind for an import path. */
export function goPackageName(path: string): string {
  const parts = path.split('/');
  let last = parts.pop() ?? path;
  if (/^v\d+$/.test(last) && parts.length) last = parts.pop()!;
  return last.replace(/\.v\d+$/, '').replace(/^go-/, '').replace(/[-.]go$/, '').replace(/[-.]/g, '_');
}

function stringValue(n: Node | null | undefined): string | null {
  if (!n) return null;
  if (n.type === 'interpreted_string_literal' || n.type === 'raw_string_literal') return n.text.slice(1, -1);
  return null;
}

function literal(n: Node): ArgFact {
  const s = stringValue(n);
  if (s !== null) return s;
  if (n.type === 'binary_expression' && n.childForFieldName('operator')?.text === '+') {
    const left = n.childForFieldName('left');
    const head = left ? literal(left) : null;
    return typeof head === 'string' ? `${head}:param` : null;
  }
  return null;
}

/** `*Repo`, `[]Item`, `pkg.Client`, `Repo[T]` → 'Repo' / 'Item' / 'pkg.Client'. */
function typeRoot(n: Node | null | undefined): string | undefined {
  if (!n) return undefined;
  switch (n.type) {
    case 'type_identifier':
    case 'identifier':
      return n.text;
    case 'qualified_type':
      return `${n.childForFieldName('package')?.text}.${n.childForFieldName('name')?.text}`;
    case 'pointer_type':
    case 'slice_type':
    case 'array_type':
    case 'parenthesized_type':
      return typeRoot(n.namedChildren[n.namedChildren.length - 1]);
    case 'generic_type':
      return typeRoot(n.childForFieldName('type') ?? n.namedChildren[0]);
    default:
      return undefined;
  }
}

export class GoExtractor extends BaseExtractor {
  private receiver: string | null = null;

  protected visitRoot(root: Node): void {
    for (const child of root.namedChildren) {
      if (!child) continue;
      switch (child.type) {
        case 'package_clause':
          break;
        case 'import_declaration':
          for (const spec of child.descendantsOfType('import_spec')) if (spec) this.importSpec(spec);
          break;
        case 'type_declaration':
          for (const spec of child.namedChildren) {
            if (spec?.type === 'type_spec' || spec?.type === 'type_alias') this.typeSpec(spec, child);
          }
          break;
        case 'function_declaration':
          this.func(child, undefined);
          break;
        case 'method_declaration':
          this.method(child);
          break;
        case 'var_declaration':
        case 'const_declaration':
          this.moduleVars(child);
          break;
        default:
          if (child.type !== 'comment') this.walk(child);
      }
    }
  }

  private importSpec(spec: Node): void {
    const path = stringValue(spec.childForFieldName('path'));
    if (!path) return;
    const name = spec.childForFieldName('name');
    const imp: ImportFact = { source: path, line: line(spec), typeOnly: false, specifiers: [] };
    if (name?.type === 'dot') imp.wildcard = true;
    else if (name?.type !== 'blank_identifier') imp.specifiers.push({ imported: '*', local: name?.text ?? goPackageName(path) });
    this.facts.imports.push(imp);
  }

  private typeSpec(spec: Node, decl: Node): void {
    const name = spec.childForFieldName('name')?.text;
    const type = spec.childForFieldName('type');
    if (!name || !type) return;
    const outer = decl.namedChildren.length === 1 ? decl : spec;
    const kind = type.type === 'struct_type' ? 'class' : type.type === 'interface_type' ? 'interface' : 'type';
    const sym = this.symbol(name, kind, outer, exported(name));
    const doc = this.leadingDoc(outer);
    if (doc) sym.doc = doc;
    this.addSymbol(sym);
    if (type.type === 'struct_type') this.structFields(sym, type);
    else if (type.type === 'interface_type') {
      for (const m of type.namedChildren) {
        if (m?.type !== 'method_elem' && m?.type !== 'method_spec') continue;
        const mname = m.childForFieldName('name')?.text;
        if (mname) this.addSymbol(this.symbol(mname, 'method', m, exported(mname), name));
      }
    }
  }

  private structFields(sym: SymbolFact, struct: Node): void {
    const fields: FieldFact[] = [];
    const embeds: string[] = [];
    let gorm = false;
    for (const fd of struct.descendantsOfType('field_declaration')) {
      if (!fd) continue;
      const t = typeRoot(fd.childForFieldName('type'));
      const names = fd.childrenForFieldName('name').filter((n): n is Node => !!n);
      if (/gorm:"/.test(fd.childForFieldName('tag')?.text ?? '')) gorm = true;
      if (!names.length) {
        if (t) embeds.push(t);
        if (t === 'gorm.Model') gorm = true;
        continue;
      }
      for (const n of names) fields.push(t ? { name: n.text, type: t } : { name: n.text });
    }
    sym.fields = fields;
    if (embeds.length) sym.extends = embeds;
    if (gorm) {
      const relations = fields
        .map((f) => f.type)
        .filter((t): t is string => !!t && /^[A-Z]/.test(t) && t !== sym.name && !t.includes('.'));
      const model: ModelFact = { name: sym.name, line: sym.startLine, endLine: sym.endLine, fields: fields.map((f) => f.name), relations: [...new Set(relations)], orm: 'gorm', symbol: sym.qualifiedName };
      (this.facts.models ??= []).push(model);
    }
  }

  private func(node: Node, parent: string | undefined): SymbolFact | null {
    const name = node.childForFieldName('name')?.text;
    if (!name) return null;
    const sym = this.symbol(name, parent ? 'method' : 'function', node, exported(name), parent);
    const doc = this.leadingDoc(node);
    if (doc) sym.doc = doc;
    sym.locals = {};
    this.addSymbol(sym);
    this.params(node.childForFieldName('parameters'), sym.locals);
    const body = node.childForFieldName('body');
    if (body) this.withScope({ name: sym.qualifiedName, locals: sym.locals }, () => this.walk(body));
    return sym;
  }

  private method(node: Node): void {
    const recv = node.childForFieldName('receiver')?.namedChildren.find((c) => c?.type === 'parameter_declaration');
    const owner = typeRoot(recv?.childForFieldName('type'));
    if (!owner) return;
    const prev = this.receiver;
    this.receiver = recv?.childForFieldName('name')?.text ?? null;
    try {
      this.func(node, owner);
    } finally {
      this.receiver = prev;
    }
  }

  private params(list: Node | null, locals: Record<string, string>): void {
    for (const p of list?.namedChildren ?? []) {
      if (p?.type !== 'parameter_declaration' && p?.type !== 'variadic_parameter_declaration') continue;
      const t = typeRoot(p.childForFieldName('type'));
      if (!t) continue;
      for (const n of p.childrenForFieldName('name')) if (n) locals[n.text] = t;
    }
  }

  private moduleVars(decl: Node): void {
    for (const spec of decl.namedChildren) {
      if (spec?.type !== 'var_spec' && spec?.type !== 'const_spec') {
        if (spec?.type === 'var_spec_list') this.moduleVars(spec);
        continue;
      }
      const names = spec.childrenForFieldName('name').filter((n): n is Node => !!n);
      const value = spec.childForFieldName('value')?.namedChildren[0];
      for (const n of names) {
        const sym = this.symbol(n.text, 'variable', spec, exported(n.text));
        const t = typeRoot(spec.childForFieldName('type'));
        if (t) sym.typeName = t;
        const inst = value ? this.instanceType(value) : undefined;
        if (inst) sym.instanceOf = inst;
        else if (value?.type === 'call_expression') {
          const c = this.chain(value.childForFieldName('function'));
          if (c) sym.initCall = c.join('.');
        }
        const doc = this.leadingDoc(decl);
        if (doc) sym.doc = doc;
        this.addSymbol(sym);
      }
      if (value) this.withScope({ name: names[0]?.text ?? '' }, () => this.walk(value));
    }
  }

  /** `&Service{}`, `Service{}`, `NewService(...)` → 'Service'. */
  private instanceType(v: Node): string | undefined {
    if (v.type === 'unary_expression') {
      const operand = v.childForFieldName('operand');
      return operand ? this.instanceType(operand) : undefined;
    }
    if (v.type === 'composite_literal') return typeRoot(v.childForFieldName('type'));
    if (v.type === 'call_expression') {
      const c = this.chain(v.childForFieldName('function'));
      const last = c?.[c.length - 1];
      const m = last ? /^New([A-Z]\w*)$/.exec(last) : null;
      if (c && m) return [...c.slice(0, -1), m[1]].join('.');
    }
    return undefined;
  }

  private chain(node: Node | null | undefined): string[] | null {
    if (!node) return null;
    switch (node.type) {
      case 'identifier':
      case 'field_identifier':
      case 'package_identifier':
      case 'type_identifier':
        return [node.text === this.receiver ? 'this' : node.text];
      case 'selector_expression': {
        const obj = this.chain(node.childForFieldName('operand'));
        const field = node.childForFieldName('field');
        if (!obj || !field || obj.length >= MAX_CHAIN) return null;
        return [...obj, field.text];
      }
      case 'call_expression': {
        const inner = this.chain(node.childForFieldName('function'));
        if (!inner) return null;
        return [...inner.slice(0, -1), `${inner[inner.length - 1]}()`];
      }
      case 'index_expression': {
        const obj = this.chain(node.childForFieldName('operand'));
        return obj ? [...obj, '[]'] : null;
      }
      case 'parenthesized_expression':
        return this.chain(node.namedChildren[0]);
      default:
        return null;
    }
  }

  // ── references ───────────────────────────────────────────────────────────

  private walk(node: Node): void {
    switch (node.type) {
      case 'comment':
      case 'interpreted_string_literal':
      case 'raw_string_literal':
      case 'int_literal':
      case 'float_literal':
        return;
      case 'call_expression':
        return this.call(node);
      case 'composite_literal': {
        const t = typeRoot(node.childForFieldName('type'));
        if (t && /^[A-Z]|\.[A-Z]/.test(t)) this.addRef('new', t.split('.'), node);
        const body = node.childForFieldName('body');
        if (body) this.walk(body);
        return;
      }
      case 'short_var_declaration':
        return this.shortVar(node);
      case 'var_spec': {
        const locals = this.scope().locals;
        const t = typeRoot(node.childForFieldName('type'));
        if (locals && t) for (const n of node.childrenForFieldName('name')) if (n) locals[n.text] = t;
        break;
      }
    }
    for (const c of node.namedChildren) if (c) this.walk(c);
  }

  private shortVar(node: Node): void {
    const locals = this.scope().locals;
    const left = node.childForFieldName('left')?.namedChildren ?? [];
    const right = node.childForFieldName('right')?.namedChildren ?? [];
    if (locals) {
      left.forEach((l, i) => {
        // `x, err := f()` binds the first result.
        const r = right.length === left.length ? right[i] : i === 0 ? right[0] : undefined;
        if (l?.type !== 'identifier' || !r) return;
        const inst = this.instanceType(r);
        if (inst) locals[l.text] = inst;
        else if (r.type === 'call_expression') {
          const c = this.chain(r.childForFieldName('function'));
          if (c) locals[l.text] = `call:${c.join('.')}`;
        }
      });
    }
    for (const r of right) if (r) this.walk(r);
  }

  private call(node: Node): void {
    const fn = node.childForFieldName('function');
    const args = node.childForFieldName('arguments');
    if (!fn) return;
    const c = this.chain(fn);
    const argNodes = (args?.namedChildren ?? []).filter((a): a is Node => !!a && a.type !== 'comment');
    if (c) {
      if (this.route(node, c, argNodes)) return;
      this.addRef('call', c, node, argNodes.slice(0, 3).map(literal));
      if (fn.type === 'selector_expression') {
        const obj = fn.childForFieldName('operand');
        if (obj) this.walk(obj);
      }
    } else this.walk(fn);
    for (const a of argNodes) this.argument(a);
  }

  private argument(a: Node): void {
    if (a.type === 'identifier' || a.type === 'selector_expression') {
      const c = this.chain(a);
      if (c) this.addRef('ref', c, a);
    } else this.walk(a);
  }

  /** net/http, gin, echo, chi, fiber, gorilla/mux registrations. */
  private route(node: Node, c: string[], args: Node[]): boolean {
    if (c.length !== 2) return false;
    const [router, verb] = c as [string, string];
    const path = stringValue(args[0]);
    if (path === null) return false;
    let method: string | undefined;
    let routePath = path;
    if (verb === 'HandleFunc' || verb === 'Handle') {
      const m = /^([A-Z]+)\s+(\/.*)$/.exec(path);
      if (m) {
        method = m[1];
        routePath = m[2]!;
      } else method = this.gorillaMethods(node) ?? 'ANY';
    } else if (HTTP_VERBS.has(verb.toLowerCase())) {
      method = verb.toLowerCase() === 'any' ? 'ANY' : verb.toUpperCase();
    }
    if (!method || !routePath.startsWith('/')) return false;
    const full = joinRoute(undefined, routePath);
    const scope = `route:${method} ${full}`;
    const handlers: string[] = [];
    for (const a of args.slice(1)) {
      const h = this.chain(a);
      if (h) handlers.push(h.join('.'));
    }
    this.addRoute({ method, path: full, line: line(node), router, handlers, framework: 'go', scope });
    this.addRef('call', c, node, [path]);
    this.withScope({ name: scope, locals: {} }, () => {
      for (const a of args.slice(1)) this.argument(a);
    });
    return true;
  }

  /** gorilla/mux: `r.HandleFunc("/x", h).Methods("POST")`. */
  private gorillaMethods(call: Node): string | undefined {
    const sel = call.parent;
    if (sel?.type !== 'selector_expression' || sel.childForFieldName('field')?.text !== 'Methods') return undefined;
    const outer = sel.parent;
    const first = outer?.childForFieldName('arguments')?.namedChildren[0];
    return stringValue(first)?.toUpperCase() ?? undefined;
  }
}
