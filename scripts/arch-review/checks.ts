import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { extname, join, posix } from 'node:path';
import type { FileFacts } from '../../packages/core/src/index.js';
import type { GraphEngine } from '../../packages/engine/src/index.js';
import type { CheckResult, Evidence, FindingInput } from './db.js';

/** Bump when a check's logic changes: findings that disappear across a bump are retired, not resolved. */
export const CHECKS_VERSION = '2';

/** What each check looks for. None of them needs a design document: they hold for any codebase. */
export const CHECKS: Record<string, string> = {
  'pkg.cycle': 'Workspace packages that depend on each other in a cycle (runtime imports only)',
  'pkg.browser-node-import': 'Code reachable from a browser bundle that imports a Node built-in',
  'pkg.undeclared-dependency': 'A package imports something its package.json does not declare',
  'pkg.unused-dependency': 'A package declares a dependency that nothing in it uses',
  'pkg.relative-cross-import': 'A relative import that reaches into another package, bypassing its package.json and public entry',
  'pkg.untested': 'A package with real source and no tests of its own',
  'file.cycle': 'Source files that import each other in a cycle (type-only imports ignored)',
  'file.unreferenced': 'A source file that no other file imports and that is not an entry point',
  'file.test-only': 'A source file imported only by tests',
  'file.large': 'A source file much larger than the rest of the codebase (review candidate, not a defect)',
  'symbol.duplicate-export': 'The same name defined and exported in several files',
  'symbol.unused-export': 'An exported function, class or value that no other file uses',
  'symbol.test-only-export': 'An exported function, class or value that only tests use',
};

interface Manifest {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  exports?: unknown;
  main?: unknown;
  bin?: unknown;
}

interface Workspace {
  /** Repo-relative directory, e.g. `packages/core`. */
  dir: string;
  name: string;
  deps: Set<string>;
  devDeps: Set<string>;
  /** Files the outside world starts from: package exports, bins, and scripts named in index.html. */
  entries: Set<string>;
  manifest: string;
  /** Bundled for the browser (has an index.html). */
  browser: boolean;
}

/** One import or re-export statement, resolved to the file it reaches. */
interface ImportSite {
  from: string;
  to: string;
  source: string;
  line: number;
  typeOnly: boolean;
}

interface Ctx {
  root: string;
  engine: GraphEngine;
  files: string[];
  workspaces: Workspace[];
  rootDevDeps: Set<string>;
  /** Statement-level imports. The code graph merges all imports between two files into one edge. */
  edges: ImportSite[];
  resolve: (from: string, spec: string) => string | undefined;
}

export interface PackageGraphs {
  declared: [string, string, 'dep' | 'dev'][];
  /** What source files import: `types` when every import of that package is type-only. */
  actual: [string, string, 'runtime' | 'types'][];
}

export interface ScanOutput {
  results: CheckResult[];
  snapshot: string;
  stats: { files: number; workspaces: string[]; packageGraph: PackageGraphs; graph: Record<string, number | undefined> };
}

const RUNTIME_SYMBOLS = new Set(['function', 'class', 'variable', 'react_component', 'hook']);
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.vite', '.turbo']);

const inScope = (p: string) => /^(packages|apps)\/[^/]+\//.test(p);
export const isTest = (p: string) => /(^|\/)test\/|\.(test|spec)\.[cm]?[jt]sx?$/.test(p);
const isConfig = (p: string) => /(^|\/)[^/]+\.config\.[cm]?[jt]s$/.test(p);
const isSource = (p: string) => p.includes('/src/') && !isTest(p);

