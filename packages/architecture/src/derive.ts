import {
  idFor,
  keys,
  type ArchEdge,
  type ArchGraph,
  type ArchKind,
  type ArchNode,
  type CodeEdgeKind,
  type FileFacts,
  type SourceRef,
  type SymbolFact,
} from '@eyrie/core';
import { languageOfPath, symbolId, type CodeGraphStore, type NextFileInfo } from '@eyrie/graph';
import {
  ROLE_KIND,
  STRUCTURAL_DIRS,
  categoryOf,
  classifyFile,
  domainOf,
  isTestFile,
  exportedSymbols,
  fileStem,
  laneOf,
  routeLabel,
  titleCase,
  words,
  type FileRole,
} from './classify.js';

/** What the derivation needs from the code graph. `GraphIndex` satisfies it. */
export interface ArchitectureSource {
  readonly store: CodeGraphStore;
  getFacts(path: string): FileFacts | undefined;
  nextInfo(path: string): NextFileInfo | null;
}

const LIFTED_EDGES = new Set<CodeEdgeKind>(['CALLS', 'USES', 'HTTP_CALL', 'READS_FROM', 'WRITES_TO', 'EXTENDS', 'IMPLEMENTS', 'PUBLISHES', 'SUBSCRIBES', 'TRIGGERS']);
const BACKEND_LANES = new Set(['api', 'logic', 'data', 'external']);
const MAX_SITES = 3;
const HUB_CALLERS = 3;
const LIBRARY_THRESHOLD = 6;

interface Draft {
  key: string;
  role: FileRole | 'model' | 'external' | 'missing';
  kind: ArchKind;
  label: string;
  sublabel?: string;
  domain?: string;
  members: Set<string>;
  files: Set<string>;
  source?: SourceRef;
  summary?: string;
  meta: Record<string, unknown>;
  externalCategory?: string;
}

interface RawEdge {
  kinds: Set<CodeEdgeKind>;
  weight: number;
  sites: SourceRef[];
}

/** How each ORM writes its own name. */
const ORM_LABELS: Record<string, string> = {
  sqlalchemy: 'SQLAlchemy',
  sqlmodel: 'SQLModel',
  mongoengine: 'MongoEngine',
  jpa: 'JPA',
  efcore: 'EF Core',
  activerecord: 'ActiveRecord',
  gorm: 'GORM',
  'sea-orm': 'SeaORM',
  sqlx: 'SQLx',
};

/**
 * Derives the architecture graph: a few dozen components (pages, API
 * routes, services, models, external services) with lifted dependencies.
 *
 * Fully deterministic: classification uses framework conventions, file
 * locations and names; no AI is involved. Helper modules, hooks and
 * presentational components are hidden, and edges pass through them so
 * the map stays connected.
 */
