import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize, relative, sep } from 'node:path';
import type { Evidence } from './db.js';

const toPosix = (p: string) => p.split(sep).join('/');

function linesSha(lines: string[]): string {
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 12);
}

/** Parses `path:line` or `path:start-end`. */
export function parseEvidence(arg: string): Evidence {
  const m = /^(.+?):(\d+)(?:-(\d+))?$/.exec(arg.trim());
  if (!m) throw new Error(`Evidence must look like path:line or path:start-end (got "${arg}").`);
  const line = Number(m[2]);
  const endLine = m[3] ? Number(m[3]) : undefined;
  if (line < 1 || (endLine !== undefined && endLine < line)) throw new Error(`Bad line range in "${arg}".`);
  return endLine !== undefined && endLine !== line ? { file: m[1]!, line, endLine } : { file: m[1]!, line };
}

function readLines(root: string, file: string): string[] | null {
  const abs = join(root, file);
  if (!existsSync(abs) || !statSync(abs).isFile()) return null;
  return readFileSync(abs, 'utf8').split('\n');
}

/** Checks that the cited file and lines exist inside `root`, and fingerprints them. */
export function resolveEvidence(root: string, ev: Evidence): Evidence {
  const rel = toPosix(normalize(ev.file));
  if (isAbsolute(rel) || rel.startsWith('../') || rel === '..' || toPosix(relative(root, join(root, rel))).startsWith('..')) {
    throw new Error(`Evidence must be a path inside the repository (got "${ev.file}").`);
  }
  const lines = readLines(root, rel);
  if (!lines) throw new Error(`Evidence file does not exist: ${rel}`);
  const end = ev.endLine ?? ev.line;
  if (end > lines.length) throw new Error(`${rel} has ${lines.length} lines; cannot cite ${ev.line}${ev.endLine ? `-${ev.endLine}` : ''}.`);
  const out: Evidence = { file: rel, line: ev.line, sha: linesSha(lines.slice(ev.line - 1, end)) };
  if (ev.endLine !== undefined) out.endLine = ev.endLine;
  if (ev.note) out.note = ev.note;
  return out;
}

/** Whether cited lines still read the same as when they were cited. */
export function evidenceState(root: string, ev: Evidence): 'current' | 'changed' | 'missing' {
  const lines = readLines(root, ev.file);
  if (!lines) return 'missing';
  const end = ev.endLine ?? ev.line;
  if (end > lines.length) return 'changed';
  if (!ev.sha) return 'current';
  return linesSha(lines.slice(ev.line - 1, end)) === ev.sha ? 'current' : 'changed';
}

export function formatEvidence(ev: Evidence): string {
  return `${ev.file}:${ev.line}${ev.endLine ? `-${ev.endLine}` : ''}`;
}
