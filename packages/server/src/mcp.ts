/**
 * Eyrie as an MCP server, for coding agents (Claude Code, Codex, Cursor, …):
 * `eyrie mcp [path]` speaks the Model Context Protocol over stdio.
 *
 * Every tool is read-only ("Eyrie reads; your editor writes") and answers
 * from the live graph, so an agent can ask what a file belongs to and what
 * depends on it before an edit, and what its edits changed afterwards. Answers
 * are facts from parsed code; AI notes on commits are returned as labelled notes.
 *
 * The protocol is newline-delimited JSON-RPC 2.0 on stdin/stdout; stdout carries
 * nothing else, so logging goes to stderr.
 */
import { createInterface } from 'node:readline';
import { isAbsolute, relative, sep } from 'node:path';
import type { ArchEdge, ArchNode } from '@eyrie/core';
import type { EngineBatch, GraphEngine } from '@eyrie/engine';
import { commitView, type ProjectKnowledge } from '@eyrie/knowledge';
import { archPath, focusSet, impactOf, matches } from '@eyrie/lens';

/** Protocol revisions this server speaks, newest first. */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS = `Eyrie keeps a live architecture map of this repository: components (pages, API routes, services, data models, external services…) in lanes ui → edge → api → logic → data → external, and the links between them. Every link comes from parsed code, and the map updates as files are saved.
Before editing, call components_for_files with the files you plan to change, and impact on the components involved, to see what depends on them. After editing, call recent_changes to see what your edits changed in the architecture: new or removed components and links you may not have intended.
Refer to a component by the id these tools return; a name or file path works when it is unambiguous. commit_history includes AI notes on commits when the user turned them on; those are labelled opinions, not facts.`;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

type JsonRpcResponse = { jsonrpc: '2.0'; id: string | number | null } & ({ result: unknown } | { error: { code: number; message: string } });

interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>) => unknown;
}

/** A tool's answer when a component reference matches several components, or none. */
class LookupError extends Error {
  constructor(
    message: string,
    readonly candidates: unknown[] = [],
  ) {
    super(message);
  }
}

/** One engine batch, kept in architecture terms for `recent_changes`. */
interface ChangeRecord {
  seq: number;
  at: string;
  files: { file: string; change: string }[];
  componentsAdded: ComponentBrief[];
  componentsRemoved: ComponentBrief[];
  componentsChanged: ComponentBrief[];
  linksAdded: { from: string; to: string; kinds: string[] }[];
  linksRemoved: { from: string; to: string }[];
}

interface ComponentBrief {
  id: string;
  label: string;
  kind: string;
  lane: string;
}

const brief = (n: ArchNode): ComponentBrief => ({ id: n.id, label: n.label, kind: n.kind, lane: n.lane });
const MAX_CHANGES = 200;

export interface McpOptions {
  /** The project's engine. It may still be indexing: tool calls wait for `ready`. */
  engine: GraphEngine;
  /** Resolves once the engine has indexed, with the project's knowledge when it has one. */
  ready: Promise<{ knowledge?: ProjectKnowledge }>;
  version: string;
}

/** Handles MCP messages for one project. Transport-free, so it is tested without stdio. */
export class EyrieMcp {
  private readonly changes: ChangeRecord[] = [];
  /** Labels of components seen so far, to name removed ones. */
  private readonly known = new Map<string, ComponentBrief>();
  private readonly edgesSeen = new Map<string, { source: string; target: string }>();
  private readonly tools: Tool[];
  private readonly onBatch = (batch: EngineBatch) => this.recordBatch(batch);
  private readonly ready: Promise<void>;
  private knowledge?: ProjectKnowledge;

  constructor(private readonly opts: McpOptions) {
    // initialize and tools/list are answered at once; tool calls wait for the index.
    this.ready = opts.ready.then((r) => {
      this.knowledge = r.knowledge;
      for (const n of opts.engine.architecture.nodes) this.known.set(n.id, brief(n));
      for (const e of opts.engine.architecture.edges) this.edgesSeen.set(e.id, e);
    });
    this.ready.catch(() => {});
    opts.engine.on('batch', this.onBatch);
    this.tools = this.defineTools();
  }