export function deriveArchitecture(src: ArchitectureSource): ArchGraph {
  const { store } = src;
  const drafts = new Map<string, Draft>();
  const memberOf = new Map<string, string>();
  const add = (d: Draft) => {
    drafts.set(d.key, d);
    for (const m of d.members) memberOf.set(m, d.key);
  };

  // External services and models get their own components first so that
  // client-wrapper files can fold into them.
  for (const id of store.nodeIdsOfKind('external_service')) {
    const n = store.getNode(id)!;
    const category = String(n.meta?.category ?? 'api');
    add({
      key: `arch:external:${n.qualifiedName}`,
      role: 'external',
      kind: 'external_service',
      label: n.name,
      sublabel: EXTERNAL_LABEL[category] ?? 'External service',
      members: new Set([id]),
      files: new Set(),
      externalCategory: category,
      meta: { provider: n.qualifiedName, category },
    });
  }
  for (const id of store.nodeIdsOfKind('database_model')) {
    const n = store.getNode(id)!;
    if (n.file && isTestFile(n.file)) continue;
    const orm = (n.meta?.orm as string | undefined) ?? (n.meta?.table ? 'table' : undefined);
    add({
      key: `arch:model:${n.key}`,
      role: 'model',
      kind: 'database_model',
      label: n.name,
      sublabel: orm ? `${ORM_LABELS[orm] ?? titleCase([orm])} model` : 'Data model',
      domain: domainOf('', n.name),
      members: new Set([id]),
      files: new Set(n.file ? [n.file] : []),
      source: n.file && n.range ? { file: n.file, line: n.range.start, endLine: n.range.end } : undefined,
      meta: { orm, fields: n.meta?.fields, table: n.meta?.table },
    });
  }
  for (const id of store.nodeIdsOfKind('api_route')) {
    const n = store.getNode(id)!;
    if (!n.meta?.missing) continue;
    add({
      key: `arch:missing:${n.key}`,
      role: 'missing',
      kind: 'api_route',
      label: routeLabel(String(n.meta.path), 'API'),
      sublabel: `${n.meta.method} ${n.meta.path}`,
      members: new Set([id]),
      files: new Set(),
      summary: `No route handler matches ${n.meta.method} ${n.meta.path}. A caller requests it, but nothing serves it.`,
      meta: { missing: true, methods: [n.meta.method], route: n.meta.path },
    });
  }

  // One component per source file.
  const roles = new Map<string, FileRole>();
  const files = store
    .nodeIdsOfKind('file')
    .map((id) => store.getNode(id)!)
    .sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));
  for (const fileNode of files) {
    const path = fileNode.qualifiedName;
    const facts = src.getFacts(path);
    if (!facts) continue;
    const next = src.nextInfo(path);
    // ORM entity classes (and their methods) belong to their model component, not the file.
    const entityIds = claimEntities(store, path, facts, drafts, memberOf);
    const nodeIds = store.nodeIdsOfFile(path).filter((id) => store.getNode(id)?.kind !== 'database_model' && !entityIds.has(id));
    const clientProvider = clientWrapperProvider(store, path, facts);
    const declaresModels = !!facts.models?.length;
    // Schemas next to tables (pydantic beside SQLModel) keep a file a schema;
    // functions that work with the models (Go `FindOneUser`) make it data access.
    const queriesModels = facts.symbols.some((s) => {
      if ((s.kind !== 'function' && s.kind !== 'method') || entityIds.has(symbolId(path, s))) return false;
      return store.outEdges(symbolId(path, s)).some((e) => store.getNode(e.target)?.kind === 'database_model');
    });
    const isSchema =
      (declaresModels && !queriesModels) ||
      (exportedSymbols(facts).length > 0 && exportedSymbols(facts).every((s) => store.getNode(symbolId(path, s))?.kind === 'database_model'));
    // A file that declares models and also queries them (Go `models.go`, Django managers) is data access.
    const role = declaresModels && !isSchema && !isTestFile(path) ? 'repository' : classifyFile({ path, facts, next, isClientWrapper: !!clientProvider, isSchema });
    roles.set(path, role);

    if (role === 'client' && clientProvider) {
      const target = drafts.get(`arch:external:${clientProvider}`);
      if (target) {
        for (const id of nodeIds) {
          target.members.add(id);
          memberOf.set(id, target.key);
        }
        target.files.add(path);
        continue;
      }
    }
    if (role === 'test') continue;
    const effectiveRole: Exclude<FileRole, 'client' | 'schema' | 'test' | 'barrel'> = role === 'client' || role === 'schema' || role === 'barrel' ? 'module' : role;
    add(fileDraft(store, path, facts, next, effectiveRole, nodeIds));
  }

  disambiguateLabels(drafts);

  // ── lift code edges to component edges ──────────────────────────────────
  const raw = new Map<string, Map<string, RawEdge>>();
  for (const e of store.edges()) {
    if (!LIFTED_EDGES.has(e.kind)) continue;
    // Using a type is not an architectural dependency (it stays in the code graph),
    // but calling through a Java / C# / Go interface is: that is how injected services are reached.
    const target = store.getNode(e.target);
    const targetKind = target?.kind;
    const callsPort = e.kind === 'CALLS' && targetKind === 'interface' && !!target?.file && languageOfPath(target.file) !== 'js';
    if ((targetKind === 'interface' || targetKind === 'type') && e.kind !== 'IMPLEMENTS' && e.kind !== 'EXTENDS' && !callsPort) continue;
    const a = memberOf.get(e.source);
    const b = memberOf.get(e.target);
    if (!a || !b || a === b) continue;
    let out = raw.get(a);
    if (!out) raw.set(a, (out = new Map()));
    let r = out.get(b);
    if (!r) out.set(b, (r = { kinds: new Set(), weight: 0, sites: [] }));
    r.kinds.add(e.kind);
    r.weight += (e.meta?.count as number | undefined) ?? 1;
    if (e.owner && e.line && r.sites.length < MAX_SITES) r.sites.push({ file: e.owner, line: e.line });
  }

  // ── visibility ───────────────────────────────────────────────────────────
  const hasModels = [...drafts.values()].some((d) => d.role === 'model');
  const visible = new Set<string>();
  const isPassThrough = (key: string) => {
    const d = drafts.get(key)!;
    return d.role === 'hook' || d.role === 'module' || d.role === 'schema' || d.role === 'client';
  };
  /** Can `start` reach a component matching `goal` through pass-through components only? */
  const reaches = (start: string, goal: (d: Draft) => boolean, through: (key: string) => boolean): boolean => {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const next of raw.get(cur)?.keys() ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        const d = drafts.get(next)!;
        if (goal(d)) return true;
        if (through(next)) queue.push(next);
      }
    }
    return false;
  };
  const isDataOrExternal = (d: Draft) => d.role === 'model' || d.role === 'external' || d.role === 'repository';

  // Helper modules that touch data or external services act as services.
  const promoted = [...drafts.values()].filter((d) => d.role === 'module' && reaches(d.key, isDataOrExternal, isPassThrough));
  for (const d of promoted) promoteToService(d);
  for (const d of drafts.values()) {
    switch (d.role) {
      case 'page':
      case 'middleware':
      case 'api_route':
      case 'server_action':
      case 'service':
      case 'repository':
      case 'job':
      case 'model':
      case 'missing':
        visible.add(d.key);
        break;
      case 'component':
      case 'layout':
        // Visible only when it talks to the backend itself (not via child components).
        if (reaches(d.key, (t) => BACKEND_LANES.has(laneOf(t.kind)) && t.role !== 'module', isPassThrough)) visible.add(d.key);
        break;
      case 'external':
        if (!(hasModels && d.externalCategory === 'database')) visible.add(d.key);
        break;
    }
  }

  // Shared helpers used by many visible components (state stores, shared hooks,
  // API clients) are shown themselves instead of fanning out pass-through edges.
  const callers = new Map<string, Set<string>>();
  for (const [a, out] of raw) {
    if (!visible.has(a)) continue;
    for (const b of out.keys()) {
      if (!callers.has(b)) callers.set(b, new Set());
      callers.get(b)!.add(a);
    }
  }
  for (const d of drafts.values()) {
    if (visible.has(d.key) || (d.role !== 'module' && d.role !== 'hook')) continue;
    const hasOutgoing = [...(raw.get(d.key)?.keys() ?? [])].some((k) => drafts.get(k)!.role !== 'external' || visible.has(k));
    if ((callers.get(d.key)?.size ?? 0) >= HUB_CALLERS && hasOutgoing) visible.add(d.key);
  }

  // Libraries and tools have no pages, routes or services to anchor the map.
  // When framework rules find little, show modules that sit on dependency
  // paths (used by something and using something) or that many files share.
  const fileComponents = [...visible].filter((k) => k.startsWith('arch:file:')).length;
  const candidates = [...drafts.values()].filter((d) => !visible.has(d.key) && (d.role === 'module' || d.role === 'hook' || d.role === 'component' || d.role === 'layout'));
  if (fileComponents < LIBRARY_THRESHOLD && candidates.length >= LIBRARY_THRESHOLD) {
    const fileIn = new Map<string, Set<string>>();
    for (const [a, out] of raw) {
      if (!a.startsWith('arch:file:')) continue;
      for (const b of out.keys()) {
        if (!fileIn.has(b)) fileIn.set(b, new Set());
        fileIn.get(b)!.add(a);
      }
    }
    for (const d of candidates) {
      const inDeg = fileIn.get(d.key)?.size ?? 0;
      const outDeg = [...(raw.get(d.key)?.keys() ?? [])].filter((k) => k.startsWith('arch:file:')).length;
      if ((inDeg >= 1 && outDeg >= 1) || inDeg >= HUB_CALLERS) visible.add(d.key);
    }
  }

  // ── final edges (pass through hidden components) ─────────────────────────
  const edges = new Map<string, ArchEdge>();
  const addEdge = (a: string, b: string, r: RawEdge, via: string[]) => {
    if (a === b) return;
    const id = idFor(`arch-edge|${a}|${b}`);
    const existing = edges.get(id);
    if (existing) {
      for (const k of r.kinds) if (!existing.kinds.includes(k)) existing.kinds.push(k);
      existing.weight += r.weight;
      for (const v of via) if (!existing.via?.includes(v)) (existing.via ??= []).push(v);
      for (const s of r.sites) if ((existing.sites ??= []).length < MAX_SITES) existing.sites!.push(s);
      return;
    }
    const edge: ArchEdge = { id, source: a, target: b, kinds: [...r.kinds], weight: r.weight };
    if (via.length) edge.via = [...via];
    if (r.sites.length) edge.sites = [...r.sites];
    edges.set(id, edge);
  };
  for (const a of [...visible].sort()) {
    for (const [b, r] of raw.get(a) ?? []) {
      if (visible.has(b)) {
        addEdge(a, b, r, []);
        continue;
      }
      // Walk through hidden components to the visible ones they lead to.
      const seen = new Set([a, b]);
      const queue: { key: string; via: string[] }[] = [{ key: b, via: [drafts.get(b)!.label] }];
      while (queue.length) {
        const { key, via } = queue.shift()!;
        if (via.length > 4) continue;
        for (const [c, r2] of raw.get(key) ?? []) {
          if (seen.has(c)) continue;
          seen.add(c);
          if (visible.has(c)) addEdge(a, c, r2, via);
          else if (drafts.get(c)!.role !== 'external') queue.push({ key: c, via: [...via, drafts.get(c)!.label] });
        }
      }
    }
  }

  // Externals and models nobody visible uses are dropped.
  const connected = new Set<string>();
  for (const e of edges.values()) {
    connected.add(e.source);
    connected.add(e.target);
  }
  for (const key of visible) {
    const d = drafts.get(key)!;
    if ((d.role === 'external' || (d.role === 'model' && d.files.size === 0)) && !connected.has(key)) visible.delete(key);
  }

  // Externals and models have no doc comments; describe them from their usage.
  const usersOf = new Map<string, string[]>();
  for (const e of edges.values()) usersOf.set(e.target, [...(usersOf.get(e.target) ?? []), drafts.get(e.source)!.label]);
  for (const key of visible) {
    const d = drafts.get(key)!;
    if (d.summary) continue;
    const users = (usersOf.get(key) ?? []).sort();
    const usedBy = users.length ? ` Used by ${users.slice(0, 3).join(', ')}${users.length > 3 ? ` and ${users.length - 3} more` : ''}.` : '';
    if (d.role === 'external') d.summary = `${d.sublabel ?? 'External service'} (${d.label}).${usedBy}`;
    else if (d.role === 'model') {
      const fields = (d.meta.fields as string[] | undefined) ?? [];
      d.summary = `${d.sublabel ?? 'Data model'}${fields.length ? ` with fields ${fields.slice(0, 6).join(', ')}${fields.length > 6 ? ', …' : ''}` : ''}.${usedBy}`;
    }
  }

  const nodes: ArchNode[] = [...visible].sort().map((key) => toArchNode(drafts.get(key)!, raw, drafts));
  const finalEdges = [...edges.values()]
    .filter((e) => visible.has(e.source) && visible.has(e.target))
    .map((e) => ({ ...e, source: idFor(e.source), target: idFor(e.target), kinds: [...e.kinds].sort() }))
    .sort((x, y) => x.id.localeCompare(y.id));
  return { nodes, edges: finalEdges };
}

