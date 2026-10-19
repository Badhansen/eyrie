/**
 * A project's knowledge while Eyrie has it open: records the commits it has
 * not seen into knowledge.db, mapped onto the architecture graph as it stands,
 * and, when an AI backend is configured, notes them in the background.
 *
 * Runs wherever the engine runs (the CLI's server, the desktop app's engine
 * host, the MCP server); it needs only the architecture graph, not the engine.
 */
import { join } from 'node:path';
import type { ArchGraph } from '@eyrie/core';
import { analyzePending, type AiBackend, type ProjectContext } from './analysis.js';
import { agentsOf, headCommit, readCommits, recentHashes } from './git.js';
import { KnowledgeStore, type CommitRecord, type ComponentRef } from './store.js';

export interface KnowledgeOptions {
  /** The project folder: a git work tree or a folder inside one. */
  root: string;
  /** The project's data folder, next to graph.db (`GraphEngine.dataDir`). */
  dataDir: string;
  /** The architecture graph now. Read when commits are recorded, to name the components they touched. */
  architecture: () => ArchGraph;
  project: () => ProjectContext;
  /** Notes commits when set. Off unless the user turns it on. */
  ai?: AiBackend | null;
  /** Commits read back from HEAD the first time; later runs stop at what is already recorded. */
  history?: number;
  log?: (message: string) => void;
}

export interface KnowledgeSummary {
  commits: number;
  analysed: number;
  /** Recorded by the latest `record()`. */
  added: number;
  head: string | null;
  ai: string | null;
}

/** Components that own each changed file, as the graph stands. */
function componentsFor(arch: ArchGraph, files: string[]): ComponentRef[] {
  const byFile = new Map<string, ComponentRef[]>();
  for (const n of arch.nodes) {
    const ref: ComponentRef = { id: n.id, label: n.label, kind: n.kind, lane: n.lane, category: n.category };
    for (const f of n.files) {
      const list = byFile.get(f);
      if (list) list.push(ref);
      else byFile.set(f, [ref]);
    }
  }
  const seen = new Map<string, ComponentRef>();
  for (const f of files) for (const ref of byFile.get(f) ?? []) seen.set(ref.id, ref);
  return [...seen.values()];
}

export class ProjectKnowledge {
  readonly store: KnowledgeStore;
  private head: string | null = null;
  private added = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;
  private readonly abort = new AbortController();
  private readonly log: (message: string) => void;

  private constructor(private readonly opts: KnowledgeOptions) {
    this.store = KnowledgeStore.open(join(opts.dataDir, 'knowledge.db'));
    this.log = opts.log ?? (() => {});
  }

  static open(opts: KnowledgeOptions): ProjectKnowledge {
    return new ProjectKnowledge(opts);
  }

  /** Records commits on HEAD that are not in knowledge.db yet. Not a git repository: records nothing. */
  record(): Promise<number> {
    return this.enqueue(async () => {
      this.head = await headCommit(this.opts.root);
      if (!this.head) {
        this.added = 0;
        return 0;
      }
      const recent = await recentHashes(this.opts.root, this.opts.history ?? 200);
      const known = this.store.knownHashes(recent);
      const fresh = recent.filter((h) => !known.has(h));
      const commits = await readCommits(this.opts.root, fresh);
      const arch = this.opts.architecture();
      const now = Date.now();
      const records: CommitRecord[] = commits.map((c) => ({
        hash: c.hash,
        parents: c.parents,
        authorName: c.authorName,
        authorEmail: c.authorEmail,
        authoredAt: c.authoredAt,
        committedAt: c.committedAt,
        subject: c.subject,
        body: c.body,
        agents: agentsOf(c),
        files: c.files,
        components: componentsFor(arch, c.files.map((f) => f.path)),
        recordedAt: now,
      }));
      this.store.addCommits(records);
      this.store.setMeta('last_head', this.head);
      this.added = records.length;
      if (records.length) this.log(`Recorded ${records.length} commit${records.length === 1 ? '' : 's'}`);
      return records.length;
    });
  }

  /** Notes commits that have none, when an AI backend is configured. */
  analyze(): Promise<{ ok: number; rejected: number; failed: number } | null> {
    const ai = this.opts.ai;
    if (!ai) return Promise.resolve(null);
    return this.enqueue(() => analyzePending(this.store, { backend: ai, project: this.opts.project(), signal: this.abort.signal, log: this.log }));
  }

  /**
   * Records and analyses new commits whenever HEAD moves, checking every
   * `intervalMs`: one `git rev-parse`, cheap enough that an agent asking about
   * the commit it just made finds it.
   */
  watch(intervalMs = 5_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void headCommit(this.opts.root).then((head) => {
        if (!head || head === this.head || this.abort.signal.aborted) return;
        void this.record().then((added) => (added ? this.analyze() : null));
      });
    }, intervalMs);
    this.timer.unref();
  }

  summary(): KnowledgeSummary {
    return { ...this.store.counts(), added: this.added, head: this.head, ai: this.opts.ai?.name ?? null };
  }

  /** Stops watching, cancels a running analysis, waits for the queue, then closes the database. */
  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.abort.abort();
    await this.queue.catch(() => {});
    this.store.close();
  }

  /** Runs one task at a time, so recording and analysis never interleave. A failure does not stop later tasks. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch((err: unknown) => this.log(`Knowledge: ${(err as Error).message}`));
    return run;
  }
}
