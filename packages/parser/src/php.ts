/**
 * PHP language adapter.
 *
 * Records the namespace, `use` imports, `require`/`include` files,
 * classes / interfaces / traits / enums with typed properties (including
 * constructor promotion), call references (`$this->repo->save()` becomes
 * `this.repo.save`), Laravel and Symfony routes, and Eloquent models.
 */
import type { Node } from 'web-tree-sitter';
import type { ArgFact, FieldFact, ImportFact, ModelFact, SymbolFact, SymbolKind } from '@eyrie/core';
import { BaseExtractor, joinRoute, line } from './base.js';

const MAX_CHAIN = 6;
const TYPE_DECLS: Record<string, SymbolKind> = {
  class_declaration: 'class',
  interface_declaration: 'interface',
  trait_declaration: 'class',
  enum_declaration: 'enum',
};
const ROUTE_VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'any']);
const MODEL_BASES = /^(Model|Authenticatable|Pivot|Eloquent)$/;
const RELATIONS = new Set(['hasMany', 'hasOne', 'belongsTo', 'belongsToMany', 'morphMany', 'morphTo', 'hasManyThrough', 'hasOneThrough']);

const ns = (name: string) => name.replace(/^\\/, '').replace(/\\/g, '.');

function stringValue(n: Node | null | undefined): string | null {
  if (!n) return null;
  if (n.type === 'argument') return stringValue(n.namedChildren[n.namedChildren.length - 1]);
  if (n.type === 'string' || n.type === 'encapsed_string') {
    let out = '';
    for (const c of n.namedChildren) {
      if (!c) continue;
      if (c.type === 'string_content' || c.type === 'string_value' || c.type === 'escape_sequence') out += c.text;
      else out += ':param';
    }
    return out;
  }
  return null;
}

function literal(n: Node): ArgFact {
  const inner = n.type === 'argument' ? n.namedChildren[n.namedChildren.length - 1] : n;
  if (!inner) return null;
  const s = stringValue(inner);
  if (s !== null) return s;
  if (inner.type === 'binary_expression' && inner.childForFieldName('operator')?.text === '.') {
    const left = inner.childForFieldName('left');
    const head = left ? literal(left) : null;
    return typeof head === 'string' ? `${head}:param` : null;
  }
  return null;
}

function typeRoot(n: Node | null | undefined): string | undefined {
  if (!n) return undefined;
  switch (n.type) {
    case 'named_type': {
      const inner = n.namedChildren[0];
      return inner ? ns(inner.text) : undefined;
    }
    case 'name':
    case 'qualified_name':
      return ns(n.text);
    case 'optional_type':
    case 'nullable_type':
      return typeRoot(n.namedChildren[0]);
    case 'union_type':
      return typeRoot(n.namedChildren.find((c) => c?.type === 'named_type'));
    default:
      return undefined;
  }
}

const varName = (n: Node | null | undefined) => (n?.type === 'variable_name' ? n.text.replace(/^\$/, '') : undefined);

export class PhpExtractor extends BaseExtractor {
  private currentClass: SymbolFact | null = null;
  /** URL prefixes of the enclosing `Route::group`s; routes/api.php starts at /api. */
  private routePrefixes: string[] = [];

  protected visitRoot(root: Node): void {
    if (/(^|\/)routes\/api\.php$/.test(this.facts.path)) this.routePrefixes.push('api');
    this.statements(root.namedChildren);
  }

  private statements(nodes: (Node | null)[]): void {
    for (const child of nodes) {
      if (!child) continue;
      switch (child.type) {
        case 'php_tag':
        case 'text':
        case 'comment':
          break;
        case 'namespace_definition': {
          const name = child.childForFieldName('name')?.text;
          if (name && !this.facts.namespace) this.facts.namespace = ns(name);
          const body = child.childForFieldName('body');
          if (body) this.statements(body.namedChildren);
          break;
        }
        case 'namespace_use_declaration':
          this.useDecl(child);
          break;
        case 'function_definition':
          this.func(child, undefined);
          break;
        case 'expression_statement':
          this.moduleExpression(child);
          break;
        default:
          if (TYPE_DECLS[child.type]) this.typeDecl(child);
          else this.walk(child);
      }
    }
  }