const EXTERNAL_LABEL: Record<string, string> = {
  ai: 'AI provider',
  database: 'Database',
  payments: 'Payments',
  auth: 'Auth provider',
  email: 'Email',
  storage: 'File storage',
  queue: 'Queue',
  analytics: 'Analytics',
  messaging: 'Messaging',
  search: 'Search',
  api: 'External API',
};

function promoteToService(d: Draft): void {
  d.role = 'service';
  d.kind = 'service';
}

/**
 * Moves ORM entity classes (Django / JPA / Eloquent / ActiveRecord models,
 * EF Core DbSet properties) and their methods into their model component,
 * so `order.getItems()` reads as a use of the Order model. Returns the
 * claimed node ids.
 */
function claimEntities(store: CodeGraphStore, path: string, facts: FileFacts, drafts: Map<string, Draft>, memberOf: Map<string, string>): Set<string> {
  const claimed = new Set<string>();
  for (const m of facts.models ?? []) {
    if (!m.symbol) continue;
    const draft = drafts.get(`arch:model:${keys.model(m.name)}`);
    if (!draft) continue;
    for (const s of facts.symbols) {
      if (s.qualifiedName !== m.symbol && !s.qualifiedName.startsWith(`${m.symbol}.`)) continue;
      const id = symbolId(path, s);
      if (!store.hasNode(id)) continue;
      draft.members.add(id);
      memberOf.set(id, draft.key);
      claimed.add(id);
    }
  }
  return claimed;
}

