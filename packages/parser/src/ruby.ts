/**
 * Ruby language adapter.
 *
 * Records `require` / `require_relative`, modules (as the namespace),
 * classes with mixins and instance-variable fields, `def` / `def self.`
 * methods, call references (`@repo.save` becomes `this.repo.save`,
 * `Foo.new` a construction), Rails / Sinatra routes and ActiveRecord
 * models with their associations.
 */
import type { Node } from 'web-tree-sitter';
import type { ArgFact, FieldFact, ModelFact, SymbolFact } from '@eyrie/core';
import { BaseExtractor, joinRoute, line } from './base.js';

const MAX_CHAIN = 6;
const ROUTE_VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'match']);
const MODEL_BASES = /^(ApplicationRecord|ActiveRecord\.Base)$/;
const ASSOCIATIONS = new Set(['has_many', 'has_one', 'belongs_to', 'has_and_belongs_to_many']);
const RESOURCE_ACTIONS: [string, string, boolean][] = [
  ['index', 'GET', false],
  ['create', 'POST', false],
  ['show', 'GET', true],
  ['update', 'PATCH', true],
  ['destroy', 'DELETE', true],
];

const pascal = (s: string) => s.split(/[_/]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
function singular(s: string): string {
  if (s.endsWith('ies')) return `${s.slice(0, -3)}y`;
  if (/(ss|us)$/.test(s)) return s;
  return s.endsWith('s') ? s.slice(0, -1) : s;
}
const constName = (n: Node) => n.text.replace(/^::/, '').replace(/::/g, '.');

function stringValue(n: Node | null | undefined): string | null {
  if (!n) return null;
  if (n.type === 'string') {
    let out = '';
    for (const c of n.namedChildren) {
      if (!c) continue;
      if (c.type === 'string_content' || c.type === 'escape_sequence') out += c.text;
      else if (c.type === 'interpolation') out += ':param';
    }
    return out;
  }
  if (n.type === 'simple_symbol') return n.text.slice(1);
  return null;
}

function literal(n: Node): ArgFact {
  const s = stringValue(n);
  if (s !== null) return s;
  if (n.type === 'hash') {
    const out: Record<string, string> = {};
    for (const p of n.namedChildren) {
      if (p?.type !== 'pair') continue;
      const k = p.childForFieldName('key');
      const v = stringValue(p.childForFieldName('value'));
      const key = k ? (k.type === 'hash_key_symbol' ? k.text : stringValue(k)) : null;
      if (key && v !== null) out[key] = v;
    }
    return Object.keys(out).length ? out : null;
  }
  return null;
}

interface ClassCtx {
  sym: SymbolFact;
  methods: Set<string>;
}

export class RubyExtractor extends BaseExtractor {
  private cls: ClassCtx | null = null;
  private declared: Set<string>[] = [];
  private modules: string[] = [];
  private readonly routesFile = /(^|\/)config\/routes(\/.*)?\.rb$/.test(this.facts.path);

  protected visitRoot(root: Node): void {
    this.body(root.namedChildren);
  }

  private body(nodes: (Node | null)[]): void {
    for (const child of nodes) {
      if (!child) continue;
      switch (child.type) {
        case 'comment':
          break;
        case 'module':
          this.module(child);
          break;
        case 'class':
          this.classDecl(child);
          break;
        case 'method':
          this.method(child, undefined);
          break;
        case 'singleton_method':
          this.method(child, undefined);
          break;
        case 'call':
          this.topCall(child);
          break;
        case 'assignment':
          this.constant(child);
          break;
        default:
          this.walk(child);
      }
    }
  }

  private module(node: Node): void {
    const nameNode = node.childForFieldName('name');
    const name = nameNode ? constName(nameNode) : '';
    this.modules.push(name);
    if (!this.facts.namespace) this.facts.namespace = this.modules.join('.');
    const body = node.childForFieldName('body');
    // A module with only methods is itself a callable unit (helpers, concerns).
    const hasMethods = body?.namedChildren.some((c) => c?.type === 'method' || c?.type === 'singleton_method');
    if (hasMethods && name) {
      const sym = this.symbol(name.split('.').pop()!, 'class', node, true);
      const doc = this.leadingDoc(node);
      if (doc) sym.doc = doc;
      sym.fields = [];
      this.addSymbol(sym);
      const prev = this.cls;
      this.cls = { sym, methods: new Set(body!.namedChildren.filter((c) => c?.type === 'method').map((c) => c!.childForFieldName('name')?.text ?? '')) };
      for (const m of body!.namedChildren) {
        if (m?.type === 'method') this.method(m, sym);
        else if (m?.type === 'singleton_method') this.method(m, sym);
        else if (m?.type === 'class') this.classDecl(m);
        else if (m?.type === 'module') this.module(m);
        else if (m) this.withScope({ name: sym.qualifiedName }, () => this.walk(m));
      }
      this.cls = prev;
    } else if (body) this.body(body.namedChildren);
    this.modules.pop();
  }

  private classDecl(node: Node): void {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;
    const name = constName(nameNode).split('.').pop()!;
    const sym = this.symbol(name, 'class', node, true);
    const doc = this.leadingDoc(node) ?? this.parentDoc(node);
    if (doc) sym.doc = doc;
    const superNode = node.childForFieldName('superclass')?.namedChildren[0];
    const ext = superNode ? [constName(superNode)] : [];
    sym.fields = [];
    const body = node.childForFieldName('body');
    const methods = new Set<string>();
    for (const m of body?.namedChildren ?? []) {
      if (m?.type === 'method') methods.add(m.childForFieldName('name')?.text ?? '');
      if (m?.type === 'call' && /^(include|extend|prepend)$/.test(m.childForFieldName('method')?.text ?? '')) {
        for (const a of m.childForFieldName('arguments')?.namedChildren ?? []) if (a && (a.type === 'constant' || a.type === 'scope_resolution')) ext.push(constName(a));
      }
    }
    if (ext.length) sym.extends = ext;
    this.addSymbol(sym);

    const model: ModelFact | null = ext.some((e) => MODEL_BASES.test(e)) || ext.includes('Mongoid.Document')
      ? ({ name, line: sym.startLine, endLine: sym.endLine, fields: [], relations: [], orm: ext.includes('Mongoid.Document') ? 'mongoid' : 'activerecord', symbol: sym.qualifiedName })
      : null;

    const prev = this.cls;
    this.cls = { sym, methods };
    for (const m of body?.namedChildren ?? []) {
      if (!m) continue;
      if (m.type === 'method') this.method(m, sym);
      else if (m.type === 'singleton_method') this.method(m, sym);
      else if (m.type === 'class') this.classDecl(m);
      else if (m.type === 'call') this.classMacro(m, sym, model);
      else this.withScope({ name }, () => this.walk(m));
    }
    this.cls = prev;
    if (model) (this.facts.models ??= []).push(model);
  }

  /** Comments above a class sit on the enclosing module, not the body. */
  private parentDoc(node: Node): string | undefined {
    const parent = node.parent;
    if (parent?.type !== 'body_statement' || !parent.namedChildren[0]?.equals(node)) return undefined;
    return this.leadingDoc(parent);
  }

  /** `has_many :items`, `attr_reader :repo`, `include X` and other class-body calls. */
  private classMacro(call: Node, sym: SymbolFact, model: ModelFact | null): void {
    const method = call.childForFieldName('method')?.text ?? '';
    const args = call.childForFieldName('arguments')?.namedChildren ?? [];
    if (ASSOCIATIONS.has(method)) {
      const target = stringValue(args[0]);
      const className = args.find((a) => a?.type === 'pair' && a.childForFieldName('key')?.text === 'class_name');
      const rel = (className && stringValue(className.childForFieldName('value'))) || (target ? pascal(singular(target)) : null);
      if (rel && model && !model.relations.includes(rel)) model.relations.push(rel);
      return;
    }
    if (/^attr_(reader|writer|accessor)$/.test(method)) {
      for (const a of args) {
        const n = stringValue(a);
        if (n && !sym.fields!.some((f) => f.name === n)) sym.fields!.push({ name: n });
        if (n) this.cls?.methods.add(n);
      }
      return;
    }
    if (/^(include|extend|prepend)$/.test(method)) return;
    this.withScope({ name: sym.qualifiedName }, () => this.walk(call));
  }

  private method(node: Node, owner: SymbolFact | undefined): void {
    const name = node.childForFieldName('name')?.text;
    if (!name) return;
    const sym = this.symbol(name === 'initialize' ? 'constructor' : name, owner ? 'method' : 'function', node, !name.startsWith('_'), owner?.qualifiedName);
    const doc = this.leadingDoc(node);
    if (doc) sym.doc = doc;
    sym.locals = {};
    this.addSymbol(sym);
    const declared = new Set<string>();
    for (const p of node.childForFieldName('parameters')?.namedChildren ?? []) {
      if (!p) continue;
      const pn = p.type === 'identifier' ? p.text : p.childForFieldName('name')?.text;
      if (!pn) continue;
      declared.add(pn);
      const v = p.childForFieldName('value');
      const inst = v ? this.instanceOf(v) : undefined;
      if (inst) sym.locals[pn] = inst;
    }
    const body = node.childForFieldName('body');
    if (body) {
      this.declared.push(declared);
      this.withScope({ name: sym.qualifiedName, locals: sym.locals }, () => this.walk(body));
      this.declared.pop();
    }
  }

  private constant(node: Node): void {
    const left = node.childForFieldName('left');
    const right = node.childForFieldName('right');
    if (left?.type !== 'constant') return this.walk(node);
    const sym = this.symbol(left.text, 'variable', node, true);
    const inst = right ? this.instanceOf(right) : undefined;
    if (inst) sym.instanceOf = inst;
    this.addSymbol(sym);
    if (right) this.withScope({ name: left.text }, () => this.walk(right));
  }

  /** `Foo.new(...)` / `Foo::Bar.new` → 'Foo' / 'Foo.Bar'. */
  private instanceOf(v: Node): string | undefined {
    if (v.type !== 'call' || v.childForFieldName('method')?.text !== 'new') return undefined;
    const recv = v.childForFieldName('receiver');
    return recv && (recv.type === 'constant' || recv.type === 'scope_resolution') ? constName(recv) : undefined;
  }

  // ── requires and routes ──────────────────────────────────────────────────

  private topCall(call: Node): void {
    const method = call.childForFieldName('method')?.text ?? '';
    const receiver = call.childForFieldName('receiver');
    const args = call.childForFieldName('arguments')?.namedChildren ?? [];
    if (!receiver && (method === 'require' || method === 'require_relative' || method === 'load')) {
      const s = stringValue(args[0]);
      if (s) {
        const relative = method === 'require_relative';
        const source = relative && !s.startsWith('.') ? `./${s}` : s;
        // A gem's constants (`Stripe::Charge`) are global once required.
        this.facts.imports.push({ source, line: line(call), typeOnly: false, specifiers: [], ...(relative ? {} : { wildcard: true }) });
      }
      return;
    }
    if (this.routesFile && method === 'draw') {
      const block = call.childForFieldName('block');
      const body = block?.childForFieldName('body');
      if (body) this.railsRoutes(body.namedChildren, '', []);
      return;
    }
    if (!receiver && ROUTE_VERBS.has(method) && call.childForFieldName('block') && this.sinatraRoute(call, method, args)) return;
    this.walk(call);
  }

  private sinatraRoute(call: Node, verb: string, args: (Node | null)[]): boolean {
    const path = stringValue(args[0]);
    if (!path?.startsWith('/')) return false;
    const method = verb.toUpperCase();
    const full = joinRoute(undefined, path);
    const scope = `route:${method} ${full}`;
    this.addRoute({ method, path: full, line: line(call), router: 'sinatra', handlers: [], framework: 'sinatra', scope });
    const block = call.childForFieldName('block');
    if (block) this.withScope({ name: scope, locals: {} }, () => this.walk(block));
    return true;
  }

  /** `get "/x", to: "orders#show"`, `resources :orders`, `namespace :api do ... end`. */
  private railsRoutes(nodes: (Node | null)[], prefix: string, modules: string[]): void {
    for (const n of nodes) {
      if (n?.type !== 'call' || n.childForFieldName('receiver')) continue;
      const method = n.childForFieldName('method')?.text ?? '';
      const args = (n.childForFieldName('arguments')?.namedChildren ?? []).filter((a): a is Node => !!a);
      const blockBody = n.childForFieldName('block')?.childForFieldName('body')?.namedChildren ?? [];
      const opt = (key: string) => {
        for (const a of args) {
          if (a.type === 'pair' && a.childForFieldName('key')?.text.replace(/^:|:$/g, '') === key) return a.childForFieldName('value');
        }
        return null;
      };
      const controllerOf = (spec: string) => {
        const [ctrl, action] = spec.split('#');
        const cls = `${pascal(ctrl!.split('/').pop()!)}Controller`;
        return action ? `${cls}.${action}` : cls;
      };
      if (method === 'namespace' || method === 'scope') {
        const seg = stringValue(args[0]) ?? stringValue(opt('path')) ?? '';
        this.railsRoutes(blockBody, seg ? `${prefix}/${seg}` : prefix, method === 'namespace' ? [...modules, pascal(seg)] : modules);
      } else if (ROUTE_VERBS.has(method) || method === 'root') {
        let path: string | null;
        let target: string | null;
        const arrow = args.find((a) => a.type === 'pair' && a.childForFieldName('key')?.type === 'string');
        if (method === 'root') {
          path = '/';
          target = stringValue(args[0]) ?? stringValue(opt('to'));
        } else if (arrow) {
          path = stringValue(arrow.childForFieldName('key'));
          target = stringValue(arrow.childForFieldName('value'));
        } else {
          path = stringValue(args[0]);
          target = stringValue(opt('to'));
        }
        if (path === null) continue;
        const verb = method === 'root' ? 'GET' : method === 'match' ? 'ANY' : method.toUpperCase();
        this.addRoute({ method: verb, path: joinRoute(prefix, path), line: line(n), router: 'rails', handlers: target?.includes('#') ? [controllerOf(target)] : [], framework: 'rails' });
      } else if (method === 'resources' || method === 'resource') {
        const name = stringValue(args[0]);
        if (!name) continue;
        const onlyNode = opt('only');
        const only = onlyNode ? new Set(onlyNode.namedChildren.map((c) => (c ? stringValue(c) : null)).filter(Boolean)) : null;
        const ctrl = `${pascal(method === 'resource' ? `${name}s` : name)}Controller`;
        const base = `${prefix}/${name}`;
        for (const [action, verb, member] of RESOURCE_ACTIONS) {
          if (only && !only.has(action)) continue;
          if (method === 'resource' && action === 'index') continue;
          const path = member && method === 'resources' ? `${base}/:id` : base;
          this.addRoute({ method: verb, path: joinRoute(undefined, path), line: line(n), router: 'rails', handlers: [`${ctrl}.${action}`], framework: 'rails' });
        }
        if (blockBody.length) this.railsRoutes(blockBody, `${base}/:${singular(name)}_id`, modules);
      }
    }
  }

  // ── references ───────────────────────────────────────────────────────────

  private isDeclared(name: string): boolean {
    return this.declared.some((s) => s.has(name));
  }

  /** A receiver-less name that is a method of the enclosing class is `this.name`. */
  private bare(name: string): string[] {
    return !this.isDeclared(name) && this.cls?.methods.has(name) ? ['this', name] : [name];
  }

  private chain(node: Node | null | undefined): string[] | null {
    if (!node) return null;
    switch (node.type) {
      case 'identifier':
        return this.bare(node.text);
      case 'self':
        return ['this'];
      case 'super':
        return ['super'];
      case 'instance_variable':
        return ['this', node.text.slice(1)];
      case 'constant':
        return [node.text];
      case 'scope_resolution':
        return constName(node).split('.');
      case 'call': {
        const recv = node.childForFieldName('receiver');
        const method = node.childForFieldName('method')?.text;
        if (!method) return null;
        // `Foo.new.bar` calls an instance method of Foo.
        if (method === 'new' && recv && (recv.type === 'constant' || recv.type === 'scope_resolution')) return constName(recv).split('.');
        const head = recv ? this.chain(recv) : this.bare(method).slice(0, -1);
        if (!head || head.length >= MAX_CHAIN) return null;
        return [...head, `${method}()`];
      }
      case 'parenthesized_statements':
        return this.chain(node.namedChildren[0]);
      default:
        return null;
    }
  }

  private walk(node: Node): void {
    switch (node.type) {
      case 'comment':
      case 'string':
      case 'simple_symbol':
      case 'integer':
        return;
      case 'call':
        return this.call(node);
      case 'identifier': {
        // A bare identifier that names a method of this class is a call.
        if (!this.isDeclared(node.text) && this.cls?.methods.has(node.text)) this.addRef('call', ['this', node.text], node);
        return;
      }
      case 'assignment':
      case 'operator_assignment':
        return this.assignment(node);
      case 'block':
      case 'do_block': {
        const params = node.childForFieldName('parameters');
        this.declared.push(new Set((params?.descendantsOfType('identifier') ?? []).map((p) => p?.text ?? '')));
        for (const c of node.namedChildren) if (c && !(params && c.equals(params))) this.walk(c);
        this.declared.pop();
        return;
      }
      case 'class':
      case 'module':
      case 'method':
        return;
    }
    for (const c of node.namedChildren) if (c) this.walk(c);
  }

  private assignment(node: Node): void {
    const left = node.childForFieldName('left');
    const right = node.childForFieldName('right');
    const inst = right ? this.instanceOf(right) : undefined;
    const locals = this.scope().locals;
    if (left?.type === 'identifier') {
      this.declared[this.declared.length - 1]?.add(left.text);
      if (locals) {
        if (inst) locals[left.text] = inst;
        else if (right?.type === 'call') {
          const c = this.chain(right);
          if (c) locals[left.text] = `call:${c.join('.').replace(/\(\)$/, '')}`;
        }
      }
    } else if (left?.type === 'instance_variable' && this.cls) {
      const name = left.text.slice(1);
      const fields = (this.cls.sym.fields ??= []);
      const type = inst ?? (right?.type === 'identifier' ? locals?.[right.text] : undefined);
      const existing = fields.find((f) => f.name === name);
      if (!existing) {
        const f: FieldFact = { name };
        if (type && !type.startsWith('call:')) f.instanceOf = type;
        fields.push(f);
      } else if (type && !type.startsWith('call:') && !existing.instanceOf) existing.instanceOf = type;
    }
    if (right) this.walk(right);
  }

  private call(node: Node): void {
    const method = node.childForFieldName('method')?.text;
    const recv = node.childForFieldName('receiver');
    const args = (node.childForFieldName('arguments')?.namedChildren ?? []).filter((a): a is Node => !!a);
    if (method === 'new' && recv && (recv.type === 'constant' || recv.type === 'scope_resolution')) {
      this.addRef('new', constName(recv).split('.'), node, args.slice(0, 3).map(literal));
    } else {
      const c = this.chain(node);
      if (c) this.addRef('call', [...c.slice(0, -1), c[c.length - 1]!.replace(/\(\)$/, '')], node, args.slice(0, 3).map(literal));
      if (recv && recv.type !== 'identifier' && recv.type !== 'instance_variable' && recv.type !== 'constant' && recv.type !== 'self') this.walk(recv);
    }
    for (const a of args) {
      if (a.type === 'instance_variable' || a.type === 'constant' || (a.type === 'identifier' && this.isDeclared(a.text))) {
        const c = this.chain(a);
        if (c) this.addRef('ref', c, a);
      } else this.walk(a);
    }
    const block = node.childForFieldName('block');
    if (block) this.walk(block);
  }
}
