import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// node:sqlite prints an ExperimentalWarning on load; silence it the same way @eyrie/storage does.
const emitWarning = process.emitWarning;
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const text = typeof warning === 'string' ? warning : warning.message;
  if (text.includes('SQLite')) return;
  return (emitWarning as (...a: unknown[]) => void).call(process, warning, ...rest);
}) as typeof process.emitWarning;
const { DatabaseSync } = await import('node:sqlite');
process.emitWarning = emitWarning;

type Database = InstanceType<typeof DatabaseSync>;

export type Severity = 'error' | 'warning' | 'info';
export type Observation = 'present' | 'absent' | 'unknown';
export const VERDICTS = ['confirmed', 'intended', 'mapping-wrong', 'detector-wrong'] as const;
export type Verdict = 'untriaged' | (typeof VERDICTS)[number];
export const PROPOSAL_KINDS = ['fix', 'refactor', 'exception', 'rule', 'architecture'] as const;
export const REVIEW_VERDICTS = ['agree', 'disagree', 'needs-evidence'] as const;
export const ISSUE_STATUSES = ['open', 'confirmed', 'rejected', 'fixed'] as const;

/** A pointer into the source. `sha` fingerprints the cited lines so stale citations can be detected later. */
export interface Evidence {
  file: string;
  line: number;
  endLine?: number;
  sha?: string;
  note?: string;
}

/** One finding produced by a deterministic check. */
export interface FindingInput {
  check: string;
  title: string;
  severity: Severity;
  /** Stable identities the finding is about. With the check id they form the fingerprint. */
  subjects: string[];
  evidence: Evidence[];
  detail?: Record<string, unknown>;
}

export interface CheckResult {
  check: string;
  ok: boolean;
  error?: string;
  findings: FindingInput[];
}

export interface RunInfo {
  root: string;
  headCommit: string | null;
  dirty: boolean;
  /** Content hash over the analysed files, so uncommitted working trees are identified too. */
  snapshot: string;
  analyzerVersion: string;
  stats: Record<string, unknown>;
}

export interface RunRow {
  id: number;
  started_at: number;
  finished_at: number | null;
  root: string;
  head_commit: string | null;
  dirty: number;
  snapshot: string;
  analyzer_version: string;
  stats: string;
  checks: string;
}

export interface FindingRow {
  fingerprint: string;
  check_id: string;
  title: string;
  severity: Severity;
  subjects: string;
  observation: Observation;
  triage: Verdict;
  triage_note: string | null;
  baseline: number;
  first_run: number;
  last_run: number;
}

export interface IssueRow {
  id: number;
  title: string;
  description: string;
  severity: Severity;
  reporter: string;
  evidence: string;
  status: (typeof ISSUE_STATUSES)[number];
  created_at: number;
  updated_at: number;
}

export interface ProposalRow {
  id: number;
  target: string;
  kind: (typeof PROPOSAL_KINDS)[number];
  title: string;
  body: string;
  author: string;
  evidence: string;
  status: 'proposed' | 'accepted' | 'rejected' | 'superseded';
  created_at: number;
  decided_at: number | null;
  decided_by: string | null;
  decision_note: string | null;
}

export interface ReviewRow {
  id: number;
  proposal_id: number;
  reviewer: string;
  verdict: (typeof REVIEW_VERDICTS)[number];
  note: string;
  evidence: string;
  created_at: number;
}

export interface DecisionRow {
  id: number;
  title: string;
  context: string;
  decision: string;
  status: string;
  proposal_id: number | null;
  decided_by: string;
  created_at: number;
}

export interface EventRow {
  id: number;
  at: number;
  run_id: number | null;
  actor: string;
  entity: string;
  entity_id: string;
  type: string;
  detail: string | null;
}

export interface ScanSummary {
  observed: number;
  new: number;
  reopened: number;
  /** No longer produced, by the same check logic: the code changed. */
  resolved: number;
  /** No longer produced after the check logic changed: not evidence of a repair. */
  retired: number;
  unknown: number;
}

/** The checks part of an analyzer version, e.g. `checks/2` from `checks/2 eyrie/3cfaad8`. */
const checksVersion = (analyzerVersion: string) => analyzerVersion.split(' ')[0];

