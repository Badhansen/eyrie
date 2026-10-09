import { useMemo } from 'react';
import type { ArchNode } from '@eyrie/core';
import { entryPoints, sequenceTrace, type SequenceTrace } from '@eyrie/lens';
import { store, useStore } from '../state/store';
import { useLensGraph } from './useLensGraph';
import { KIND_LABEL } from './vocabulary';
import { SequenceCanvas } from './SequenceCanvas';

export function SequenceView() {
  const { nodes, edges } = useLensGraph();
  const selected = useStore((s) => s.selected);
  const wanted = useStore((s) => s.sequenceEntry);
  const starts = useMemo(() => entryPoints(nodes, edges), [nodes, edges]);
  const entry = useMemo(() => (wanted && starts.some((n) => n.id === wanted) ? wanted : (starts[0]?.id ?? null)), [wanted, starts]);
  const trace = useMemo(() => (entry ? sequenceTrace(nodes, edges, entry) : null), [nodes, edges, entry]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  return <div className="flex h-full w-full flex-col">
    {starts.length ? <Toolbar starts={starts} entry={entry} trace={trace} /> : null}
    <div className="relative min-h-0 flex-1">
      {!starts.length ? <Notice title="Nothing to trace">A sequence starts at a page, a route or a component that calls something. This map has none yet.</Notice>
        : !trace?.steps.length ? <Notice title="This component calls nothing">{byId.get(entry ?? '')?.label ?? 'It'} has no outgoing links on the map, so there is no sequence to draw. Pick another starting point.</Notice>
          : <SequenceCanvas trace={trace} byId={byId} selected={selected} />}
    </div>
  </div>;
}

function Toolbar({ starts, entry, trace }: { starts: ArchNode[]; entry: string | null; trace: SequenceTrace | null }) {
  return <div className="sequence-toolbar">
    <div className="sequence-entry">
      <label htmlFor="seq-entry">Trace from</label>
      <select id="seq-entry" value={entry ?? ''} onChange={(e) => store.setSequenceEntry(e.target.value)}>
        {starts.map((n) => <option key={n.id} value={n.id}>{n.label} · {KIND_LABEL[n.kind]}</option>)}
      </select>
    </div>
    {trace?.steps.length ? <span className="sequence-summary">{trace.steps.length} {trace.steps.length === 1 ? 'message' : 'messages'} · {trace.participants.length} lifelines{trace.truncated ? ' · truncated' : ''}</span> : null}
    <p>Order follows where each call is written, not the running order: conditionals, loops and <code>await</code> can change it, and returns are not shown.</p>
  </div>;
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="grid h-full place-items-center p-6"><div className="max-w-sm text-center">
    <h2 className="wide text-[15px] font-[700]">{title}</h2><p className="mt-2 text-[13px] leading-relaxed text-dim">{children}</p>
  </div></div>;
}
