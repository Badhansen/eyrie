import { useMemo } from 'react';
import type { ArchEdge, ArchNode } from '@eyrie/core';
import { dataFlowLens, systemLens, type SystemPart } from '@eyrie/lens';
import { useStore, type Mark } from '../state/store';

/**
 * The architecture graph as the current lens shows it. The data-flow lens is a
 * filter and a relabelling; the System lens groups components into boxes; the
 * sequence lens redraws the whole graph, so it takes it unchanged.
 */
export function useLensGraph(): { nodes: ArchNode[]; edges: ArchEdge[] } {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const lens = useStore((s) => s.lens);
  return useMemo(() => {
    const all = { nodes: [...nodes.values()], edges: [...edges.values()] };
    if (lens === 'dataflow') return dataFlowLens(all.nodes, all.edges);
    if (lens === 'system') return systemLens(all.nodes, all.edges);
    return all;
  }, [nodes, edges, lens]);
}

/** Maps component ids to the System-view box that shows each one (or to itself). */
function boxIndex(nodes: readonly ArchNode[]): Map<string, string> {
  const boxOf = new Map<string, string>();
  for (const n of nodes) for (const id of (n.meta?.system as SystemPart | undefined)?.members ?? [n.id]) boxOf.set(id, n.id);
  return boxOf;
}

/** Component ids → the boxes that hold them, for highlighting in the System view. */
export function boxIds(ids: Iterable<string>, nodes: readonly ArchNode[]): Set<string> {
  const boxOf = boxIndex(nodes);
  return new Set([...ids].map((id) => boxOf.get(id)).filter((id): id is string => !!id));
}

/** A box carries a change mark while any component inside it does. */
export function boxMarks(marks: Map<string, Mark>, nodes: readonly ArchNode[]): Map<string, Mark> {
  const boxOf = boxIndex(nodes);
  const out = new Map<string, Mark>();
  for (const [id, mark] of marks) {
    const box = boxOf.get(id);
    if (!box) continue;
    out.set(box, box === id ? mark : 'modified');
  }
  return out;
}
