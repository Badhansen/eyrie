import { useMemo } from 'react';
import type { ArchEdge, ArchNode } from '@eyrie/core';
import { dataFlowLens } from '@eyrie/lens';
import { useStore } from '../state/store';

/**
 * The architecture graph as the current lens shows it. The data-flow lens is a
 * filter and a relabelling; the sequence lens redraws the whole graph, so it
 * takes it unchanged.
 */
export function useLensGraph(): { nodes: ArchNode[]; edges: ArchEdge[] } {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const lens = useStore((s) => s.lens);
  return useMemo(() => {
    const all = { nodes: [...nodes.values()], edges: [...edges.values()] };
    return lens === 'dataflow' ? dataFlowLens(all.nodes, all.edges) : all;
  }, [nodes, edges, lens]);
}
