/**
 * Optional AI notes on recorded commits. A note compares what a commit says it
 * does (its message) with what it touched (files, and the architecture
 * components that own them), and points out mismatches and risks.
 *
 * The rules from the Knowledge Loop spec (docs/06-implementation-plan/feature-knowledge):
 * - A note explains; it never becomes a finding, an edge or a rule.
 * - The model sees names, paths, line counts and the graph's components, never source code.
 * - Every observation cites evidence from the packet. A note citing anything
 *   else is stored as `rejected`, so it is visible but never shown as fact.
 */
import { createHash } from 'node:crypto';
import type { CommitNote, CommitRecord, KnowledgeStore } from './store.js';

/** One request to a model: a prompt and the JSON schema its answer must follow. */
export interface AiRequest {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface AiResult {
  json: unknown;
  model?: string;
  usage?: Record<string, unknown>;
}

/** A model behind one interface: the Claude Code CLI today; an HTTP API or another agent CLI later. */
export interface AiBackend {
  /** Stored with every note, e.g. `claude-code`. */
  readonly name: string;
  run(request: AiRequest): Promise<AiResult>;
}

export interface ProjectContext {
  name: string;
  frameworks: string[];
}

const MAX_FILES = 40;
const MAX_BODY = 1500;

const SYSTEM = `You review git commits for Eyrie, a tool that keeps a live architecture map of a codebase.
For each commit you get its message, the files it changed with line counts, and the architecture components that own those files (with their kind and lane: ui, edge, api, logic, data, external).
You do not see source code. Use only the facts given.
For each commit:
- intent: one sentence, what the commit is for, from its message.
- matchesMessage: does what it touched match what the message says? "yes", "partly", "no", or "unclear" when the message says too little.
- mismatch: when "partly" or "no", what it touched that the message does not account for. Otherwise omit it.
- risk: architectural risk, "low", "medium" or "high": high when it changes many components, crosses lanes unexpectedly (for example UI touching data directly), or touches shared components broadly.
- observations: at most three short architectural observations. Each cites its evidence as "file:<path>" or "component:<id>", using only paths and ids given for that commit. No observations is better than a guess.
Write plainly, without hype.`;

const SCHEMA = {
  type: 'object',
  properties: {
    commits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          hash: { type: 'string' },
          intent: { type: 'string' },
          matchesMessage: { type: 'string', enum: ['yes', 'partly', 'no', 'unclear'] },
          mismatch: { type: 'string' },
          risk: { type: 'string', enum: ['low', 'medium', 'high'] },
          observations: {
            type: 'array',
            items: {
              type: 'object',
              properties: { text: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' } } },
              required: ['text', 'evidence'],
            },
          },
        },
        required: ['hash', 'intent', 'matchesMessage', 'risk', 'observations'],
      },
    },
  },
  required: ['commits'],
};

/** What the model is shown about one commit. Deterministic, so its hash identifies the input. */
function commitPacket(commit: CommitRecord): Record<string, unknown> {
  const files = commit.files.slice(0, MAX_FILES).map((f) => ({ path: f.path, added: f.added, deleted: f.deleted }));
  return {
    hash: commit.hash,
    subject: commit.subject,
    body: commit.body.length > MAX_BODY ? `${commit.body.slice(0, MAX_BODY)}…` : commit.body,
    agents: commit.agents,
    files,
    moreFiles: Math.max(0, commit.files.length - MAX_FILES),
    components: commit.components.map((c) => ({ id: c.id, label: c.label, kind: c.kind, lane: c.lane, category: c.category })),
  };
}

function inputHash(packet: unknown): string {
  return createHash('sha256').update(JSON.stringify(packet)).digest('hex').slice(0, 32);
}

/** The request for a batch of commits. */
export function analysisRequest(project: ProjectContext, commits: CommitRecord[], timeoutMs: number, signal?: AbortSignal): AiRequest {
  const packet = { project: { name: project.name, frameworks: project.frameworks }, commits: commits.map(commitPacket) };
  return {
    system: SYSTEM,
    prompt: `Review these commits. Answer with one entry per commit, in the same order.\n\n${JSON.stringify(packet, null, 1)}`,
    schema: SCHEMA,
    timeoutMs,
    signal,
  };
}

/**
 * Checks one entry of the model's answer against the commit it is about.
 * Returns the note, or why it is rejected.
 */