  private useDecl(node: Node): void {
    const group = node.childForFieldName('body');
    const prefixNode = group ? node.namedChildren.find((c) => c?.type === 'namespace_name') : undefined;
    const prefix = prefixNode ? `${ns(prefixNode.text)}.` : '';
    const clauses = (group ?? node).namedChildren.filter((c): c is Node => c?.type === 'namespace_use_clause');
    for (const clause of clauses) {
      const target = clause.namedChildren.find((c) => c?.type === 'qualified_name' || c?.type === 'name');
      const alias = clause.childForFieldName('alias')?.text;
      if (!target) continue;
      const full = prefix + ns(target.text);
      const simple = full.split('.').pop()!;
      const imp: ImportFact = { source: full, line: line(node), typeOnly: false, specifiers: [{ imported: simple, local: alias ?? simple }] };
      this.facts.imports.push(imp);
    }
  }

  private moduleExpression(node: Node): void {
    const expr = node.namedChildren[0];
    if (expr && /^(require|include)(_once)?_expression$/.test(expr.type)) {
      const arg = expr.namedChildren[0];
      const s = arg ? (stringValue(arg) ?? (arg.type === 'binary_expression' ? stringValue(arg.childForFieldName('right')) : null)) : null;
      if (s) {
        const source = s.startsWith('/') ? `.${s}` : s.startsWith('.') ? s : `./${s}`;
        this.facts.imports.push({ source, line: line(node), typeOnly: false, specifiers: [] });
      }
      return;
    }
    this.walk(node);
  }

  // ── declarations ─────────────────────────────────────────────────────────

  private typeDecl(node: Node): void {
    const name = node.childForFieldName('name')?.text;
    if (!name) return;
    const sym = this.symbol(name, TYPE_DECLS[node.type]!, node, true);
    const doc = this.leadingDoc(node);
    if (doc) sym.doc = doc;
    const base = node.namedChildren.find((c) => c?.type === 'base_clause');
    const ext = (base?.namedChildren ?? []).map((c) => typeRoot(c)).filter((t): t is string => !!t);
    const impl = (node.namedChildren.find((c) => c?.type === 'class_interface_clause')?.namedChildren ?? []).map((c) => typeRoot(c)).filter((t): t is string => !!t);
    const body = node.childForFieldName('body');
    for (const u of body?.namedChildren ?? []) {
      // `use SomeTrait;` mixes the trait's methods in.
      if (u?.type === 'use_declaration') for (const t of u.namedChildren) if (t && (t.type === 'name' || t.type === 'qualified_name')) ext.push(ns(t.text));
    }
    if (ext.length) sym.extends = ext;
    if (impl.length) sym.implements = impl;
    sym.fields = [];
    this.addSymbol(sym);

    const model: ModelFact | null = node.type === 'class_declaration' && ext.some((b) => MODEL_BASES.test(b.split('.').pop()!))
      ? ({ name, line: sym.startLine, endLine: sym.endLine, fields: [], relations: [], orm: 'eloquent', symbol: sym.qualifiedName })
      : null;
    const prefix = this.attrRoute(node)?.path;

    const prev = this.currentClass;
    this.currentClass = sym;
    for (const m of body?.namedChildren ?? []) {
      if (!m) continue;
      if (m.type === 'property_declaration') {
        const t = typeRoot(m.childForFieldName('type'));
        for (const el of m.namedChildren) {
          if (el?.type !== 'property_element') continue;
          const n = varName(el.childForFieldName('name') ?? el.namedChildren[0]);
          if (!n) continue;
          const f: FieldFact = { name: n };
          if (t) f.type = t;
          sym.fields.push(f);
          const v = el.childForFieldName('default_value') ?? el.namedChildren[1];
          if (v) this.withScope({ name }, () => this.walk(v));
        }
      } else if (m.type === 'method_declaration') {
        const fn = this.func(m, sym);
        if (fn && model) {
          for (const call of m.descendantsOfType('member_call_expression')) {
            if (!call || !RELATIONS.has(call.childForFieldName('name')?.text ?? '')) continue;
            const arg = call.childForFieldName('arguments')?.namedChildren[0]?.namedChildren[0];
            const target = arg?.type === 'class_constant_access_expression' ? arg.namedChildren[0]?.text : stringValue(arg);
            const rel = target?.split('\\').pop();
            if (rel && !model.relations.includes(rel)) model.relations.push(rel);
          }
        }
        const r = this.attrRoute(m);
        if (fn && r) {
          for (const method of r.methods) this.addRoute({ method, path: joinRoute(prefix, r.path), line: line(m), router: 'symfony', handlers: [fn.qualifiedName], framework: 'symfony' });
        }
      } else if (m.type !== 'use_declaration') this.withScope({ name }, () => this.walk(m));
    }
    this.currentClass = prev;
    if (model) (this.facts.models ??= []).push(model);
  }