/**
 * Components from different features that share a name (vertical slices:
 * `Articles/Create.cs`, `Comments/Create.cs`) are told apart by their
 * feature folder: "Articles Create", "Comments Create".
 */
function disambiguateLabels(drafts: Map<string, Draft>): void {
  const byLabel = new Map<string, Draft[]>();
  for (const d of drafts.values()) {
    if (d.role === 'model' || d.role === 'external' || d.role === 'missing' || d.files.size !== 1) continue;
    byLabel.set(d.label, [...(byLabel.get(d.label) ?? []), d]);
  }
  for (const [label, list] of byLabel) {
    if (list.length < 2) continue;
    const folders = list.map((d) => featureFolder([...d.files][0]!));
    // Only rename when the folders actually tell them apart.
    if (folders.some((f) => !f) || new Set(folders).size !== folders.length) continue;
    list.forEach((d, i) => {
      const prefix = titleCase(words(folders[i]!));
      if (!label.startsWith(prefix)) d.label = `${prefix} ${label}`;
    });
  }
}

/** File names that say nothing on their own: `users/routes.go` is the users routes. */
const GENERIC_STEMS = new Set(['routes', 'routers', 'router', 'urls', 'views', 'handlers', 'handler', 'controller', 'controllers', 'models', 'model', 'service', 'services', 'repository', 'api', 'main', 'server', 'app', 'serializers', 'schemas', 'validators']);

