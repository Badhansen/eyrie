/**
 * knowledge.db: what Eyrie has learned about a project and must keep. Unlike
 * graph.db, which is a disposable parse cache, nothing here can be rebuilt
 * from the code alone (AI notes cost money, history can be rewritten), so
 * migrations only ever add.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CommitFile } from './git.js';

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

/** A component as it was when a commit was recorded: ids are stable, but labels and lanes can change later. */
export interface ComponentRef {
  id: string;
  label: string;
  kind: string;
  lane: string;
  category: string;
}

export interface CommitRecord {
  hash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authoredAt: number;
  committedAt: number;
  subject: string;
  body: string;
  /** Coding agents named as author or co-author. */
  agents: string[];
  files: CommitFile[];
  /** Architecture components that own the changed files, as the graph stood when the commit was recorded. */
  components: ComponentRef[];
  recordedAt: number;
}

export type AnalysisStatus = 'ok' | 'failed' | 'rejected';

/** An AI note on one commit. Never a finding: it explains, it decides nothing. */
export interface CommitNote {
  intent: string;
  matchesMessage: 'yes' | 'partly' | 'no' | 'unclear';
  mismatch?: string;
  risk: 'low' | 'medium' | 'high';
  observations: { text: string; evidence: string[] }[];
}

export interface AnalysisRecord {
  id: number;
  commitHash: string;
  backend: string;
  model: string | null;
  /** Hash of everything sent, so a note is reused only for identical input. */
  inputHash: string;
  createdAt: number;
  status: AnalysisStatus;
  note: CommitNote | null;
  error: string | null;
  usage: Record<string, unknown> | null;
}