/** `@scope/name/sub` → `@scope/name`; relative paths, aliases and Node built-ins → null. */
export function packageName(spec: string): string | null {
  const s = spec.split('?')[0]!;
  if (!s || /^[./#~]/.test(s) || s.startsWith('@/') || s.startsWith('virtual:') || isBuiltin(s)) return null;
  const parts = s.split('/');
  if (s.startsWith('@')) return parts.length > 1 ? `${parts[0]}/${parts[1]}` : null;
  return parts[0]!;
}

function importsOf(facts: FileFacts): { source: string; line: number; typeOnly: boolean }[] {
  const out = facts.imports.map((i) => ({
    source: i.source,
    line: i.line,
    typeOnly: i.typeOnly || (i.specifiers.length > 0 && i.specifiers.every((s) => s.typeOnly === true)),
  }));
  for (const e of facts.exports) if ('source' in e) out.push({ source: e.source, line: e.line, typeOnly: false });
  return out;
}

function lineOf(text: string, needle: string): number {
  const i = text.split('\n').findIndex((l) => l.includes(needle));
  return i < 0 ? 1 : i + 1;
}

function loadWorkspaces(root: string): Workspace[] {
  const out: Workspace[] = [];
  for (const group of ['packages', 'apps']) {
    const base = join(root, group);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base).sort()) {
      const dir = `${group}/${entry}`;
      const manifestPath = join(root, dir, 'package.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = readFileSync(manifestPath, 'utf8');
      const pkg = JSON.parse(manifest) as Manifest;
      const entries = new Set<string>();
      const addEntry = (p: unknown): void => {
        if (typeof p === 'string') entries.add(`${dir}/${p.replace(/^\.\//, '')}`);
        else if (p && typeof p === 'object') for (const v of Object.values(p)) addEntry(v);
      };
      addEntry(pkg.exports);
      addEntry(pkg.main);
      addEntry(pkg.bin);
      const html = join(root, dir, 'index.html');
      const browser = existsSync(html);
      if (browser) for (const m of readFileSync(html, 'utf8').matchAll(/<script[^>]*\ssrc="\/?([^"]+)"/g)) entries.add(`${dir}/${m[1]}`);
      out.push({
        dir,
        name: pkg.name ?? dir,
        deps: new Set(Object.keys(pkg.dependencies ?? {})),
        devDeps: new Set(Object.keys(pkg.devDependencies ?? {})),
        entries,
        manifest,
        browser,
      });
    }
  }
  return out;
}

/** Strongly connected components with more than one member (Tarjan). */
function cycles(nodes: Iterable<string>, next: (n: string) => Iterable<string>): string[][] {
  let i = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const out: string[][] = [];
  const visit = (v: string): void => {
    index.set(v, i);
    low.set(v, i);
    i++;
    stack.push(v);
    onStack.add(v);
    for (const w of next(v)) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      const c: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        c.push(w);
      } while (w !== v);
      if (c.length > 1) out.push(c.sort());
    }
  };
  for (const n of nodes) if (!index.has(n)) visit(n);
  return out;
}

/**
 * Whether a dependency is referenced anywhere in the package other than an import:
 * a path string (`'tree-sitter-go/x.wasm'`), a CSS `@import`, a config file.
 */
