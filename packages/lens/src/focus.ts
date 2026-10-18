/**
 * Trace, impact and paths over the architecture graph. Pure functions, shared
 * by the browser (selection focus, the details panel) and the engine side
 * (the MCP server), so both answer "what does this affect" the same way.
 */
import type { ArchEdge, ArchNode } from '@eyrie/core';

/** `downstream` follows what a component depends on; `upstream` what depends on it. */
export type FocusMode = 'neighbors' | 'downstream' | 'upstream';

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

/** Whether a component matches a search: its label, sublabel, domain or one of its files. */
export function matches(node: ArchNode, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return (
    node.label.toLowerCase().includes(q) ||
    (node.sublabel?.toLowerCase().includes(q) ?? false) ||
    node.domain?.toLowerCase() === q ||
    node.files.some((f) => f.toLowerCase().includes(q))
  );
}

/**
 * The shortest chain of dependencies from one component to another, following
 * edges in their direction: `[from, …, to]` with the edges between them, or
 * null when `from` cannot reach `to`.
 */
export function archPath(edges: Iterable<ArchEdge>, from: string, to: string): { nodes: string[]; edges: ArchEdge[] } | null {
  if (from === to) return { nodes: [from], edges: [] };
  const out = new Map<string, ArchEdge[]>();
  for (const e of edges) {
    const list = out.get(e.source);
    if (list) list.push(e);
    else out.set(e.source, [e]);
  }
  const via = new Map<string, ArchEdge>();
  const seen = new Set([from]);
  let frontier = [from];
  while (frontier.length) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const e of out.get(cur) ?? []) {
        if (seen.has(e.target)) continue;
        seen.add(e.target);
        via.set(e.target, e);
        if (e.target === to) {
          const path: ArchEdge[] = [];
          for (let at = to; at !== from; at = via.get(at)!.source) path.unshift(via.get(at)!);
          return { nodes: [from, ...path.map((p) => p.target)], edges: path };
        }
        next.push(e.target);
      }
    }
    frontier = next;
  }
  return null;
}