  dispose(): void {
    this.opts.engine.off('batch', this.onBatch);
  }

  /** Answers one JSON-RPC message; null for notifications, which get no answer. */
  async handle(message: unknown): Promise<JsonRpcResponse | null> {
    const req = message as Partial<JsonRpcRequest> | null;
    if (!req || typeof req !== 'object' || req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
      return { jsonrpc: '2.0', id: (req as { id?: string | number } | null)?.id ?? null, error: { code: -32600, message: 'Invalid request' } };
    }
    const id = req.id;
    if (id === undefined) return null; // notifications/initialized, notifications/cancelled, …
    const reply = (result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result });
    const fail = (code: number, text: string): JsonRpcResponse => ({ jsonrpc: '2.0', id, error: { code, message: text } });
    const params = req.params ?? {};

    switch (req.method) {
      case 'initialize': {
        const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
        return reply({
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'eyrie', title: 'Eyrie', version: this.opts.version },
          instructions: INSTRUCTIONS,
        });
      }
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({
          tools: this.tools.map(({ name, title, description, inputSchema }) => ({
            name,
            title,
            description,
            inputSchema,
            annotations: { title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
          })),
        });
      case 'tools/call': {
        const tool = this.tools.find((t) => t.name === params.name);
        if (!tool) return fail(-32602, `Unknown tool: ${String(params.name)}`);
        try {
          await this.ready;
        } catch (err) {
          return reply({ content: [{ type: 'text', text: `Eyrie could not index this project: ${(err as Error).message}` }], isError: true });
        }
        return reply(this.callTool(tool, (params.arguments as Record<string, unknown> | undefined) ?? {}));
      }
      default:
        return fail(-32601, `Method not found: ${req.method}`);
    }
  }

  private callTool(tool: Tool, args: Record<string, unknown>): ToolResult {
    try {
      return { content: [{ type: 'text', text: JSON.stringify(tool.run(args), null, 1) }] };
    } catch (err) {
      const body = err instanceof LookupError ? { error: err.message, candidates: err.candidates } : { error: (err as Error).message };
      return { content: [{ type: 'text', text: JSON.stringify(body, null, 1) }], isError: true };
    }
  }

  // ── lookups ─────────────────────────────────────────────────────────────

  private get nodes(): Map<string, ArchNode> {
    return new Map(this.opts.engine.architecture.nodes.map((n) => [n.id, n]));
  }

  private get edges(): ArchEdge[] {
    return this.opts.engine.architecture.edges;
  }

  /** A path as the graph stores it: relative to the project, with forward slashes. */
  private relativeFile(file: string): string {
    const root = this.opts.engine.root;
    const rel = isAbsolute(file) ? relative(root, file) : file;
    return rel.split(sep).join('/').replace(/^\.\//, '');
  }

  /** A component by id, exact name, file path, or an unambiguous search. */
  private resolve(ref: unknown): ArchNode {
    if (typeof ref !== 'string' || !ref.trim()) throw new Error('Give a component id, name or file path.');
    const nodes = [...this.nodes.values()];
    const byId = nodes.find((n) => n.id === ref);
    if (byId) return byId;
    const pick = (list: ArchNode[], how: string): ArchNode | null => {
      if (list.length === 1) return list[0]!;
      if (list.length > 1) throw new LookupError(`"${ref}" ${how} ${list.length} components. Call again with one of these ids.`, list.slice(0, 15).map((n) => ({ ...brief(n), sublabel: n.sublabel })));
      return null;
    };
    const lower = ref.trim().toLowerCase();
    const file = this.relativeFile(ref.trim());
    const found =
      pick(nodes.filter((n) => n.label.toLowerCase() === lower), 'names') ??
      pick(nodes.filter((n) => n.files.includes(file)), 'is a file of') ??
      pick(nodes.filter((n) => matches(n, ref)), 'matches');
    if (found) return found;
    throw new LookupError(`No component matches "${ref}". Use find_components or architecture_overview to see what exists.`);
  }

  private link(e: ArchEdge, other: string, nodes: Map<string, ArchNode>) {
    const n = nodes.get(other);
    return {
      id: other,
      label: n?.label ?? other,
      lane: n?.lane,
      kinds: e.kinds,
      weight: e.weight,
      ...(e.via?.length ? { via: e.via.map((v) => nodes.get(v)?.label ?? v) } : {}),
      ...(e.sites?.length ? { sites: e.sites.slice(0, 3).map((s) => `${s.file}:${s.line}`) } : {}),
    };
  }

  // ── live changes ────────────────────────────────────────────────────────

  private recordBatch(batch: EngineBatch): void {
    const a = batch.architecture;
    const name = (id: string): ComponentBrief => this.known.get(id) ?? { id, label: id, kind: 'unknown', lane: 'unknown' };
    const label = (id: string) => this.known.get(id)?.label ?? id;
    for (const n of [...a.addedNodes, ...a.updatedNodes]) this.known.set(n.id, brief(n));
    const record: ChangeRecord = {
      seq: batch.seq,
      at: new Date(batch.at).toISOString(),
      files: batch.files.map((f) => ({ file: f.file, change: f.change })),
      componentsAdded: a.addedNodes.map(brief),
      componentsRemoved: a.removedNodes.map(name),
      componentsChanged: a.updatedNodes.map(brief),
      linksAdded: a.addedEdges.map((e) => ({ from: label(e.source), to: label(e.target), kinds: e.kinds })),
      linksRemoved: a.removedEdges.map((id) => {
        const e = this.edgesSeen.get(id);
        return e ? { from: label(e.source), to: label(e.target) } : { from: id, to: '?' };
      }),
    };
    for (const e of [...a.addedEdges, ...a.updatedEdges]) this.edgesSeen.set(e.id, e);
    this.changes.push(record);
    if (this.changes.length > MAX_CHANGES) this.changes.shift();
  }

  // ── tools ───────────────────────────────────────────────────────────────

  private defineTools(): Tool[] {
    const component = { type: 'string', description: 'A component id from another tool, or its exact name, or one of its file paths' };
    return [
      {
        name: 'architecture_overview',
        title: 'Architecture overview',
        description: 'The repository at a glance: frameworks, size, every architecture component grouped by lane (ui → edge → api → logic → data → external), and the most connected components. Start here.',
        inputSchema: { type: 'object', properties: {} },
        run: () => this.overview(),
      },
      {
        name: 'find_components',
        title: 'Find components',
        description: 'Search components by name, route, domain or file path.',
        inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number', description: 'Most results (default 20)' } }, required: ['query'] },
        run: (args) => {
          const query = String(args.query ?? '');
          const limit = Math.min(100, Number(args.limit) || 20);
          const found = [...this.nodes.values()].filter((n) => matches(n, query));
          return { found: found.length, components: found.slice(0, limit).map((n) => ({ ...brief(n), sublabel: n.sublabel, files: n.files.slice(0, 3) })) };
        },
      },
      {
        name: 'explain_component',
        title: 'Explain a component',
        description: 'What a component is: its kind, lane, files, the symbols it holds, what it depends on and what uses it (with call sites), and recent commits that touched it.',
        inputSchema: { type: 'object', properties: { component }, required: ['component'] },
        run: (args) => this.explain(this.resolve(args.component)),
      },
      {
        name: 'impact',
        title: 'Impact of changing a component',
        description: 'Everything that depends on a component, directly or through others: what could break if it changes. Use before editing it.',
        inputSchema: { type: 'object', properties: { component }, required: ['component'] },
        run: (args) => this.closure(this.resolve(args.component), 'upstream'),
      },
      {
        name: 'trace',
        title: 'Trace what a component reaches',
        description: 'Everything a component depends on, directly or through others: what a request through it touches, down to data and external services.',
        inputSchema: { type: 'object', properties: { component }, required: ['component'] },
        run: (args) => this.closure(this.resolve(args.component), 'downstream'),
      },
      {
        name: 'find_path',
        title: 'Path between two components',
        description: 'The shortest chain of dependencies from one component to another, with the kind of each link. Also checks the reverse direction.',
        inputSchema: { type: 'object', properties: { from: component, to: component }, required: ['from', 'to'] },
        run: (args) => this.path(this.resolve(args.from), this.resolve(args.to)),
      },
      {
        name: 'components_for_files',
        title: 'Components for files',
        description: 'Which architecture components own the given files, and how many components use each. Call with the files you are about to edit.',
        inputSchema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' }, description: 'Paths relative to the repository, or absolute' } }, required: ['files'] },
        run: (args) => this.forFiles(Array.isArray(args.files) ? args.files.map(String) : []),
      },
      {
        name: 'recent_changes',
        title: 'Recent architecture changes',
        description: 'What file saves changed in the architecture since this server started: components and links added or removed. Call after editing to check nothing unintended moved. Pass `since` (a seq from an earlier call) for only newer changes.',
        inputSchema: { type: 'object', properties: { since: { type: 'number', description: 'Only changes after this seq' } } },
        run: (args) => {
          const since = Number(args.since) || 0;
          const changes = this.changes.filter((c) => c.seq > since && (c.componentsAdded.length || c.componentsRemoved.length || c.componentsChanged.length || c.linksAdded.length || c.linksRemoved.length || c.files.length));
          return { latestSeq: this.opts.engine.seq, changes };
        },
      },
      {
        name: 'commit_history',
        title: 'Commit history',
        description:
          'Recent commits Eyrie recorded, newest first, with the components each touched and the coding agent that co-authored it. Includes an AI note per commit (intent, whether the change matches its message, risk) when the user turned notes on. Filter by component or agent, or pass a hash for one commit in full.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Most commits (default 10)' },
            component: { ...component, description: 'Only commits that touched this component' },
            agent: { type: 'string', description: 'Only commits co-authored by this agent, e.g. Claude or Codex' },
            hash: { type: 'string', description: 'One commit, by full or abbreviated hash' },
          },
        },
        run: (args) => this.commits(args),
      },
    ];
  }

  private overview() {
    const { engine } = this.opts;
    const nodes = [...this.nodes.values()];
    const degree = new Map<string, { in: number; out: number }>();
    for (const e of this.edges) {
      const s = degree.get(e.source) ?? { in: 0, out: 0 };
      s.out++;
      degree.set(e.source, s);
      const t = degree.get(e.target) ?? { in: 0, out: 0 };
      t.in++;
      degree.set(e.target, t);
    }
    const lanes: Record<string, unknown[]> = {};
    for (const n of nodes) (lanes[n.lane] ??= []).push({ id: n.id, label: n.label, kind: n.kind, ...(n.sublabel ? { sublabel: n.sublabel } : {}) });
    const mostConnected = nodes
      .map((n) => ({ ...brief(n), usedBy: degree.get(n.id)?.in ?? 0, dependsOn: degree.get(n.id)?.out ?? 0 }))
      .sort((a, b) => b.usedBy + b.dependsOn - (a.usedBy + a.dependsOn))
      .slice(0, 8);
    return {
      repo: { name: engine.repo.name, root: engine.root, frameworks: engine.repo.frameworks },
      size: { files: engine.stats.files, symbols: engine.stats.symbols, components: nodes.length, links: this.edges.length },
      lanes,
      mostConnected,
      history: this.knowledge?.summary() ?? null,
    };
  }

  private explain(n: ArchNode) {
    const nodes = this.nodes;
    const details = this.opts.engine.archNodeDetails(n.id);
    const commits = this.knowledge?.store.commits({ component: n.id, limit: 5 }) ?? [];
    return {
      component: { ...brief(n), category: n.category, sublabel: n.sublabel, domain: n.domain, summary: n.summary, files: n.files, source: n.source ? `${n.source.file}:${n.source.line}` : undefined },
      dependsOn: this.edges.filter((e) => e.source === n.id).map((e) => this.link(e, e.target, nodes)),
      usedBy: this.edges.filter((e) => e.target === n.id).map((e) => this.link(e, e.source, nodes)),
      symbols: (details?.members ?? []).slice(0, 40).map((m) => ({ name: m.qualifiedName, kind: m.kind, at: m.file ? `${m.file}:${m.line ?? 1}` : undefined, ...(m.signature ? { signature: m.signature } : {}) })),
      recentCommits: commits.map((c) => {
        const v = commitView(this.knowledge!.store, c);
        return { hash: v.hash.slice(0, 10), subject: v.subject, committedAt: v.committedAt, agents: v.agents, ...(v.note ? { note: { matchesMessage: v.note.matchesMessage, risk: v.note.risk } } : {}) };
      }),
    };
  }

  private closure(n: ArchNode, mode: 'upstream' | 'downstream') {
    const nodes = this.nodes;
    const focus = focusSet(this.edges, n.id, mode);
    const summary = impactOf(nodes, focus);
    const reached = [...focus.depth]
      .filter(([, d]) => d > 0)
      .sort((a, b) => a[1] - b[1])
      .map(([id, depth]) => ({ ...brief(nodes.get(id)!), depth }));
    return {
      component: brief(n),
      [mode === 'upstream' ? 'dependents' : 'dependencies']: { direct: summary.direct, indirect: summary.indirect, components: reached },
      byKind: { ui: summary.ui, apis: summary.apis, services: summary.services, data: summary.data, external: summary.external },
    };
  }

  private path(from: ArchNode, to: ArchNode) {
    const nodes = this.nodes;
    const describe = (p: NonNullable<ReturnType<typeof archPath>>) => ({
      components: p.nodes.map((id) => brief(nodes.get(id)!)),
      links: p.edges.map((e) => ({ from: nodes.get(e.source)!.label, to: nodes.get(e.target)!.label, kinds: e.kinds })),
    });
    const forward = archPath(this.edges, from.id, to.id);
    if (forward) return { direction: `${from.label} → ${to.label}`, ...describe(forward) };
    const backward = archPath(this.edges, to.id, from.id);
    if (backward) return { direction: `${to.label} → ${from.label} (only this way round)`, ...describe(backward) };
    return { direction: null, message: `${from.label} and ${to.label} do not depend on each other, directly or through other components.` };
  }

  private forFiles(files: string[]) {
    const nodes = [...this.nodes.values()];
    const usedBy = new Map<string, number>();
    for (const e of this.edges) usedBy.set(e.target, (usedBy.get(e.target) ?? 0) + 1);
    return files.map((f) => {
      const file = this.relativeFile(f);
      const owners = nodes.filter((n) => n.files.includes(file));
      return owners.length
        ? { file, components: owners.map((n) => ({ ...brief(n), usedBy: usedBy.get(n.id) ?? 0 })) }
        : { file, components: [], note: 'Not part of an architecture component: a helper folded into the components that use it, a file Eyrie does not parse, or a new file not yet saved.' };
    });
  }

  private commits(args: Record<string, unknown>) {
    const k = this.knowledge;
    if (!k) return { message: 'Commit history is not available for this project.' };
    if (typeof args.hash === 'string' && args.hash.trim()) {
      const c = k.store.commit(args.hash.trim());
      if (!c) throw new LookupError(`No recorded commit matches ${args.hash}. Eyrie records the latest commits on HEAD.`);
      return commitView(k.store, c, { detail: true });
    }
    const componentId = args.component === undefined ? undefined : this.resolve(args.component).id;
    const list = k.store.commits({ limit: Math.min(100, Number(args.limit) || 10), component: componentId, agent: typeof args.agent === 'string' ? args.agent : undefined });
    return { summary: k.summary(), commits: list.map((c) => commitView(k.store, c)) };
  }
}

/** Serves MCP over stdio until stdin closes. */
export function serveStdio(mcp: EyrieMcp, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<void> {
  const write = (msg: unknown) => output.write(`${JSON.stringify(msg)}\n`);
  const lines = createInterface({ input, crlfDelay: Infinity });
  let pending = Promise.resolve();
  lines.on('line', (line) => {
    if (!line.trim()) return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    // Answer in order; a batch (older protocol revisions) gets an array back.
    pending = pending.then(async () => {
      if (Array.isArray(message)) {
        const answers = (await Promise.all(message.map((m) => mcp.handle(m)))).filter(Boolean);
        if (answers.length) write(answers);
      } else {
        const answer = await mcp.handle(message);
        if (answer) write(answer);
      }
    });
  });
  return new Promise((resolve) => lines.on('close', () => void pending.then(() => resolve())));
}