const MIGRATIONS: string[] = [
  `CREATE TABLE commits (
     hash TEXT PRIMARY KEY,
     parents TEXT NOT NULL,
     author_name TEXT NOT NULL,
     author_email TEXT NOT NULL,
     authored_at INTEGER NOT NULL,
     committed_at INTEGER NOT NULL,
     subject TEXT NOT NULL,
     body TEXT NOT NULL,
     agents TEXT NOT NULL,
     files TEXT NOT NULL,
     components TEXT NOT NULL,
     recorded_at INTEGER NOT NULL
   );
   CREATE INDEX commits_committed_at ON commits (committed_at DESC);
   CREATE TABLE analyses (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     commit_hash TEXT NOT NULL REFERENCES commits (hash),
     backend TEXT NOT NULL,
     model TEXT,
     input_hash TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     status TEXT NOT NULL,
     note TEXT,
     error TEXT,
     usage TEXT
   );
   CREATE INDEX analyses_commit ON analyses (commit_hash, created_at DESC);
   CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
];

interface CommitRow {
  hash: string;
  parents: string;
  author_name: string;
  author_email: string;
  authored_at: number;
  committed_at: number;
  subject: string;
  body: string;
  agents: string;
  files: string;
  components: string;
  recorded_at: number;
}

interface AnalysisRow {
  id: number;
  commit_hash: string;
  backend: string;
  model: string | null;
  input_hash: string;
  created_at: number;
  status: AnalysisStatus;
  note: string | null;
  error: string | null;
  usage: string | null;
}

const toCommit = (r: CommitRow): CommitRecord => ({
  hash: r.hash,
  parents: r.parents ? r.parents.split(' ') : [],
  authorName: r.author_name,
  authorEmail: r.author_email,
  authoredAt: r.authored_at,
  committedAt: r.committed_at,
  subject: r.subject,
  body: r.body,
  agents: JSON.parse(r.agents) as string[],
  files: JSON.parse(r.files) as CommitFile[],
  components: JSON.parse(r.components) as ComponentRef[],
  recordedAt: r.recorded_at,
});

const toAnalysis = (r: AnalysisRow): AnalysisRecord => ({
  id: r.id,
  commitHash: r.commit_hash,
  backend: r.backend,
  model: r.model,
  inputHash: r.input_hash,
  createdAt: r.created_at,
  status: r.status,
  note: r.note ? (JSON.parse(r.note) as CommitNote) : null,
  error: r.error,
  usage: r.usage ? (JSON.parse(r.usage) as Record<string, unknown>) : null,
});

export class KnowledgeStore {
  private constructor(private readonly db: Database) {}

  static open(path: string): KnowledgeStore {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    const store = new KnowledgeStore(db);
    store.migrate();
    return store;
  }

  /** Applies the migrations this database has not seen, in order, each in its own transaction. */
  private migrate(): void {
    const { user_version: version } = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    for (let i = version; i < MIGRATIONS.length; i++) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(MIGRATIONS[i]!);
        this.db.exec(`PRAGMA user_version = ${i + 1}`);
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    }
  }

  close(): void {
    this.db.close();
  }

  knownHashes(hashes: string[]): Set<string> {
    const known = new Set<string>();
    const stmt = this.db.prepare('SELECT 1 FROM commits WHERE hash = ?');
    for (const hash of hashes) if (stmt.get(hash)) known.add(hash);
    return known;
  }

  addCommits(commits: CommitRecord[]): void {
    if (!commits.length) return;
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO commits (hash, parents, author_name, author_email, authored_at, committed_at, subject, body, agents, files, components, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.db.exec('BEGIN');
    try {
      for (const c of commits) {
        stmt.run(c.hash, c.parents.join(' '), c.authorName, c.authorEmail, c.authoredAt, c.committedAt, c.subject, c.body, JSON.stringify(c.agents), JSON.stringify(c.files), JSON.stringify(c.components), c.recordedAt);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  commit(hash: string): CommitRecord | null {
    const row = this.db.prepare('SELECT * FROM commits WHERE hash = ? OR hash LIKE ?').get(hash, `${hash}%`) as CommitRow | undefined;
    return row ? toCommit(row) : null;
  }

  /** Newest first by commit time. */
  commits(opts: { limit?: number; agent?: string; component?: string } = {}): CommitRecord[] {
    const rows = this.db.prepare('SELECT * FROM commits ORDER BY committed_at DESC, recorded_at DESC').all() as unknown as CommitRow[];
    const out: CommitRecord[] = [];
    for (const row of rows) {
      const c = toCommit(row);
      if (opts.agent && !c.agents.some((a) => a.toLowerCase() === opts.agent!.toLowerCase())) continue;
      if (opts.component && !c.components.some((x) => x.id === opts.component)) continue;
      out.push(c);
      if (opts.limit && out.length >= opts.limit) break;
    }
    return out;
  }

  addAnalysis(a: Omit<AnalysisRecord, 'id'>): void {
    this.db
      .prepare('INSERT INTO analyses (commit_hash, backend, model, input_hash, created_at, status, note, error, usage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(a.commitHash, a.backend, a.model, a.inputHash, a.createdAt, a.status, a.note ? JSON.stringify(a.note) : null, a.error, a.usage ? JSON.stringify(a.usage) : null);
  }

  /** Every note on a commit, newest first. */
  analyses(hash: string): AnalysisRecord[] {
    return (this.db.prepare('SELECT * FROM analyses WHERE commit_hash = ? ORDER BY created_at DESC, id DESC').all(hash) as unknown as AnalysisRow[]).map(toAnalysis);
  }

  /** The newest note that passed validation, if any. */
  latestNote(hash: string): AnalysisRecord | null {
    return this.analyses(hash).find((a) => a.status === 'ok') ?? null;
  }

  /**
   * Commits that still need a note from this backend, newest first: no note
   * yet, and fewer than `maxAttempts` failures. A rejected note counts as an
   * answer; it is not retried until the input changes.
   */
  pendingAnalysis(backend: string, opts: { limit: number; maxAttempts?: number }): CommitRecord[] {
    const maxAttempts = opts.maxAttempts ?? 3;
    const rows = this.db
      .prepare(
        `SELECT c.* FROM commits c
         WHERE NOT EXISTS (SELECT 1 FROM analyses a WHERE a.commit_hash = c.hash AND a.backend = ? AND a.status IN ('ok', 'rejected'))
           AND (SELECT COUNT(*) FROM analyses a WHERE a.commit_hash = c.hash AND a.backend = ? AND a.status = 'failed') < ?
         ORDER BY c.committed_at DESC LIMIT ?`,
      )
      .all(backend, backend, maxAttempts, opts.limit) as unknown as CommitRow[];
    return rows.map(toCommit);
  }

  counts(): { commits: number; analysed: number } {
    const commits = (this.db.prepare('SELECT COUNT(*) AS n FROM commits').get() as { n: number }).n;
    const analysed = (this.db.prepare("SELECT COUNT(DISTINCT commit_hash) AS n FROM analyses WHERE status = 'ok'").get() as { n: number }).n;
    return { commits, analysed };
  }

  getMeta(key: string): string | null {
    return (this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
  }
}