  /** Symfony `#[Route('/x', methods: ['GET'])]`. */
  private attrRoute(node: Node): { path: string; methods: string[] } | null {
    const group = node.namedChildren.find((c) => c?.type === 'attribute_list');
    for (const attr of group?.descendantsOfType('attribute') ?? []) {
      if (!attr || (attr.namedChildren[0]?.text ?? '').split('\\').pop() !== 'Route') continue;
      const args = attr.namedChildren.find((c) => c?.type === 'arguments')?.namedChildren ?? [];
      const path = args[0] ? stringValue(args[0]) : null;
      if (path === null) continue;
      const methodsArg = args.find((a) => a?.text.startsWith('methods'));
      const methods = methodsArg?.text.match(/\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/gi)?.map((m) => m.toUpperCase()) ?? ['ANY'];
      return { path, methods };
    }
    return null;
  }

  private func(node: Node, owner: SymbolFact | undefined): SymbolFact | null {
    const name = node.childForFieldName('name')?.text;
    if (!name) return null;
    const isPrivate = node.namedChildren.some((c) => c?.type === 'visibility_modifier' && c.text === 'private');
    const sym = this.symbol(name === '__construct' ? 'constructor' : name, owner ? 'method' : 'function', node, !isPrivate, owner?.qualifiedName);
    const doc = this.leadingDoc(node);
    if (doc) sym.doc = doc;
    sym.locals = {};
    this.addSymbol(sym);
    for (const p of node.childForFieldName('parameters')?.namedChildren ?? []) {
      if (!p) continue;
      const pn = varName(p.childForFieldName('name'));
      const t = typeRoot(p.childForFieldName('type'));
      if (!pn) continue;
      if (t) sym.locals[pn] = t;
      if (p.type === 'property_promotion_parameter' && owner) owner.fields!.push(t ? { name: pn, type: t } : { name: pn });
    }
    const body = node.childForFieldName('body');
    if (body) this.withScope({ name: sym.qualifiedName, locals: sym.locals }, () => this.walk(body));
    return sym;
  }

  // ── routes ───────────────────────────────────────────────────────────────

