/**
 * Commits as Eyrie's surfaces show them: the HTTP API and the MCP server return
 * the same shape. Long lists are cut, with a count of what was left out, so a
 * large merge stays affordable for an agent to read.
 */
import type { CommitRecord, KnowledgeStore } from './store.js';

/** Components per commit in a list, and files and components when one commit is shown in full. */
export const VIEW_LIMITS = { listComponents: 12, detailFiles: 60, detailComponents: 40 };

export interface CommitView {
  hash: string;
  subject: string;
  body?: string;
  author: string;
  agents: string[];
  committedAt: string;
  filesChanged: number;
  files?: { path: string; added: number | null; deleted: number | null }[];
  /** Files changed but not listed. */
  moreFiles?: number;
  components: { id: string; label: string; lane: string }[];
  /** Components touched but not listed. */
  moreComponents?: number;
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
  const componentLimit = opts.detail ? VIEW_LIMITS.detailComponents : VIEW_LIMITS.listComponents;
  const view: CommitView = {
    hash: c.hash,
    subject: c.subject,
    author: `${c.authorName} <${c.authorEmail}>`,
    agents: c.agents,
    committedAt: new Date(c.committedAt).toISOString(),
    filesChanged: c.files.length,
    components: c.components.slice(0, componentLimit).map((x) => ({ id: x.id, label: x.label, lane: x.lane })),
  };
  if (c.components.length > componentLimit) view.moreComponents = c.components.length - componentLimit;
  if (opts.detail) {
    if (c.body) view.body = c.body;
    view.files = c.files.slice(0, VIEW_LIMITS.detailFiles);
    if (c.files.length > VIEW_LIMITS.detailFiles) view.moreFiles = c.files.length - VIEW_LIMITS.detailFiles;
  }
  const latest = store.latestNote(c.hash);
  if (latest?.note) {
    view.note = { ...latest.note, writtenBy: [latest.backend, latest.model].filter(Boolean).join(' · '), writtenAt: new Date(latest.createdAt).toISOString() };
  }
  return view;
}
