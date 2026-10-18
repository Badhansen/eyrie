/** Commits as Eyrie's surfaces show them: the HTTP API and the MCP server return the same shape. */
import type { CommitRecord, KnowledgeStore } from './store.js';

export interface CommitView {
  hash: string;
  subject: string;
  body?: string;
  author: string;
  agents: string[];
  committedAt: string;
  filesChanged: number;
  files?: { path: string; added: number | null; deleted: number | null }[];
  components: { id: string; label: string; lane: string }[];
  /** The latest AI note that passed validation, labelled with what wrote it. */
  note?: CommitViewNote;
}

export interface CommitViewNote {
  intent: string;
  matchesMessage: string;
  mismatch?: string;
  risk: string;
  observations: { text: string; evidence: string[] }[];
  writtenBy: string;
  writtenAt: string;
}

export function commitView(store: KnowledgeStore, c: CommitRecord, opts: { detail?: boolean } = {}): CommitView {
  const view: CommitView = {
    hash: c.hash,
    subject: c.subject,
    author: `${c.authorName} <${c.authorEmail}>`,
    agents: c.agents,
    committedAt: new Date(c.committedAt).toISOString(),
    filesChanged: c.files.length,
    components: c.components.map((x) => ({ id: x.id, label: x.label, lane: x.lane })),
  };
  if (opts.detail) {
    if (c.body) view.body = c.body;
    view.files = c.files;
  }
  const latest = store.latestNote(c.hash);
  if (latest?.note) {
    view.note = { ...latest.note, writtenBy: [latest.backend, latest.model].filter(Boolean).join(' · '), writtenAt: new Date(latest.createdAt).toISOString() };
  }
  return view;
}
