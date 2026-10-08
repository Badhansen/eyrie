import type { ArchEdge, ArchNode } from '@eyrie/core';
import type { FocusMode } from '../state/store';

export interface Focus {
  nodes: Set<string>;
  edges: Set<string>;
  /** Depth from the selected node (0 = selected). */
  depth: Map<string, number>;
}

/** Nodes and edges to emphasise for a selection. */
export function focusSet(edges: Iterable<ArchEdge>, id: string, mode: FocusMode): Focus {
  const list = [...edges];
  const depth = new Map<string, number>([[id, 0]]);
  const hot = new Set<string>();
  if (mode === 'neighbors') {
    for (const e of list) {
      if (e.source === id) {
        depth.set(e.target, 1);
        hot.add(e.id);
      } else if (e.target === id) {
        depth.set(e.source, 1);
        hot.add(e.id);
      }
    }
    return { nodes: new Set(depth.keys()), edges: hot, depth };
  }
  const down = mode === 'downstream';
  let frontier = [id];
  let d = 0;
  while (frontier.length) {
    d++;
    const next: string[] = [];
    for (const cur of frontier) {
      for (const e of list) {
        const from = down ? e.source : e.target;
        const to = down ? e.target : e.source;
        if (from !== cur) continue;
        hot.add(e.id);
        if (!depth.has(to)) {
          depth.set(to, d);
          next.push(to);
        }
      }
    }
    frontier = next;
  }
  return { nodes: new Set(depth.keys()), edges: hot, depth };
}

export interface Impact {
  direct: number;
  indirect: number;
  apis: string[];
  ui: string[];
  services: string[];
  data: string[];
  external: string[];
}

/** Summarises a downstream or upstream closure by kind of component. */
export function impactOf(nodes: Map<string, ArchNode>, focus: Focus): Impact {
  const out: Impact = { direct: 0, indirect: 0, apis: [], ui: [], services: [], data: [], external: [] };
  for (const [id, d] of focus.depth) {
    if (d === 0) continue;
    if (d === 1) out.direct++;
    else out.indirect++;
    const n = nodes.get(id);
    if (!n) continue;
    if (n.kind === 'api_route' || n.kind === 'server_action' || n.kind === 'middleware') out.apis.push(n.label);
    else if (n.lane === 'ui') out.ui.push(n.label);
    else if (n.kind === 'database_model' || n.kind === 'repository') out.data.push(n.label);
    else if (n.kind === 'external_service') out.external.push(n.label);
    else out.services.push(n.label);
  }
  return out;
}

export function matches(node: ArchNode, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return (
    node.label.toLowerCase().includes(q) ||
    (node.sublabel?.toLowerCase().includes(q) ?? false) ||
    (node.domain?.toLowerCase() === q) ||
    node.files.some((f) => f.toLowerCase().includes(q))
  );
}