/**
 * Ordered migrations. This store is durable: migrations only ever add,
 * and a new version never drops data written by an older one.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE runs (
    id INTEGER PRIMARY KEY, started_at INTEGER NOT NULL, finished_at INTEGER,
    root TEXT NOT NULL, head_commit TEXT, dirty INTEGER NOT NULL, snapshot TEXT NOT NULL,
    analyzer_version TEXT NOT NULL, stats TEXT NOT NULL, checks TEXT NOT NULL
  );
  CREATE TABLE findings (
    fingerprint TEXT PRIMARY KEY, check_id TEXT NOT NULL, title TEXT NOT NULL, severity TEXT NOT NULL,
    subjects TEXT NOT NULL, observation TEXT NOT NULL, triage TEXT NOT NULL DEFAULT 'untriaged',
    triage_note TEXT, baseline INTEGER NOT NULL DEFAULT 0,
    first_run INTEGER NOT NULL REFERENCES runs(id), last_run INTEGER NOT NULL REFERENCES runs(id)
  );
  CREATE TABLE observations (
    run_id INTEGER NOT NULL REFERENCES runs(id), fingerprint TEXT NOT NULL REFERENCES findings(fingerprint),
    evidence TEXT NOT NULL, detail TEXT, PRIMARY KEY (run_id, fingerprint)
  );
  CREATE TABLE issues (
    id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, severity TEXT NOT NULL,
    reporter TEXT NOT NULL, evidence TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE proposals (
    id INTEGER PRIMARY KEY, target TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
    author TEXT NOT NULL, evidence TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'proposed',
    created_at INTEGER NOT NULL, decided_at INTEGER, decided_by TEXT, decision_note TEXT
  );
  CREATE TABLE reviews (
    id INTEGER PRIMARY KEY, proposal_id INTEGER NOT NULL REFERENCES proposals(id), reviewer TEXT NOT NULL,
    verdict TEXT NOT NULL, note TEXT NOT NULL, evidence TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE decisions (
    id INTEGER PRIMARY KEY, title TEXT NOT NULL, context TEXT NOT NULL, decision TEXT NOT NULL,
    status TEXT NOT NULL, proposal_id INTEGER REFERENCES proposals(id), decided_by TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE events (
    id INTEGER PRIMARY KEY, at INTEGER NOT NULL, run_id INTEGER REFERENCES runs(id), actor TEXT NOT NULL,
    entity TEXT NOT NULL, entity_id TEXT NOT NULL, type TEXT NOT NULL, detail TEXT
  );
  CREATE INDEX findings_observation ON findings (observation);
  CREATE INDEX events_entity ON events (entity, entity_id);
  CREATE INDEX reviews_proposal ON reviews (proposal_id);
  `,
];

const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function fingerprint(check: string, subjects: string[]): string {
  return createHash('sha256').update([check, ...[...subjects].sort()].join('\0')).digest('hex').slice(0, 16);
}

/** Agents report and propose; only people triage findings or decide on proposals. */
export function assertHuman(actor: string | undefined): asserts actor is string {
  if (!actor || !/^human:\S+/.test(actor)) throw new Error(`Only a person can do this; pass --by human:<name> (got "${actor ?? ''}").`);
}

function assertActor(actor: string | undefined): asserts actor is string {
  if (!actor || !/^\S+:\S+/.test(actor)) throw new Error(`Identify yourself as <tool>:<model> or human:<name> with --by (got "${actor ?? ''}").`);
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], what: string): T {
  if (!value || !allowed.includes(value as T)) throw new Error(`${what} must be one of: ${allowed.join(', ')} (got "${value ?? ''}").`);
  return value as T;
}

/**
 * Durable architecture-review store: findings from deterministic checks and
 * their history across runs, plus issues, proposals, reviews and decisions
 * that people and AI agents add over time.
 */
export class ReviewDb {
  private constructor(readonly db: Database) {}

