import type { CodeEdgeKind } from '@eyrie/core';
import type { CodeGraphStore } from './store.js';

/** Edges that mean "depends on" (structure edges like CONTAINS are excluded). */
export const DEPENDENCY_EDGES: readonly CodeEdgeKind[] = [
  'CALLS',
  'USES',
  'IMPORTS',
  'HTTP_CALL',
  'READS_FROM',
  'WRITES_TO',
  'EXTENDS',
  'IMPLEMENTS',
  'PUBLISHES',
  'SUBSCRIBES',
  'TRIGGERS',
  'DEPENDS_ON',
];

export interface TraversalHit {
  id: string;
  depth: number;
  /** Node we arrived from. */
  parent: string | null;
}

export interface TraversalOptions {
  kinds?: readonly CodeEdgeKind[];
  maxDepth?: number;
  limit?: number;
}

/**
 * Breadth-first traversal. `out` follows dependencies (what X uses),
 * `in` follows dependents (what uses X).
 */
export function traverse(store: CodeGraphStore, start: readonly string[], direction: 'out' | 'in', opts: TraversalOptions = {}): Map<string, TraversalHit> {
  const kinds = opts.kinds ?? DEPENDENCY_EDGES;
  const maxDepth = opts.maxDepth ?? Infinity;
  const limit = opts.limit ?? 10_000;
  const seen = new Map<string, TraversalHit>();
  let frontier = start.filter((id) => store.hasNode(id));
  for (const id of frontier) seen.set(id, { id, depth: 0, parent: null });
  let depth = 0;
  while (frontier.length && depth < maxDepth && seen.size < limit) {
    depth++;
    const next: string[] = [];
    for (const id of frontier) {
      const edges = direction === 'out' ? store.outEdges(id, kinds) : store.inEdges(id, kinds);
      for (const e of edges) {
        const other = direction === 'out' ? e.target : e.source;
        if (seen.has(other)) continue;
        seen.set(other, { id: other, depth, parent: id });
        next.push(other);
      }
    }
    frontier = next;
  }
  return seen;
}

/** Shortest dependency path from `from` to `to`, or null. */
export function shortestPath(store: CodeGraphStore, from: string, to: string, kinds: readonly CodeEdgeKind[] = DEPENDENCY_EDGES): string[] | null {
  const hits = traverse(store, [from], 'out', { kinds, limit: 50_000 });
  if (!hits.has(to)) return null;
  const path: string[] = [];
  for (let cur: string | null = to; cur; cur = hits.get(cur)?.parent ?? null) path.unshift(cur);
  return path;
}
