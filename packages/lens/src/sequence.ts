import { ARCH_LANES, type ArchEdge, type ArchKind, type ArchNode, type CodeEdgeKind, type SourceRef } from '@eyrie/core';

/** One message: a component calling another, in the order the source registers it. */
export interface SequenceStep {
  /** Stable within a trace; used as a list key. */
  id: string;
  /** Row number, 0-based. */
  order: number;
  /** Distance from the entry point. */
  depth: number;
  from: string;
  to: string;
  kinds: CodeEdgeKind[];
  /** Call site that produced the edge, when the graph recorded one. */
  site?: SourceRef;
  /** Hidden intermediate components the edge passes through. */
  via?: string[];
  /** The target's own calls appear earlier in the trace, so they are not repeated. */
  collapsed: boolean;
}

export interface SequenceTrace {
  entry: string;
  /** Lifelines, in order of first appearance. */
  participants: string[];
  steps: SequenceStep[];
  /** Hit the depth or step budget; the trace is not the whole story. */
  truncated: boolean;
}

const MAX_DEPTH = 8;
const MAX_STEPS = 200;

/** Components a request can start from, best first. */
const ENTRY_PRIORITY: Partial<Record<ArchKind, number>> = {
  page: 0,
  middleware: 1,
  api_route: 2,
  server_action: 3,
  background_job: 4,
};

export function entryPoints(nodes: readonly ArchNode[], edges: readonly ArchEdge[]): ArchNode[] {
  const hasOut = new Set(edges.map((e) => e.source));
  const hasIn = new Set(edges.map((e) => e.target));
  return nodes
    .filter((n) => hasOut.has(n.id) && (n.kind in ENTRY_PRIORITY || n.lane === 'ui' || !hasIn.has(n.id)))
    .sort((a, b) => (ENTRY_PRIORITY[a.kind] ?? 5) - (ENTRY_PRIORITY[b.kind] ?? 5) || a.label.localeCompare(b.label));
}

/**
 * Walks the architecture graph from one entry point into an ordered list of
 * messages: a sequence view of a single interaction.
 *
 * Order comes from where each call is written in the source — the graph records
 * a call site per edge. That is the only ordering static analysis can give:
 * conditionals, loops and `await` can make the running order differ, and
 * returns are not modelled at all. A component's own calls are expanded the
 * first time it is reached; later messages to it are marked `collapsed`.
 */
export function sequenceTrace(nodes: readonly ArchNode[], edges: readonly ArchEdge[], entryId: string): SequenceTrace | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (!byId.has(entryId)) return null;

  const out = new Map<string, ArchEdge[]>();
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    const list = out.get(e.source);
    if (list) list.push(e);
    else out.set(e.source, [e]);
  }
  const lane = (id: string) => ARCH_LANES.indexOf(byId.get(id)!.lane);
  const label = (id: string) => byId.get(id)!.label;
  for (const list of out.values()) {
    list.sort((a, b) => {
      const sa = a.sites?.[0];
      const sb = b.sites?.[0];
      if (sa && sb) {
        const bySite = sa.file.localeCompare(sb.file) || sa.line - sb.line;
        if (bySite) return bySite;
      } else if (sa || sb) return sa ? -1 : 1;
      return lane(a.target) - lane(b.target) || label(a.target).localeCompare(label(b.target));
    });
  }

  const steps: SequenceStep[] = [];
  const participants = [entryId];
  const expanded = new Set([entryId]);
  let truncated = false;

  const walk = (from: string, depth: number, stack: Set<string>) => {
    if (depth >= MAX_DEPTH) {
      if (out.get(from)?.length) truncated = true;
      return;
    }
    for (const e of out.get(from) ?? []) {
      if (stack.has(e.target)) continue; // a cycle; the call is already on screen above
      if (steps.length >= MAX_STEPS) {
        truncated = true;
        return;
      }
      const collapsed = expanded.has(e.target);
      const step: SequenceStep = {
        id: `${e.id}#${steps.length}`,
        order: steps.length,
        depth,
        from,
        to: e.target,
        kinds: e.kinds,
        collapsed,
      };
      if (e.sites?.[0]) step.site = e.sites[0];
      if (e.via?.length) step.via = e.via;
      steps.push(step);
      if (!participants.includes(e.target)) participants.push(e.target);
      if (collapsed) continue;
      expanded.add(e.target);
      stack.add(e.target);
      walk(e.target, depth + 1, stack);
      stack.delete(e.target);
    }
  };
  walk(entryId, 0, new Set([entryId]));

  return { entry: entryId, participants, steps, truncated };
}