/** Nearest folder that names a feature, skipping structural ones (`src`, `internal`, ...). */
function featureFolder(path: string): string | undefined {
  return path
    .split('/')
    .slice(0, -1)
    .reverse()
    .find((d) => !STRUCTURAL_DIRS.has(d.toLowerCase()) && !/^[[(@.]/.test(d));
}

/** If every exported symbol is an SDK client instance, returns its provider. */
function clientWrapperProvider(store: CodeGraphStore, path: string, facts: FileFacts): string | null {
  const exported = exportedSymbols(facts);
  if (!exported.length || facts.symbols.some((s) => s.kind === 'class' || (s.kind !== 'variable' && s.exported))) return null;
  let provider: string | null = null;
  for (const s of exported) {
    if (s.kind !== 'variable') return null;
    const ext = store
      .outEdges(symbolId(path, s), ['USES'])
      .map((e) => store.getNode(e.target))
      .find((n) => n?.kind === 'external_service');
    if (!ext) return null;
    if (provider && provider !== ext.qualifiedName) return null;
    provider = ext.qualifiedName;
  }
  return provider;
}

function primarySymbol(facts: FileFacts, role: FileRole, next: NextFileInfo | null): SymbolFact | undefined {
  const exported = exportedSymbols(facts);
  const defaultExport = facts.exports.find((e) => e.kind === 'local' && e.exported === 'default');
  const byName = (name?: string) => (name ? facts.symbols.find((s) => s.qualifiedName === name) : undefined);
  if (next && defaultExport?.kind === 'local') return byName(defaultExport.local);
  const prefer = (pred: (s: SymbolFact) => boolean) => exported.find(pred) ?? facts.symbols.find((s) => !s.parent && pred(s));
  switch (role) {
    case 'service':
    case 'repository':
      return prefer((s) => s.kind === 'class') ?? prefer((s) => s.kind === 'variable' && facts.symbols.some((m) => m.parent === s.qualifiedName)) ?? exported[0];
    case 'component':
    case 'layout':
    case 'page':
      return prefer((s) => s.kind === 'react_component') ?? exported[0];
    case 'hook':
      return prefer((s) => s.kind === 'hook') ?? exported[0];
    default:
      return exported.find((s) => s.doc) ?? exported[0] ?? facts.symbols[0];
  }
}

function fileDraft(
  store: CodeGraphStore,
  path: string,
  facts: FileFacts,
  next: NextFileInfo | null,
  role: Exclude<FileRole, 'client' | 'schema' | 'test' | 'barrel'>,
  nodeIds: string[],
): Draft {
  // Symbols claimed by another component (ORM entities) do not name or describe this file.
  const own = new Set(nodeIds);
  const visible: FileFacts = { ...facts, symbols: facts.symbols.filter((s) => own.has(symbolId(path, s))) };
  const primary = primarySymbol(visible, role, next);
  const kind = ROLE_KIND[role];
  const meta: Record<string, unknown> = {};
  let label: string;
  let sublabel: string | undefined = path;
  const routes = nodeIds.map((id) => store.getNode(id)!).filter((n) => n.kind === 'api_route');

  switch (role) {
    case 'page':
      label = routeLabel(next?.path ?? '/', 'Page');
      sublabel = next?.path;
      meta.route = next?.path;
      break;
    case 'layout':
      label = next?.path && next.path !== '/' ? routeLabel(next.path, 'Layout') : 'Root Layout';
      break;
    case 'api_route': {
      const methods = [...new Set(routes.map((r) => String(r.meta?.method)))];
      const paths = [...new Set(routes.map((r) => String(r.meta?.path)))];
      meta.methods = methods;
      meta.routes = routes.map((r) => r.name);
      if (next?.path) {
        label = routeLabel(next.path, 'API');
        sublabel = `${methods.join(' · ')} ${next.path}`;
        meta.route = next.path;
      } else {
        const stem = fileStem(path);
        const folder = GENERIC_STEMS.has(stem.toLowerCase()) ? featureFolder(path) : undefined;
        // config/routes.rb, urls.py: just "Routes", not "Routes Routes".
        label = !folder && /^(routes?|routers?|urls)$/i.test(stem) ? 'Routes' : `${titleCase(words(folder ?? stem))} Routes`;
        sublabel = paths.length === 1 ? `${methods.join(' · ')} ${paths[0]}` : `${paths.length} routes`;
      }
      break;
    }
    case 'middleware':
      label = 'Middleware';
      break;
    case 'server_action':
      label = `${titleCase(words(fileStem(path)).filter((w) => !/^actions?$/i.test(w)))} Actions`.trim();
      break;
    default: {
      const name = primary?.name;
      const useSymbolName = name && name !== 'default' && (role === 'component' || role === 'hook' || primary?.kind === 'class' || SUFFIX.test(name));
      // Classes and components keep their identifier; `paymentService` reads as "Payment Service".
      if (useSymbolName) label = /^[a-z]/.test(name) && role !== 'hook' ? titleCase(words(name)) : name;
      else {
        const stem = fileStem(path);
        const folder = GENERIC_STEMS.has(stem.toLowerCase()) ? featureFolder(path) : undefined;
        label = titleCase(words(folder ? `${folder} ${stem}` : stem));
      }
    }
  }

  const methods = primary ? visible.symbols.filter((s) => s.parent === primary.qualifiedName && s.name !== 'constructor').map((s) => s.name) : [];
  const doc = primary?.doc ?? visible.symbols.find((s) => s.exported && s.doc)?.doc;
  const summary = doc ?? describe(role, label, next, meta, methods, exportedSymbols(visible));
  meta.summaryFrom = doc ? 'doc' : 'generated';
  if (methods.length) meta.methods ??= methods;
  meta.loc = facts.loc;
  if (facts.directives.length) meta.directives = facts.directives;

  return {
    key: `arch:file:${path}`,
    role,
    kind,
    label,
    sublabel,
    domain: domainOf(path, primary?.name),
    members: new Set(nodeIds),
    files: new Set([path]),
    source: primary ? { file: path, line: primary.startLine, endLine: primary.endLine } : { file: path, line: 1 },
    summary,
    meta,
  };
}

const SUFFIX = /(Service|Repository|Client|Gateway|Manager|Controller|Store|Provider|Adapter)$/;

function describe(role: FileRole, label: string, next: NextFileInfo | null, meta: Record<string, unknown>, methods: string[], exported: SymbolFact[]): string {
  const list = (xs: string[]) => (xs.length > 5 ? `${xs.slice(0, 5).join(', ')} and ${xs.length - 5} more` : xs.join(', '));
  switch (role) {
    case 'page':
      return `Page served at ${next?.path ?? '/'}.`;
    case 'layout':
      return `Layout wrapping pages under ${next?.path ?? '/'}.`;
    case 'api_route':
      return next?.path ? `Route handler for ${(meta.methods as string[]).join(', ')} ${next.path}.` : `Registers ${(meta.routes as string[]).length} HTTP routes.`;
    case 'middleware':
      return 'Runs before matching requests reach pages and route handlers.';
    case 'server_action':
      return `Server actions: ${list(exported.map((s) => s.name))}.`;
    case 'service':
    case 'repository':
      return methods.length ? `${label} with ${methods.length} method${methods.length === 1 ? '' : 's'}: ${list(methods)}.` : `Exports ${list(exported.map((s) => s.name))}.`;
    case 'component':
      return `React component${exported.length > 1 ? 's' : ''}: ${list(exported.map((s) => s.name))}.`;
    case 'hook':
      return `React hook${exported.length > 1 ? 's' : ''}: ${list(exported.map((s) => s.name))}.`;
    case 'job':
      return `Background job: ${list(exported.map((s) => s.name))}.`;
    default:
      return exported.length ? `Module exporting ${list(exported.map((s) => s.name))}.` : 'Module.';
  }
}

function toArchNode(d: Draft, raw: Map<string, Map<string, RawEdge>>, drafts: Map<string, Draft>): ArchNode {
  const node: ArchNode = {
    id: idFor(d.key),
    key: d.key,
    kind: d.kind,
    category: categoryOf(d.kind, d.externalCategory),
    lane: laneOf(d.kind),
    label: d.label,
    members: [...d.members].sort(),
    files: [...d.files].sort(),
  };
  // Services that call AI providers directly are AI services.
  if (d.kind === 'service' || d.kind === 'module') {
    for (const target of raw.get(d.key)?.keys() ?? []) {
      const t = drafts.get(target);
      if (t?.role === 'external' && t.externalCategory === 'ai') node.category = 'ai';
    }
  }
  if (d.sublabel) node.sublabel = d.sublabel;
  if (d.domain) node.domain = d.domain;
  if (d.source) node.source = d.source;
  if (d.summary) node.summary = d.summary;
  const meta = Object.fromEntries(Object.entries(d.meta).filter(([, v]) => v !== undefined));
  if (Object.keys(meta).length) node.meta = meta;
  return node;
}
