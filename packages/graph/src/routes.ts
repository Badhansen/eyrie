/**
 * Framework routing conventions (Next.js App Router and Pages Router) and
 * matching of HTTP call URLs to route nodes.
 */

export type NextFileRole = 'route' | 'page' | 'layout' | 'middleware' | 'api-page';

export interface NextFileInfo {
  role: NextFileRole;
  /** URL path, e.g. '/api/resume/:id'. */
  path: string;
  /** Directory containing the Next.js app (for monorepos), '' at repo root. */
  appRoot: string;
}

export const HTTP_EXPORTS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const SCRIPT = /\.(ts|tsx|js|jsx|mjs|mts)$/;

function segmentToPath(seg: string): string | null {
  if (/^\(.*\)$/.test(seg)) return null; // route group
  if (seg.startsWith('@')) return null; // parallel route slot
  const optCatchAll = /^\[\[\.\.\.(\w+)\]\]$/.exec(seg);
  if (optCatchAll) return `*${optCatchAll[1]}?`;
  const catchAll = /^\[\.\.\.(\w+)\]$/.exec(seg);
  if (catchAll) return `*${catchAll[1]}`;
  const dynamic = /^\[(\w+)\]$/.exec(seg);
  if (dynamic) return `:${dynamic[1]}`;
  return seg.replace(/^\(\.+\)/, '');
}

function toUrl(segments: string[]): string {
  const parts = segments.map(segmentToPath).filter((s): s is string => !!s);
  return `/${parts.join('/')}`;
}

function appRootOf(segments: string[], idx: number): string {
  const root = segments.slice(0, idx);
  if (root[root.length - 1] === 'src') root.pop();
  return root.join('/');
}

/**
 * Classifies a file by Next.js conventions. `appRoots` (directories that
 * contain an app/ or pages/ router) is needed to recognise middleware.ts.
 */
export function nextFileInfo(file: string, appRoots?: ReadonlySet<string>): NextFileInfo | null {
  const segments = file.split('/');
  const name = segments[segments.length - 1]!;
  if (!SCRIPT.test(name)) return null;
  const stem = name.replace(SCRIPT, '');

  if (stem === 'middleware' || stem === 'proxy') {
    const root = appRootOf(segments, segments.length - 1);
    if (appRoots ? appRoots.has(root) : root === '') return { role: 'middleware', path: '/', appRoot: root };
  }

  const appIdx = segments.indexOf('app');
  if (appIdx !== -1 && appIdx < segments.length - 1) {
    const inner = segments.slice(appIdx + 1, -1);
    const appRoot = appRootOf(segments, appIdx);
    if (stem === 'route') return { role: 'route', path: toUrl(inner), appRoot };
    if (stem === 'page') return { role: 'page', path: toUrl(inner), appRoot };
    if (stem === 'layout') return { role: 'layout', path: toUrl(inner), appRoot };
  }

  const pagesIdx = segments.indexOf('pages');
  if (pagesIdx !== -1 && pagesIdx < segments.length - 1) {
    const inner = segments.slice(pagesIdx + 1);
    inner[inner.length - 1] = stem === 'index' ? '' : stem;
    const clean = inner.filter((s) => s !== '');
    const appRoot = appRootOf(segments, pagesIdx);
    if (clean[0] === 'api') return { role: 'api-page', path: toUrl(clean), appRoot };
    if (stem.startsWith('_')) return null;
    if (/\.(tsx|jsx)$/.test(name)) return { role: 'page', path: toUrl(clean), appRoot };
  }
  return null;
}

/** Normalise a URL found in code: strip origin placeholders, query and hash. */
export function normalizeUrlPath(url: string): string | null {
  let u = url.trim();
  if (/^https?:\/\//.test(u)) return null;
  u = u.split(/[?#]/)[0]!;
  const api = u.indexOf('/api/');
  if (api > 0 && u.startsWith(':param')) u = u.slice(api);
  if (u.startsWith(':param')) return null;
  if (!u.startsWith('/')) return null;
  if (u.length > 1) u = u.replace(/\/+$/, '');
  return u;
}

/** Scores how well a concrete URL matches a route pattern; 0 = no match. */
export function matchRoutePath(url: string, route: string): number {
  const us = url.split('/').filter(Boolean);
  const rs = route.split('/').filter(Boolean);
  let score = 1;
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i]!;
    const u = us[i];
    if (r.startsWith('*')) {
      if (u === undefined && !r.endsWith('?')) return 0;
      return score + 0.5;
    }
    if (u === undefined) return 0;
    if (r.startsWith(':')) score += u === ':param' ? 2 : 1;
    else if (u === r) score += 3;
    else if (u === ':param' || u.includes(':param')) score += 0.5;
    else return 0;
  }
  return us.length === rs.length ? score : 0;
}
