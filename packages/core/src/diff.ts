import type { ArchEdge, ArchNode, CodeEdge, CodeNode } from './graph.js';

export interface Diff<N, E> {
  addedNodes: N[];
  updatedNodes: N[];
  removedNodes: string[];
  addedEdges: E[];
  updatedEdges: E[];
  removedEdges: string[];
}

export type CodeDiff = Diff<CodeNode, CodeEdge>;
export type ArchDiff = Diff<ArchNode, ArchEdge>;

export function emptyDiff<N, E>(): Diff<N, E> {
  return { addedNodes: [], updatedNodes: [], removedNodes: [], addedEdges: [], updatedEdges: [], removedEdges: [] };
}

export function isEmptyDiff(d: Diff<unknown, unknown>): boolean {
  return (
    d.addedNodes.length === 0 &&
    d.updatedNodes.length === 0 &&
    d.removedNodes.length === 0 &&
    d.addedEdges.length === 0 &&
    d.updatedEdges.length === 0 &&
    d.removedEdges.length === 0
  );
}

/** Items are built deterministically, so JSON equality is a sound change check. */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function diffCollections<T extends { id: string }>(
  before: Iterable<T>,
  after: Iterable<T>,
): { added: T[]; updated: T[]; removed: string[] } {
  const prev = new Map<string, T>();
  for (const item of before) prev.set(item.id, item);
  const added: T[] = [];
  const updated: T[] = [];
  const seen = new Set<string>();
  for (const item of after) {
    seen.add(item.id);
    const old = prev.get(item.id);
    if (!old) added.push(item);
    else if (!same(old, item)) updated.push(item);
  }
  const removed: string[] = [];
  for (const id of prev.keys()) if (!seen.has(id)) removed.push(id);
  return { added, updated, removed };
}

export function diffGraphs<N extends { id: string }, E extends { id: string }>(
  before: { nodes: Iterable<N>; edges: Iterable<E> },
  after: { nodes: Iterable<N>; edges: Iterable<E> },
): Diff<N, E> {
  const n = diffCollections(before.nodes, after.nodes);
  const e = diffCollections(before.edges, after.edges);
  return {
    addedNodes: n.added,
    updatedNodes: n.updated,
    removedNodes: n.removed,
    addedEdges: e.added,
    updatedEdges: e.updated,
    removedEdges: e.removed,
  };
}

/** Apply a diff to id-keyed maps in place. */
export function applyDiff<N extends { id: string }, E extends { id: string }>(
  nodes: Map<string, N>,
  edges: Map<string, E>,
  diff: Diff<N, E>,
): void {
  for (const id of diff.removedEdges) edges.delete(id);
  for (const id of diff.removedNodes) nodes.delete(id);
  for (const n of diff.addedNodes) nodes.set(n.id, n);
  for (const n of diff.updatedNodes) nodes.set(n.id, n);
  for (const e of diff.addedEdges) edges.set(e.id, e);
  for (const e of diff.updatedEdges) edges.set(e.id, e);
}