function mentionedInPackage(root: string, dir: string, dep: string): boolean {
  const walk = (rel: string): boolean => {
    for (const name of readdirSync(join(root, rel))) {
      const child = `${rel}/${name}`;
      const st = statSync(join(root, child));
      if (st.isDirectory()) {
        if (!IGNORED_DIRS.has(name) && walk(child)) return true;
      } else if (name !== 'package.json' && ['.css', '.scss', '.html', '.json', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'].includes(extname(name))) {
        if (st.size < 512_000 && readFileSync(join(root, child), 'utf8').includes(dep)) return true;
      }
    }
    return false;
  };
  return walk(dir);
}

/** Peer dependencies of what a package installs: needed without ever being imported (`graphology` → `graphology-types`). */
function peersOf(root: string, ws: Workspace): Set<string> {
  const out = new Set<string>();
  for (const dep of ws.deps) {
    const manifest = join(root, ws.dir, 'node_modules', dep, 'package.json');
    if (!existsSync(manifest)) continue;
    const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { peerDependencies?: Record<string, string> };
    for (const peer of Object.keys(pkg.peerDependencies ?? {})) out.add(peer);
  }
  return out;
}

/**
 * Which exported names of each file other files use, following imports by name,
 * namespace and dynamic imports, and re-exports through barrels.
 * Returns file → exported name ('*' = all) → importing files.
 */
function exportUsers(ctx: Ctx): Map<string, Map<string, Set<string>>> {
  const users = new Map<string, Map<string, Set<string>>>();
  const queue: [file: string, name: string, importer: string][] = [];
  for (const path of ctx.engine.index.files) {
    for (const imp of ctx.engine.index.getFacts(path)?.imports ?? []) {
      const to = ctx.resolve(path, imp.source);
      if (!to) continue;
      if (imp.dynamic || imp.wildcard || !imp.specifiers.length) queue.push([to, '*', path]);
      for (const spec of imp.specifiers) queue.push([to, spec.imported, path]);
    }
  }
  while (queue.length) {
    const [file, name, importer] = queue.pop()!;
    const byName = users.get(file) ?? new Map<string, Set<string>>();
    users.set(file, byName);
    const set = byName.get(name) ?? new Set<string>();
    if (set.has(importer)) continue;
    set.add(importer);
    byName.set(name, set);
    // Follow the name through this file's re-exports to where it is defined.
    const facts = ctx.engine.index.getFacts(file);
    if (!facts) continue;
    const local = new Set(facts.exports.filter((e) => e.kind === 'local').map((e) => e.exported));
    for (const e of facts.exports) {
      const to = e.kind === 'local' ? undefined : ctx.resolve(file, e.source);
      if (!to) continue;
      if (e.kind === 'reexport' && (name === '*' || e.exported === name)) queue.push([to, e.imported, importer]);
      else if (e.kind === 'reexport-all' && (name === '*' || !local.has(name))) queue.push([to, name, importer]);
      else if (e.kind === 'reexport-namespace' && (name === '*' || e.exported === name)) queue.push([to, '*', importer]);
    }
  }
  return users;
}

// ── checks ─────────────────────────────────────────────────────────────────

function packageGraphs(ctx: Ctx): { graphs: PackageGraphs; sites: Map<string, Map<string, Evidence>> } {
  const names = new Set(ctx.workspaces.map((w) => w.name));
  const declared: PackageGraphs['declared'] = [];
  for (const w of ctx.workspaces) {
    for (const d of w.deps) if (names.has(d)) declared.push([w.name, d, 'dep']);
    for (const d of w.devDeps) if (names.has(d)) declared.push([w.name, d, 'dev']);
  }
  /** Runtime imports only: these are what can form a cycle at load time. */
  const sites = new Map<string, Map<string, Evidence>>();
  const typeUses = new Map<string, Set<string>>();
  for (const path of ctx.files) {
    if (!isSource(path)) continue;
    const ws = wsOf(ctx, path);
    const facts = ctx.engine.index.getFacts(path);
    if (!ws || !facts) continue;
    for (const imp of importsOf(facts)) {
      const dep = packageName(imp.source);
      if (!dep || dep === ws.name || !names.has(dep)) continue;
      if (imp.typeOnly) {
        typeUses.set(ws.name, (typeUses.get(ws.name) ?? new Set()).add(dep));
        continue;
      }
      const m = sites.get(ws.name) ?? new Map<string, Evidence>();
      if (!m.has(dep)) m.set(dep, { file: path, line: imp.line });
      sites.set(ws.name, m);
    }
  }
  const actual: PackageGraphs['actual'] = [];
  for (const [from, m] of sites) for (const to of m.keys()) actual.push([from, to, 'runtime']);
  for (const [from, deps] of typeUses) for (const to of deps) if (!sites.get(from)?.has(to)) actual.push([from, to, 'types']);
  return { graphs: { declared: declared.sort(), actual: actual.sort() }, sites };
}

function wsOf(ctx: Ctx, path: string): Workspace | undefined {
  return ctx.workspaces.find((w) => path.startsWith(`${w.dir}/`));
}

function checkPackageCycles(ctx: Ctx): FindingInput[] {
  const { sites } = packageGraphs(ctx);
  return cycles(ctx.workspaces.map((w) => w.name), (n) => sites.get(n)?.keys() ?? []).map((members) => {
    const evidence: Evidence[] = [];
    for (const a of members) for (const [b, site] of sites.get(a) ?? []) if (members.includes(b)) evidence.push({ ...site, note: `${a} → ${b}` });
    return { check: 'pkg.cycle', title: `Packages depend on each other in a cycle: ${members.join(', ')}`, severity: 'error', subjects: members, evidence };
  });
}

function checkBrowserNodeImports(ctx: Ctx): FindingInput[] {
  const out: FindingInput[] = [];
  const next = new Map<string, ImportSite[]>();
  for (const e of ctx.edges) if (!e.typeOnly && e.from !== e.to) next.set(e.from, [...(next.get(e.from) ?? []), e]);
  for (const ws of ctx.workspaces.filter((w) => w.browser)) {
    const parent = new Map<string, ImportSite | null>();
    const queue = ctx.files.filter((p) => p.startsWith(`${ws.dir}/`) && isSource(p));
    for (const f of queue) parent.set(f, null);
    while (queue.length) {
      const cur = queue.shift()!;
      for (const e of next.get(cur) ?? []) {
        if (parent.has(e.to)) continue;
        parent.set(e.to, e);
        queue.push(e.to);
      }
    }
    for (const file of parent.keys()) {
      const facts = ctx.engine.index.getFacts(file);
      if (!facts) continue;
      for (const imp of importsOf(facts)) {
        if (imp.typeOnly || !isBuiltin(imp.source.split('?')[0]!)) continue;
        const chain: string[] = [];
        for (let e = parent.get(file); e; e = parent.get(e.from)) chain.unshift(`${e.from}:${e.line}`);
        out.push({
          check: 'pkg.browser-node-import',
          title: `${ws.name} can reach ${file}, which imports the Node built-in "${imp.source}"`,
          severity: 'error',
          subjects: [ws.name, file, imp.source],
          evidence: [{ file, line: imp.line }],
          detail: { importChain: chain },
        });
      }
    }
  }
  return out;
}

function checkUndeclared(ctx: Ctx): FindingInput[] {
  const groups = new Map<string, { ws: Workspace; dep: string; tooling: boolean; sites: Evidence[]; typeOnly: boolean }>();
  for (const path of ctx.files) {
    const ws = wsOf(ctx, path);
    const facts = ctx.engine.index.getFacts(path);
    if (!ws || !facts) continue;
    const tooling = isTest(path) || isConfig(path);
    for (const imp of importsOf(facts)) {
      const dep = packageName(imp.source);
      if (!dep || dep === ws.name || ws.deps.has(dep)) continue;
      if (tooling && (ws.devDeps.has(dep) || ctx.rootDevDeps.has(dep))) continue;
      const key = `${ws.dir}|${dep}|${tooling}`;
      const g = groups.get(key) ?? { ws, dep, tooling, sites: [], typeOnly: true };
      g.sites.push({ file: path, line: imp.line });
      g.typeOnly &&= imp.typeOnly;
      groups.set(key, g);
    }
  }
  return [...groups.values()].map((g) => ({
    check: 'pkg.undeclared-dependency',
    title:
      !g.tooling && g.ws.devDeps.has(g.dep)
        ? `${g.ws.name} uses ${g.dep} in source but declares it only in devDependencies`
        : `${g.ws.name} imports ${g.dep} without declaring it${g.tooling ? ' (tests or config)' : ''}`,
    severity: g.tooling || g.typeOnly ? 'info' : 'warning',
    subjects: [g.ws.name, g.dep, g.tooling ? 'tooling' : 'source'],
    evidence: g.sites.slice(0, 6),
    detail: { sites: g.sites.length, typeOnly: g.typeOnly },
  }));
}

function checkUnusedDependencies(ctx: Ctx): FindingInput[] {
  const out: FindingInput[] = [];
  const names = new Set(ctx.workspaces.map((w) => w.name));
  for (const ws of ctx.workspaces) {
    const used = peersOf(ctx.root, ws);
    for (const path of ctx.files) {
      if (!path.startsWith(`${ws.dir}/`)) continue;
      const facts = ctx.engine.index.getFacts(path);
      if (facts) for (const imp of importsOf(facts)) used.add(packageName(imp.source) ?? '');
    }
    const report = (dep: string, dev: boolean) => {
      if (used.has(dep) || mentionedInPackage(ctx.root, ws.dir, dep)) return;
      out.push({
        check: 'pkg.unused-dependency',
        title: `${ws.name} declares ${dep}${dev ? ' (dev)' : ''} but nothing in the package uses it`,
        severity: names.has(dep) && !dev ? 'warning' : 'info',
        subjects: [ws.name, dep, dev ? 'dev' : 'runtime'],
        evidence: [{ file: `${ws.dir}/package.json`, line: lineOf(ws.manifest, `"${dep}"`) }],
      });
    };
    for (const dep of ws.deps) report(dep, false);
    // Only workspace devDependencies: tooling packages (types, bundlers) are used without being imported.
    for (const dep of ws.devDeps) if (names.has(dep)) report(dep, true);
  }
  return out;
}

function checkRelativeCrossImports(ctx: Ctx): FindingInput[] {
  const groups = new Map<string, { from: Workspace; to: Workspace; sites: Evidence[]; tooling: boolean }>();
  for (const e of ctx.edges) {
    const from = wsOf(ctx, e.from);
    const to = wsOf(ctx, e.to);
    if (!from || !to || from === to || !e.source.startsWith('.')) continue;
    const key = `${from.dir}|${to.dir}`;
    const g = groups.get(key) ?? { from, to, sites: [], tooling: true };
    g.sites.push({ file: e.from, line: e.line, note: `→ ${e.to}` });
    g.tooling &&= isTest(e.from) || isConfig(e.from);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({
    check: 'pkg.relative-cross-import',
    title: `${g.from.name} reaches into ${g.to.name} by relative path${g.tooling ? ' (tests)' : ''}`,
    severity: g.tooling ? 'info' : 'warning',
    subjects: [g.from.name, g.to.name],
    evidence: g.sites.slice(0, 6),
    detail: { sites: g.sites.length },
  }));
}

function checkUntested(ctx: Ctx): FindingInput[] {
  const out: FindingInput[] = [];
  for (const ws of ctx.workspaces) {
    const mine = ctx.files.filter((p) => p.startsWith(`${ws.dir}/`));
    const src = mine.filter(isSource);
    const loc = src.reduce((n, p) => n + (ctx.engine.index.getFacts(p)?.loc ?? 0), 0);
    if (loc < 100 || mine.some(isTest)) continue;
    const biggest = [...src].sort((a, b) => (ctx.engine.index.getFacts(b)?.loc ?? 0) - (ctx.engine.index.getFacts(a)?.loc ?? 0))[0]!;
    out.push({
      check: 'pkg.untested',
      title: `${ws.name} has ${loc} lines of source and no tests of its own`,
      severity: 'warning',
      subjects: [ws.name],
      evidence: [{ file: biggest, line: 1 }],
      detail: { loc, files: src.length },
    });
  }
  return out;
}

function checkFileCycles(ctx: Ctx): FindingInput[] {
  const next = new Map<string, ImportSite[]>();
  for (const e of ctx.edges) if (!e.typeOnly && e.from !== e.to && inScope(e.from) && inScope(e.to)) next.set(e.from, [...(next.get(e.from) ?? []), e]);
  return cycles(next.keys(), (n) => (next.get(n) ?? []).map((e) => e.to)).map((members) => ({
    check: 'file.cycle',
    title: `${members.length} files import each other in a cycle`,
    severity: 'warning',
    subjects: members,
    evidence: members
      .flatMap((m) => (next.get(m) ?? []).filter((e) => members.includes(e.to)).map((e) => ({ file: e.from, line: e.line, note: `imports ${e.to}` })))
      .slice(0, 8),
  }));
}

function checkUnreferenced(ctx: Ctx): FindingInput[] {
  const out: FindingInput[] = [];
  const importers = new Map<string, ImportSite[]>();
  for (const e of ctx.edges) if (e.from !== e.to) importers.set(e.to, [...(importers.get(e.to) ?? []), e]);
  const entries = new Set(ctx.workspaces.flatMap((w) => [...w.entries]));
  for (const path of ctx.files) {
    if (!isSource(path) || isConfig(path) || path.endsWith('.d.ts') || entries.has(path)) continue;
    const inc = importers.get(path) ?? [];
    if (!inc.length) {
      out.push({ check: 'file.unreferenced', title: `Nothing imports ${path}`, severity: 'info', subjects: [path], evidence: [{ file: path, line: 1 }] });
    } else if (inc.every((e) => isTest(e.from))) {
      out.push({
        check: 'file.test-only',
        title: `Only tests import ${path}`,
        severity: 'info',
        subjects: [path],
        evidence: [{ file: path, line: 1 }, ...inc.slice(0, 3).map((e) => ({ file: e.from, line: e.line }))],
      });
    }
  }
  return out;
}

function checkLarge(ctx: Ctx): FindingInput[] {
  const sizes = ctx.files.filter(isSource).map((p) => [p, ctx.engine.index.getFacts(p)?.loc ?? 0] as const);
  const sorted = sizes.map(([, n]) => n).sort((a, b) => a - b);
  const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
  const threshold = Math.max(400, p90);
  return sizes
    .filter(([, n]) => n >= threshold)
    .map(([p, n]) => ({
      check: 'file.large',
      title: `${p} has ${n} lines`,
      severity: 'info' as const,
      subjects: [p],
      evidence: [{ file: p, line: 1 }],
      detail: { loc: n, threshold },
    }));
}

function checkDuplicateExports(ctx: Ctx): FindingInput[] {
  const by = new Map<string, Evidence[]>();
  for (const path of ctx.files) {
    if (!isSource(path)) continue;
    for (const s of ctx.engine.index.getFacts(path)?.symbols ?? []) {
      if (!s.exported || s.parent || s.name === 'default' || !RUNTIME_SYMBOLS.has(s.kind)) continue;
      by.set(s.name, [...(by.get(s.name) ?? []), { file: path, line: s.startLine }]);
    }
  }
  const out: FindingInput[] = [];
  for (const [name, sites] of by) {
    const files = new Set(sites.map((s) => s.file));
    if (files.size < 2) continue;
    out.push({ check: 'symbol.duplicate-export', title: `${name} is defined and exported in ${files.size} files`, severity: 'info', subjects: [name], evidence: sites.slice(0, 6) });
  }
  return out;
}

function checkUnusedExports(ctx: Ctx): FindingInput[] {
  const usersByFile = exportUsers(ctx);
  const out: FindingInput[] = [];
  for (const path of ctx.files) {
    if (!isSource(path)) continue;
    const facts = ctx.engine.index.getFacts(path);
    const byName = usersByFile.get(path);
    for (const s of facts?.symbols ?? []) {
      if (!s.exported || s.parent || !RUNTIME_SYMBOLS.has(s.kind)) continue;
      const exportedAs = facts!.exports.flatMap((e) => (e.kind === 'local' && e.local === s.name ? [e.exported] : []));
      const users = [...new Set([...(byName?.get('*') ?? []), ...exportedAs.flatMap((n) => [...(byName?.get(n) ?? [])])])].filter((f) => f !== path);
      const evidence = [{ file: path, line: s.startLine }];
      if (!users.length) out.push({ check: 'symbol.unused-export', title: `${s.qualifiedName} (${path}) is exported but no other file uses it`, severity: 'info', subjects: [path, s.qualifiedName], evidence });
      else if (users.every(isTest))
        out.push({ check: 'symbol.test-only-export', title: `${s.qualifiedName} (${path}) is used only by tests`, severity: 'info', subjects: [path, s.qualifiedName], evidence });
    }
  }
  return out;
}

/** Each runner lists every check id it emits, so a failure marks all of them as unknown. */
const RUNNERS: [string[], (ctx: Ctx) => FindingInput[]][] = [
  [['pkg.cycle'], checkPackageCycles],
  [['pkg.browser-node-import'], checkBrowserNodeImports],
  [['pkg.undeclared-dependency'], checkUndeclared],
  [['pkg.unused-dependency'], checkUnusedDependencies],
  [['pkg.relative-cross-import'], checkRelativeCrossImports],
  [['pkg.untested'], checkUntested],
  [['file.cycle'], checkFileCycles],
  [['file.unreferenced', 'file.test-only'], checkUnreferenced],
  [['file.large'], checkLarge],
  [['symbol.duplicate-export'], checkDuplicateExports],
  [['symbol.unused-export', 'symbol.test-only-export'], checkUnusedExports],
];

/** Runs every check against an engine that has finished indexing `root`. */
export function runChecks(engine: GraphEngine, root: string): ScanOutput {
  const store = engine.index.store;
  const files = [...engine.index.files].filter(inScope).sort();
  const workspaces = loadWorkspaces(root);
  const byName = new Map(workspaces.map((w) => [w.name, w]));

  // The code graph knows which files each file reaches; match each statement's specifier to one of them.
  const reaches = new Map<string, Set<string>>();
  for (const e of store.edges()) {
    if (e.kind !== 'IMPORTS') continue;
    const from = store.getNode(e.source)?.file;
    const to = store.getNode(e.target)?.file;
    if (from && to) reaches.set(from, (reaches.get(from) ?? new Set()).add(to));
  }
  const strip = (p: string) => p.replace(/(\.d)?\.[cm]?[jt]sx?$/, '');
  const resolve = (from: string, spec: string): string | undefined => {
    const targets = reaches.get(from);
    if (!targets) return undefined;
    if (spec.startsWith('.')) {
      const base = strip(posix.normalize(posix.join(posix.dirname(from), spec.split('?')[0]!)));
      for (const t of targets) if (strip(t) === base || strip(t) === `${base}/index`) return t;
      return undefined;
    }
    const ws = byName.get(packageName(spec) ?? '');
    if (!ws) return undefined;
    for (const t of targets) if (ws.entries.has(t)) return t;
    for (const t of targets) if (t.startsWith(`${ws.dir}/`)) return t;
    return undefined;
  };
  const edges: ImportSite[] = [];
  for (const path of engine.index.files) {
    const facts = engine.index.getFacts(path);
    if (!facts) continue;
    for (const imp of importsOf(facts)) {
      const to = resolve(path, imp.source);
      if (to) edges.push({ from: path, to, source: imp.source, line: imp.line, typeOnly: imp.typeOnly });
    }
  }
  const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Manifest;
  const ctx: Ctx = { root, engine, files, workspaces, rootDevDeps: new Set(Object.keys(rootManifest.devDependencies ?? {})), edges, resolve };

  const results: CheckResult[] = [];
  for (const [ids, run] of RUNNERS) {
    try {
      const findings = run(ctx);
      for (const id of ids) results.push({ check: id, ok: true, findings: findings.filter((f) => f.check === id) });
    } catch (err) {
      for (const id of ids) results.push({ check: id, ok: false, error: (err as Error).message, findings: [] });
    }
  }

  const snapshot = createHash('sha256')
    .update(files.map((p) => `${p}:${engine.index.getFacts(p)?.hash ?? ''}`).join('\n'))
    .digest('hex')
    .slice(0, 16);
  return {
    results,
    snapshot,
    stats: {
      files: files.length,
      workspaces: ctx.workspaces.map((w) => w.name),
      packageGraph: packageGraphs(ctx).graphs,
      graph: { nodes: engine.stats.nodes, edges: engine.stats.edges, archNodes: engine.stats.archNodes, archEdges: engine.stats.archEdges },
    },
  };
}