  /**
   * Laravel routes anywhere in a routes file: `Route::get('/x', [C::class, 'show'])`,
   * `Route::post('/x', 'C@store')`, `Route::match(['put', 'patch'], ...)`,
   * `Route::resource('articles', C::class)`, inside `Route::group(['prefix' => 'v1'], fn)`
   * or `Route::prefix('v1')->group(fn)`.
   */
  private laravelRoute(call: Node): boolean {
    if (call.childForFieldName('scope')?.text !== 'Route') return false;
    const verb = call.childForFieldName('name')?.text ?? '';
    const args = call.childForFieldName('arguments')?.namedChildren.filter((a): a is Node => a?.type === 'argument') ?? [];
    if (verb === 'group') return this.routeGroup(args, this.arrayString(args[0], 'prefix'));
    if (verb === 'resource' || verb === 'apiResource') return this.routeResource(call, args, verb === 'apiResource');
    let methods: string[];
    let rest = args;
    if (verb === 'match') {
      methods = (args[0]?.text.match(/\b(get|post|put|patch|delete|options)\b/gi) ?? []).map((m) => m.toUpperCase());
      rest = args.slice(1);
    } else if (ROUTE_VERBS.has(verb.toLowerCase())) methods = [verb.toLowerCase() === 'any' ? 'ANY' : verb.toUpperCase()];
    else return false;
    const path = rest[0] ? stringValue(rest[0]) : null;
    if (path === null || !methods.length) return false;
    const handlers = this.routeHandler(rest[1]);
    for (const method of methods) {
      const full = joinRoute(this.routePrefix(), path);
      const scope = `route:${method} ${full}`;
      this.addRoute({ method, path: full, line: line(call), router: 'Route', handlers, framework: 'laravel', scope });
      this.withScope({ name: scope, locals: {} }, () => {
        for (const a of rest.slice(1)) this.walk(a);
      });
    }
    return true;
  }

  /** `[OrderController::class, 'show']`, `'OrderController@show'`, `OrderController::class`. */
  private routeHandler(arg: Node | undefined): string[] {
    const h = arg?.namedChildren[arg.namedChildren.length - 1];
    if (h?.type === 'array_creation_expression') {
      const parts = h.namedChildren.map((e) => e?.namedChildren[0]);
      const cls = parts[0]?.type === 'class_constant_access_expression' ? parts[0].namedChildren[0]?.text : undefined;
      const action = parts[1] ? stringValue(parts[1]) : null;
      return cls ? [action ? `${cls}.${action}` : cls] : [];
    }
    const s = h ? stringValue(h) : null;
    if (s?.includes('@')) return [s.replace('@', '.').split('\\').pop()!];
    if (s && /^[A-Z][\w\\]*$/.test(s)) return [s.split('\\').pop()!];
    if (h?.type === 'class_constant_access_expression' && h.namedChildren[0]) return [h.namedChildren[0].text];
    return [];
  }

  private routePrefix(): string | undefined {
    const parts = this.routePrefixes.filter(Boolean);
    return parts.length ? `/${parts.map((p) => p.replace(/^\/+|\/+$/g, '')).join('/')}` : undefined;
  }

  /** Walks a group's closure with its URL prefix applied. */
  private routeGroup(args: Node[], prefix: string | undefined): boolean {
    const closure = args.map((a) => a.namedChildren[a.namedChildren.length - 1]).find((n) => n?.type === 'anonymous_function' || n?.type === 'arrow_function');
    if (!closure) return false;
    this.routePrefixes.push(prefix ?? '');
    try {
      this.walk(closure);
    } finally {
      this.routePrefixes.pop();
    }
    return true;
  }

  /** `Route::resource('articles', ArticleController::class, ['only' => [...]])` → its REST actions. */
  private routeResource(call: Node, args: Node[], api: boolean): boolean {
    const name = args[0] ? stringValue(args[0]) : null;
    const controller = this.routeHandler(args[1])[0];
    if (!name || !controller) return false;
    const opts = args[2]?.namedChildren[0];
    const only = opts ? this.arrayList(opts, 'only') : undefined;
    const except = opts ? this.arrayList(opts, 'except') : undefined;
    const param = `{${name.split('/').pop()!.replace(/ies$/, 'y').replace(/s$/, '')}}`;
    const actions: [string, string, string][] = [
      ['index', 'GET', ''],
      ['create', 'GET', '/create'],
      ['store', 'POST', ''],
      ['show', 'GET', `/${param}`],
      ['edit', 'GET', `/${param}/edit`],
      ['update', 'PUT', `/${param}`],
      ['destroy', 'DELETE', `/${param}`],
    ];
    for (const [action, method, suffix] of actions) {
      if (api && (action === 'create' || action === 'edit')) continue;
      if (only && !only.includes(action)) continue;
      if (except?.includes(action)) continue;
      const path = joinRoute(this.routePrefix(), `${name}${suffix}`);
      this.addRoute({ method, path, line: line(call), router: 'Route', handlers: [`${controller}.${action}`], framework: 'laravel' });
    }
    return true;
  }

