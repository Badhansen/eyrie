import type { ArchEdge, ArchGraph, ArchKind, ArchNode, CodeEdgeKind } from '@eyrie/core';

/** What an edge does to data. Drives direction and styling in the data-flow view. */
export type DataRole = 'read' | 'write' | 'readwrite' | 'transfer' | 'carry';

/** Components that hold or receive data: the sources and sinks of the view. */
const STORE_KINDS = new Set<ArchKind>(['database_model', 'external_service', 'queue', 'repository']);

/** Edge kinds that move data or cross a process boundary. */
const MOVES_DATA = new Set<CodeEdgeKind>(['READS_FROM', 'WRITES_TO', 'HTTP_CALL', 'PUBLISHES', 'SUBSCRIBES']);

/**
 * Classifies a lifted edge. Reads and writes come from ORM and table access;
 * `transfer` is a call that leaves the process — an HTTP request, or any call
 * into an external service, since an SDK method is a network round trip;
 * `carry` is an in-process hand-off that merely passes data along.
 */
export function dataRole(kinds: readonly CodeEdgeKind[], targetKind?: ArchKind): DataRole {
  const writes = kinds.includes('WRITES_TO') || kinds.includes('PUBLISHES');
  const reads = kinds.includes('READS_FROM') || kinds.includes('SUBSCRIBES');
  if (writes && reads) return 'readwrite';
  if (writes) return 'write';
  if (reads) return 'read';
  if (kinds.includes('HTTP_CALL') || targetKind === 'external_service') return 'transfer';
  return 'carry';
}

/**
 * Data-flow view of the architecture graph.
 *
 * Keeps the components that touch data — stores, and anything that reads,
 * writes or ships it — plus the components that sit on a path from an entry
 * point to one of them, so the chain from a request to its store stays whole.
 * Components with no data path at all (a static page, a dead-end helper) drop
 * out. Every surviving edge is tagged with a `role`, and reads are reversed so
 * the arrow points the way the data travels: out of the store, into its reader.
 *
 * Deterministic: a filter and a relabelling of edges that static analysis
 * already produced. Nothing is inferred.
 */
export function dataFlowLens(nodes: readonly ArchNode[], edges: readonly ArchEdge[]): ArchGraph {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const live = edges.filter((e) => byId.has(e.source) && byId.has(e.target));

  const primary = new Set<string>();
  for (const n of nodes) if (STORE_KINDS.has(n.kind)) primary.add(n.id);
  for (const e of live) {
    if (!e.kinds.some((k) => MOVES_DATA.has(k)) && byId.get(e.target)!.kind !== 'external_service') continue;
    primary.add(e.source);
    primary.add(e.target);
  }

  // Pages, webhooks and jobs sit at the head of a flow: nothing calls them, so
  // they are origins rather than middlemen, and count as starting points.
  const targeted = new Set(live.map((e) => e.target));
  const origins = new Set([...primary, ...nodes.filter((n) => !targeted.has(n.id)).map((n) => n.id)]);

  const downstream = reach(origins, adjacency(live, 'out'));
  const upstream = reach(primary, adjacency(live, 'in'));
  const kept = new Set<string>();
  for (const n of nodes) if (primary.has(n.id) || (downstream.has(n.id) && upstream.has(n.id))) kept.add(n.id);

  const out: ArchEdge[] = [];
  for (const e of live) {
    if (!kept.has(e.source) || !kept.has(e.target)) continue;
    const role = dataRole(e.kinds, byId.get(e.target)!.kind);
    const flipped = role === 'read';
    out.push({
      ...e,
      source: flipped ? e.target : e.source,
      target: flipped ? e.source : e.target,
      meta: { ...e.meta, role, flipped },
    });
  }
  return { nodes: nodes.filter((n) => kept.has(n.id)), edges: out };
}

function adjacency(edges: readonly ArchEdge[], dir: 'out' | 'in'): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const e of edges) {
    const from = dir === 'out' ? e.source : e.target;
    const to = dir === 'out' ? e.target : e.source;
    const list = m.get(from);
    if (list) list.push(to);
    else m.set(from, [to]);
  }
  return m;
}

function reach(seeds: ReadonlySet<string>, adj: Map<string, string[]>): Set<string> {
  const seen = new Set(seeds);
  const queue = [...seeds];
  while (queue.length) {
    for (const next of adj.get(queue.pop()!) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}