export function validateNote(commit: CommitRecord, raw: unknown): { note: CommitNote } | { error: string } {
  const r = raw as Partial<Record<keyof CommitNote | 'hash', unknown>> | null;
  if (!r || typeof r !== 'object') return { error: 'not an object' };
  if (typeof r.intent !== 'string' || !r.intent.trim()) return { error: 'missing intent' };
  if (!['yes', 'partly', 'no', 'unclear'].includes(r.matchesMessage as string)) return { error: 'invalid matchesMessage' };
  if (!['low', 'medium', 'high'].includes(r.risk as string)) return { error: 'invalid risk' };
  if (!Array.isArray(r.observations)) return { error: 'missing observations' };
  const files = new Set(commit.files.slice(0, MAX_FILES).map((f) => `file:${f.path}`));
  const components = new Set(commit.components.map((c) => `component:${c.id}`));
  const observations: CommitNote['observations'] = [];
  for (const o of r.observations.slice(0, 3) as { text?: unknown; evidence?: unknown }[]) {
    if (typeof o?.text !== 'string' || !Array.isArray(o.evidence) || !o.evidence.length) return { error: 'an observation has no evidence' };
    for (const e of o.evidence) {
      if (typeof e !== 'string' || !(files.has(e) || components.has(e))) return { error: `cites evidence the commit does not have: ${String(e)}` };
    }
    observations.push({ text: o.text.trim(), evidence: o.evidence as string[] });
  }
  const note: CommitNote = { intent: r.intent.trim(), matchesMessage: r.matchesMessage as CommitNote['matchesMessage'], risk: r.risk as CommitNote['risk'], observations };
  if ((note.matchesMessage === 'partly' || note.matchesMessage === 'no') && typeof r.mismatch === 'string' && r.mismatch.trim()) note.mismatch = r.mismatch.trim();
  return { note };
}

export interface AnalyzeOptions {
  backend: AiBackend;
  project: ProjectContext;
  /** Commits per request. */
  batchSize?: number;
  /** Most commits to analyse in this run, newest first. */
  max?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  log?: (message: string) => void;
  now?: () => number;
}

/**
 * Notes the newest commits that have none yet, in batches. A failed request
 * is recorded per commit and retried on a later run (up to three times); a
 * rejected note is kept for inspection and not retried.
 */
export async function analyzePending(store: KnowledgeStore, opts: AnalyzeOptions): Promise<{ ok: number; rejected: number; failed: number }> {
  const { backend, project, batchSize = 8, max = 24, timeoutMs = 180_000, signal, log = () => {}, now = Date.now } = opts;
  const pending = store.pendingAnalysis(backend.name, { limit: max });
  const totals = { ok: 0, rejected: 0, failed: 0 };
  for (let i = 0; i < pending.length; i += batchSize) {
    if (signal?.aborted) break;
    const batch = pending.slice(i, i + batchSize);
    const hashes = new Map(batch.map((c) => [c.hash, inputHash({ project, commit: commitPacket(c) })]));
    log(`Analysing ${batch.length} commit${batch.length === 1 ? '' : 's'} with ${backend.name}`);
    let result: AiResult;
    try {
      result = await backend.run(analysisRequest(project, batch, timeoutMs, signal));
    } catch (err) {
      const message = (err as Error).message;
      log(`Commit analysis failed: ${message}`);
      for (const c of batch) store.addAnalysis({ commitHash: c.hash, backend: backend.name, model: null, inputHash: hashes.get(c.hash)!, createdAt: now(), status: 'failed', note: null, error: message, usage: null });
      totals.failed += batch.length;
      continue;
    }
    const entries = ((result.json as { commits?: unknown[] } | null)?.commits ?? []) as { hash?: unknown }[];
    for (const [index, commit] of batch.entries()) {
      // Match by hash; fall back to position when the model shortened or dropped it.
      const raw = entries.find((e) => typeof e?.hash === 'string' && e.hash.length >= 7 && commit.hash.startsWith(e.hash)) ?? entries[index];
      const checked = raw ? validateNote(commit, raw) : { error: 'no entry for this commit' };
      const base = { commitHash: commit.hash, backend: backend.name, model: result.model ?? null, inputHash: hashes.get(commit.hash)!, createdAt: now(), usage: index === 0 ? (result.usage ?? null) : null };
      if ('note' in checked) {
        store.addAnalysis({ ...base, status: 'ok', note: checked.note, error: null });
        totals.ok++;
      } else {
        store.addAnalysis({ ...base, status: 'rejected', note: (raw as CommitNote | undefined) ?? null, error: checked.error });
        totals.rejected++;
      }
    }
  }
  return totals;
}