  /** String value of `'key' => '...'` in an array literal argument. */
  private arrayString(arg: Node | undefined, key: string): string | undefined {
    const arr = arg?.namedChildren[0];
    for (const el of arr?.type === 'array_creation_expression' ? arr.namedChildren : []) {
      const [k, v] = el?.namedChildren ?? [];
      if (k && v && stringValue(k) === key) return stringValue(v) ?? undefined;
    }
    return undefined;
  }

  /** `['only' => ['index', 'show']]` → ['index', 'show']. */
  private arrayList(arr: Node, key: string): string[] | undefined {
    if (arr.type !== 'array_creation_expression') return undefined;
    for (const el of arr.namedChildren) {
      const [k, v] = el?.namedChildren ?? [];
      if (!k || !v || stringValue(k) !== key) continue;
      return v.namedChildren.map((e) => (e?.namedChildren[0] ? stringValue(e.namedChildren[0]) : null)).filter((x): x is string => !!x);
    }
    return undefined;
  }

  /** `Route::prefix('v1')->middleware('auth')->group(fn)`. */
  private fluentGroup(call: Node): boolean {
    if (call.childForFieldName('name')?.text !== 'group') return false;
    let prefix: string | undefined;
    let cur: Node | null = call.childForFieldName('object');
    while (cur && (cur.type === 'member_call_expression' || cur.type === 'scoped_call_expression')) {
      const name = cur.childForFieldName('name')?.text;
      if (name === 'prefix') prefix = stringValue(cur.childForFieldName('arguments')?.namedChildren[0]) ?? prefix;
      if (cur.type === 'scoped_call_expression') break;
      cur = cur.childForFieldName('object');
    }
    if (cur?.type !== 'scoped_call_expression' || cur.childForFieldName('scope')?.text !== 'Route') return false;
    const args = call.childForFieldName('arguments')?.namedChildren.filter((a): a is Node => a?.type === 'argument') ?? [];
    return this.routeGroup(args, prefix);
  }

  // ── references ───────────────────────────────────────────────────────────

  private chain(node: Node | null | undefined): string[] | null {
    if (!node) return null;
    switch (node.type) {
      case 'variable_name': {
        const n = node.text.replace(/^\$/, '');
        return [n];
      }
      case 'name':
      case 'qualified_name': {
        const t = node.text;
        if (t === 'self' || t === 'static') return ['this'];
        if (t === 'parent') return ['super'];
        return [t.replace(/^\\/, '').split('\\').pop()!];
      }
      case 'relative_scope':
        return node.text === 'parent' ? ['super'] : ['this'];
      case 'member_access_expression':
      case 'nullsafe_member_access_expression': {
        const obj = this.chain(node.childForFieldName('object'));
        const name = node.childForFieldName('name')?.text;
        if (!obj || !name || obj.length >= MAX_CHAIN) return null;
        return [...obj, name];
      }
      case 'member_call_expression':
      case 'nullsafe_member_call_expression': {
        const obj = this.chain(node.childForFieldName('object'));
        const name = node.childForFieldName('name')?.text;
        if (!obj || !name || obj.length >= MAX_CHAIN) return null;
        return [...obj, `${name}()`];
      }
      case 'scoped_call_expression': {
        const scope = this.chain(node.childForFieldName('scope'));
        const name = node.childForFieldName('name')?.text;
        if (!scope || !name) return null;
        return [...scope, `${name}()`];
      }
      case 'function_call_expression': {
        const fn = this.chain(node.childForFieldName('function'));
        return fn ? [...fn.slice(0, -1), `${fn[fn.length - 1]}()`] : null;
      }
      case 'parenthesized_expression':
        return this.chain(node.namedChildren[0]);
      default:
        return null;
    }
  }