  static open(path: string): ReviewDb {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    const store = new ReviewDb(db);
    store.migrate();
    return store;
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
    const current = row ? Number(row.value) : 0;
    if (current > MIGRATIONS.length) throw new Error(`Database schema ${current} is newer than this tool (${MIGRATIONS.length}).`);
    for (let v = current; v < MIGRATIONS.length; v++) {
      this.transaction(() => {
        this.db.exec(MIGRATIONS[v]!);
        this.db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(v + 1));
      });
    }
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  private event(actor: string, entity: string, entityId: string, type: string, detail?: unknown, runId?: number): void {
    this.db
      .prepare('INSERT INTO events (at, run_id, actor, entity, entity_id, type, detail) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(Date.now(), runId ?? null, actor, entity, entityId, type, detail === undefined ? null : JSON.stringify(detail));
  }

  // ── scans ────────────────────────────────────────────────────────────────

  /**
   * Records one scan. A finding the check produced again stays present; one it
   * no longer produces is resolved, or retired when the check logic changed
   * since the previous run; one whose check failed becomes unknown (a failed
   * check proves nothing either way).
   */
  recordScan(info: RunInfo, results: CheckResult[], opts: { baseline?: boolean } = {}): { runId: number; summary: ScanSummary } {
    return this.transaction(() => {
      const started = Date.now();
      const previous = this.latestRun();
      const checksChanged = !!previous && checksVersion(previous.analyzer_version) !== checksVersion(info.analyzerVersion);
      const checks = Object.fromEntries(results.map((r) => [r.check, r.ok ? { ok: true, findings: r.findings.length } : { ok: false, error: r.error }]));
      const runId = Number(
        this.db
          .prepare('INSERT INTO runs (started_at, root, head_commit, dirty, snapshot, analyzer_version, stats, checks) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(started, info.root, info.headCommit, info.dirty ? 1 : 0, info.snapshot, info.analyzerVersion, JSON.stringify(info.stats), JSON.stringify(checks)).lastInsertRowid,
      );
      const summary: ScanSummary = { observed: 0, new: 0, reopened: 0, resolved: 0, retired: 0, unknown: 0 };
      const produced = new Map<string, FindingInput>();
      for (const r of results) if (r.ok) for (const f of r.findings) produced.set(fingerprint(f.check, f.subjects), f);
      const ran = new Set(results.filter((r) => r.ok).map((r) => r.check));
      const failed = new Set(results.filter((r) => !r.ok).map((r) => r.check));

      const existing = this.db.prepare('SELECT * FROM findings').all() as unknown as FindingRow[];
      const known = new Map(existing.map((f) => [f.fingerprint, f]));
      const setObservation = this.db.prepare('UPDATE findings SET observation = ? WHERE fingerprint = ?');
      for (const f of existing) {
        if (failed.has(f.check_id) && f.observation === 'present') {
          setObservation.run('unknown', f.fingerprint);
          this.event('scanner', 'finding', f.fingerprint, 'coverage-lost', undefined, runId);
          summary.unknown++;
        } else if (ran.has(f.check_id) && !produced.has(f.fingerprint) && f.observation !== 'absent') {
          setObservation.run('absent', f.fingerprint);
          const type = checksChanged ? 'retired' : 'resolved';
          this.event('scanner', 'finding', f.fingerprint, type, checksChanged ? { from: previous!.analyzer_version, to: info.analyzerVersion } : undefined, runId);
          summary[type]++;
        }
      }

      const insert = this.db.prepare(
        "INSERT INTO findings (fingerprint, check_id, title, severity, subjects, observation, baseline, first_run, last_run) VALUES (?, ?, ?, ?, ?, 'present', ?, ?, ?)",
      );
      const update = this.db.prepare("UPDATE findings SET title = ?, severity = ?, observation = 'present', last_run = ?, baseline = MAX(baseline, ?) WHERE fingerprint = ?");
      const observe = this.db.prepare('INSERT INTO observations (run_id, fingerprint, evidence, detail) VALUES (?, ?, ?, ?)');
      const baseline = opts.baseline ? 1 : 0;
      for (const [fp, f] of produced) {
        const prev = known.get(fp);
        if (!prev) {
          insert.run(fp, f.check, f.title, f.severity, JSON.stringify([...f.subjects].sort()), baseline, runId, runId);
          this.event('scanner', 'finding', fp, 'observed', undefined, runId);
          summary.new++;
        } else {
          update.run(f.title, f.severity, runId, baseline, fp);
          if (prev.observation === 'absent') {
            this.event('scanner', 'finding', fp, 'reopened', undefined, runId);
            summary.reopened++;
          } else if (prev.observation === 'unknown') this.event('scanner', 'finding', fp, 'observed', undefined, runId);
        }
        observe.run(runId, fp, JSON.stringify(f.evidence), f.detail ? JSON.stringify(f.detail) : null);
        summary.observed++;
      }
      this.db.prepare('UPDATE runs SET finished_at = ? WHERE id = ?').run(Date.now(), runId);
      return { runId, summary };
    });
  }

  latestRun(): RunRow | undefined {
    return this.db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT 1').get() as unknown as RunRow | undefined;
  }

  findings(observation?: Observation): FindingRow[] {
    const rows = (observation
      ? this.db.prepare('SELECT * FROM findings WHERE observation = ?').all(observation)
      : this.db.prepare('SELECT * FROM findings').all()) as unknown as FindingRow[];
    return rows.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.check_id.localeCompare(b.check_id) || a.title.localeCompare(b.title));
  }

  finding(fp: string): FindingRow | undefined {
    const rows = this.db.prepare('SELECT * FROM findings WHERE fingerprint LIKE ?').all(`${fp}%`) as unknown as FindingRow[];
    if (rows.length > 1) throw new Error(`"${fp}" matches ${rows.length} findings; use more characters.`);
    return rows[0];
  }

  /** Evidence and detail recorded the last time the finding was observed. */
  latestObservation(fp: string): { evidence: Evidence[]; detail: Record<string, unknown> | null } | undefined {
    const row = this.db.prepare('SELECT evidence, detail FROM observations WHERE fingerprint = ? ORDER BY run_id DESC LIMIT 1').get(fp) as
      | { evidence: string; detail: string | null }
      | undefined;
    return row ? { evidence: JSON.parse(row.evidence) as Evidence[], detail: row.detail ? (JSON.parse(row.detail) as Record<string, unknown>) : null } : undefined;
  }

  eventsFor(entity: string, id: string): EventRow[] {
    return this.db.prepare('SELECT * FROM events WHERE entity = ? AND entity_id = ? ORDER BY id').all(entity, id) as unknown as EventRow[];
  }

  eventsInRun(runId: number, type: string): EventRow[] {
    return this.db.prepare('SELECT * FROM events WHERE run_id = ? AND type = ? ORDER BY id').all(runId, type) as unknown as EventRow[];
  }

  // ── people and agents ────────────────────────────────────────────────────

  triage(fp: string, verdict: string | undefined, note: string | undefined, by: string | undefined): FindingRow {
    assertHuman(by);
    const v = oneOf(verdict, VERDICTS, 'Verdict');
    if (!note?.trim()) throw new Error('A triage verdict needs a reason (--note).');
    const f = this.finding(fp);
    if (!f) throw new Error(`No finding ${fp}.`);
    this.transaction(() => {
      this.db.prepare('UPDATE findings SET triage = ?, triage_note = ? WHERE fingerprint = ?').run(v, note, f.fingerprint);
      this.event(by, 'finding', f.fingerprint, 'triaged', { verdict: v, note });
    });
    return { ...f, triage: v, triage_note: note };
  }

  addIssue(input: { title?: string; description?: string; severity?: string; by?: string; evidence: Evidence[] }): number {
    assertActor(input.by);
    if (!input.title?.trim() || !input.description?.trim()) throw new Error('An issue needs --title and --description.');
    const severity = oneOf(input.severity, ['error', 'warning', 'info'] as const, 'Severity');
    if (!input.evidence.length) throw new Error('An issue needs at least one --evidence path:line. Claims without evidence are not recorded.');
    return this.transaction(() => {
      const now = Date.now();
      const id = Number(
        this.db
          .prepare('INSERT INTO issues (title, description, severity, reporter, evidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(input.title!, input.description!, severity, input.by!, JSON.stringify(input.evidence), now, now).lastInsertRowid,
      );
      this.event(input.by!, 'issue', String(id), 'reported');
      return id;
    });
  }

  issues(): IssueRow[] {
    return this.db.prepare('SELECT * FROM issues ORDER BY id').all() as unknown as IssueRow[];
  }

  issue(id: number): IssueRow | undefined {
    return this.db.prepare('SELECT * FROM issues WHERE id = ?').get(id) as unknown as IssueRow | undefined;
  }

  setIssueStatus(id: number, status: string | undefined, note: string | undefined, by: string | undefined): void {
    assertHuman(by);
    const s = oneOf(status, ISSUE_STATUSES, 'Status');
    if (!this.issue(id)) throw new Error(`No issue ${id}.`);
    this.transaction(() => {
      this.db.prepare('UPDATE issues SET status = ?, updated_at = ? WHERE id = ?').run(s, Date.now(), id);
      this.event(by, 'issue', String(id), 'status', { status: s, note: note ?? null });
    });
  }

  addProposal(input: { target?: string; kind?: string; title?: string; body?: string; by?: string; evidence: Evidence[] }): number {
    assertActor(input.by);
    const kind = oneOf(input.kind, PROPOSAL_KINDS, 'Kind');
    if (!input.title?.trim() || !input.body?.trim()) throw new Error('A proposal needs --title and --body (or --body-file).');
    const target = input.target ?? '';
    const m = /^(finding|issue):(.+)$/.exec(target);
    let resolved = target;
    if (target === 'architecture') {
      if (kind !== 'architecture') throw new Error('Target "architecture" requires --kind architecture.');
    } else if (m?.[1] === 'finding') {
      const f = this.finding(m[2]!);
      if (!f) throw new Error(`No finding ${m[2]}.`);
      resolved = `finding:${f.fingerprint}`;
    } else if (m?.[1] === 'issue') {
      if (!this.issue(Number(m[2]))) throw new Error(`No issue ${m[2]}.`);
    } else throw new Error('--target must be finding:<fingerprint>, issue:<id> or architecture.');
    if (!input.evidence.length) throw new Error('A proposal needs at least one --evidence path:line.');
    return this.transaction(() => {
      const id = Number(
        this.db
          .prepare('INSERT INTO proposals (target, kind, title, body, author, evidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(resolved, kind, input.title!, input.body!, input.by!, JSON.stringify(input.evidence), Date.now()).lastInsertRowid,
      );
      this.event(input.by!, 'proposal', String(id), 'proposed', { target: resolved });
      return id;
    });
  }

  proposals(): ProposalRow[] {
    return this.db.prepare('SELECT * FROM proposals ORDER BY id').all() as unknown as ProposalRow[];
  }

  proposal(id: number): ProposalRow | undefined {
    return this.db.prepare('SELECT * FROM proposals WHERE id = ?').get(id) as unknown as ProposalRow | undefined;
  }

  addReview(input: { proposalId: number; verdict?: string; note?: string; by?: string; evidence: Evidence[] }): number {
    assertActor(input.by);
    const verdict = oneOf(input.verdict, REVIEW_VERDICTS, 'Verdict');
    const p = this.proposal(input.proposalId);
    if (!p) throw new Error(`No proposal ${input.proposalId}.`);
    if (p.author === input.by) throw new Error('Review someone else’s proposal; authors cannot review their own.');
    if (!input.note?.trim()) throw new Error('A review needs a reason (--note).');
    return this.transaction(() => {
      const id = Number(
        this.db
          .prepare('INSERT INTO reviews (proposal_id, reviewer, verdict, note, evidence, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(input.proposalId, input.by!, verdict, input.note!, JSON.stringify(input.evidence), Date.now()).lastInsertRowid,
      );
      this.event(input.by!, 'proposal', String(input.proposalId), 'reviewed', { verdict });
      return id;
    });
  }

  reviews(proposalId: number): ReviewRow[] {
    return this.db.prepare('SELECT * FROM reviews WHERE proposal_id = ? ORDER BY id').all(proposalId) as unknown as ReviewRow[];
  }

  /** Accepting a proposal also records it as a decision, so the reasoning outlives the code change. */
  decide(proposalId: number, status: string | undefined, note: string | undefined, by: string | undefined): void {
    assertHuman(by);
    const s = oneOf(status, ['accepted', 'rejected', 'superseded'] as const, 'Status');
    const p = this.proposal(proposalId);
    if (!p) throw new Error(`No proposal ${proposalId}.`);
    if (!note?.trim()) throw new Error('A decision needs a reason (--note).');
    this.transaction(() => {
      const now = Date.now();
      this.db.prepare('UPDATE proposals SET status = ?, decided_at = ?, decided_by = ?, decision_note = ? WHERE id = ?').run(s, now, by, note, proposalId);
      if (s === 'accepted') {
        this.db
          .prepare("INSERT INTO decisions (title, context, decision, status, proposal_id, decided_by, created_at) VALUES (?, ?, ?, 'accepted', ?, ?, ?)")
          .run(p.title, `${p.target}: ${p.body}`, note, proposalId, by, now);
      }
      this.event(by, 'proposal', String(proposalId), 'decided', { status: s, note });
    });
  }

  decisions(): DecisionRow[] {
    return this.db.prepare('SELECT * FROM decisions ORDER BY id').all() as unknown as DecisionRow[];
  }
}