  private walk(node: Node): void {
    switch (node.type) {
      case 'comment':
      case 'string':
      case 'encapsed_string':
      case 'integer':
      case 'attribute_list':
        return;
      case 'scoped_call_expression':
        if (this.laravelRoute(node)) return;
        return this.call(node);
      case 'member_call_expression':
        if (this.fluentGroup(node)) return;
        return this.call(node);
      case 'nullsafe_member_call_expression':
      case 'function_call_expression':
        return this.call(node);
      case 'object_creation_expression': {
        const t = node.namedChildren.find((c) => c?.type === 'name' || c?.type === 'qualified_name');
        const args = node.namedChildren.find((c) => c?.type === 'arguments')?.namedChildren.filter((a): a is Node => !!a) ?? [];
        if (t) this.addRef('new', [ns(t.text).split('.').pop()!], node, args.slice(0, 3).map(literal));
        for (const a of args) this.argument(a);
        return;
      }
      case 'assignment_expression':
        return this.assignment(node);
      case 'class_declaration':
        return;
    }
    for (const c of node.namedChildren) if (c) this.walk(c);
  }

  private assignment(node: Node): void {
    const left = node.childForFieldName('left');
    const right = node.childForFieldName('right');
    const locals = this.scope().locals;
    let inst: string | undefined;
    if (right?.type === 'object_creation_expression') {
      const t = right.namedChildren.find((c) => c?.type === 'name' || c?.type === 'qualified_name');
      inst = t ? ns(t.text).split('.').pop() : undefined;
    }
    const name = varName(left);
    if (name && locals) {
      if (inst) locals[name] = inst;
      else if (right && /call_expression$/.test(right.type)) {
        const c = this.chain(right);
        if (c) locals[name] = `call:${c.join('.').replace(/\(\)$/, '')}`;
      }
    }
    const lc = left?.type === 'member_access_expression' ? this.chain(left) : null;
    if (lc?.length === 2 && lc[0] === 'this' && this.currentClass) {
      const fields = (this.currentClass.fields ??= []);
      const existing = fields.find((f) => f.name === lc[1]);
      if (existing && inst && !existing.instanceOf) existing.instanceOf = inst;
      else if (!existing) fields.push(inst ? { name: lc[1]!, instanceOf: inst } : { name: lc[1]! });
    }
    if (right) this.walk(right);
  }

  private call(node: Node): void {
    const c = this.chain(node);
    const args = node.childForFieldName('arguments')?.namedChildren.filter((a): a is Node => !!a) ?? [];
    if (c) {
      const callee = [...c.slice(0, -1), c[c.length - 1]!.replace(/\(\)$/, '')];
      this.addRef('call', callee, node, args.slice(0, 3).map(literal));
    }
    const obj = node.childForFieldName('object');
    if (obj && obj.type !== 'variable_name') this.walk(obj);
    for (const a of args) this.argument(a);
  }

  private argument(a: Node): void {
    const v = a.type === 'argument' ? a.namedChildren[a.namedChildren.length - 1] : a;
    if (!v) return;
    if (v.type === 'variable_name' || v.type === 'member_access_expression') {
      const c = this.chain(v);
      if (c) this.addRef('ref', c, v);
    } else if (v.type === 'class_constant_access_expression') {
      const cls = v.namedChildren[0]?.text;
      if (cls && cls !== 'self' && cls !== 'static') this.addRef('ref', [cls.split('\\').pop()!], v);
    } else this.walk(v);
  }
}
