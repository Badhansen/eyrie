import { useMemo, useRef } from 'react';
import type { ArchNode } from '@eyrie/core';
import { entryPoints, sequenceTrace, type SequenceStep, type SequenceTrace } from '@eyrie/lens';
import { api, store, useStore } from '../state/store';
import { useLensGraph } from './useLensGraph';
import { KIND_LABEL, catClass, edgeVerbs, linkClassOf } from './vocabulary';

/** The gutter is its own pinned column, so call sites stay put while the diagram scrolls. */
const GUTTER = 150;
const LEAD = 16;
const COL_W = 156;
const ROW_H = 38;
const HEAD_H = 50;
const TOP = 30;
const BOTTOM = 34;

const centerX = (i: number) => LEAD + i * COL_W + COL_W / 2;
const rowY = (order: number) => TOP + order * ROW_H;

/**
 * One interaction over time: lifelines across the top, messages down the page
 * in the order the source registers them.
 */
export function SequenceView() {
  const { nodes, edges } = useLensGraph();
  const selected = useStore((s) => s.selected);
  const wanted = useStore((s) => s.sequenceEntry);

  const starts = useMemo(() => entryPoints(nodes, edges), [nodes, edges]);
  const entry = useMemo(() => (wanted && starts.some((n) => n.id === wanted) ? wanted : (starts[0]?.id ?? null)), [wanted, starts]);
  const trace = useMemo(() => (entry ? sequenceTrace(nodes, edges, entry) : null), [nodes, edges, entry]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  if (!starts.length) {
    return (
      <Shell toolbar={null}>
        <Notice title="Nothing to trace">A sequence starts at a page, a route or a component that calls something. This map has none yet.</Notice>
      </Shell>
    );
  }

  return (
    <Shell toolbar={<Toolbar starts={starts} entry={entry} trace={trace} />}>
      {!trace || !trace.steps.length ? (
        <Notice title="This component calls nothing">{byId.get(entry ?? '')?.label ?? 'It'} has no outgoing links on the map, so there is no sequence to draw. Pick another starting point.</Notice>
      ) : (
        <Diagram trace={trace} byId={byId} selected={selected} />
      )}
    </Shell>
  );
}

function Shell({ toolbar, children }: { toolbar: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col">
      {toolbar}
      <div className="relative min-h-0 flex-1">{children}</div>
    </div>
  );
}

function Toolbar({ starts, entry, trace }: { starts: ArchNode[]; entry: string | null; trace: SequenceTrace | null }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule bg-ink-1 px-4 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <label htmlFor="seq-entry" className="font-mono text-[10px] tracking-[0.16em] text-faint uppercase">
          Trace from
        </label>
        <select
          id="seq-entry"
          value={entry ?? ''}
          onChange={(e) => store.setSequenceEntry(e.target.value)}
          className="h-7 max-w-[260px] rounded-md border border-rule bg-ink-0 px-2 text-[12.5px] text-text focus:border-rule-strong focus:outline-none"
        >
          {starts.map((n) => (
            <option key={n.id} value={n.id}>
              {n.label} · {KIND_LABEL[n.kind]}
            </option>
          ))}
        </select>
      </div>
      {trace?.steps.length ? (
        <span className="font-mono text-[11px] text-dim">
          {trace.steps.length} {trace.steps.length === 1 ? 'message' : 'messages'} · {trace.participants.length} lifelines
          {trace.truncated ? ' · truncated' : ''}
        </span>
      ) : null}
      <p className="min-w-0 flex-1 text-[11.5px] leading-snug text-faint">
        Order follows where each call is written, not the running order: conditionals, loops and <code className="font-mono">await</code> can change it, and returns are not shown.
      </p>
    </div>
  );
}

function Diagram({ trace, byId, selected }: { trace: SequenceTrace; byId: Map<string, ArchNode>; selected: string | null }) {
  const { participants, steps } = trace;
  const width = LEAD + participants.length * COL_W + 24;
  const height = TOP + steps.length * ROW_H + BOTTOM;
  const column = new Map(participants.map((id, i) => [id, i]));
  const gutterRef = useRef<SVGSVGElement>(null);

  return (
    <div className="absolute inset-0 flex">
      <div className="w-[150px] shrink-0 overflow-hidden border-r border-rule">
        <div className="border-b border-rule" style={{ height: HEAD_H }} />
        <div className="relative overflow-hidden" style={{ height: `calc(100% - ${HEAD_H}px)` }}>
          <svg ref={gutterRef} width={GUTTER} height={height} className="sequence block">
            {steps.map((step) => (
              <Gutter key={step.id} step={step} />
            ))}
          </svg>
        </div>
      </div>
      <div
        className="scroll-thin relative min-w-0 flex-1 overflow-auto"
        onScroll={(e) => {
          const svg = gutterRef.current;
          if (svg) svg.style.transform = `translateY(${-e.currentTarget.scrollTop}px)`;
        }}
      >
        <div style={{ width }}>
          <div className="sticky top-0 z-10 border-b border-rule bg-ink-0/92 backdrop-blur" style={{ height: HEAD_H }}>
            {participants.map((id, i) => {
              const n = byId.get(id);
              if (!n) return null;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => store.select(id)}
                  title={`${n.label} · ${KIND_LABEL[n.kind]}`}
                  className={`${catClass(n)} absolute top-1.5 flex h-9 flex-col justify-center overflow-hidden rounded border px-2 text-left transition-colors ${
                    id === selected ? 'border-rule-strong bg-ink-3' : 'border-rule bg-ink-1 hover:border-rule-strong'
                  }`}
                  style={{ left: centerX(i) - COL_W / 2 + 8, width: COL_W - 16, borderLeftColor: 'var(--c)', borderLeftWidth: 3 }}
                >
                  <span className="truncate text-[12px] leading-tight font-[620] text-text">{n.label}</span>
                  <span className="truncate font-mono text-[9.5px] text-faint">{KIND_LABEL[n.kind]}</span>
                </button>
              );
            })}
          </div>
          <svg width={width} height={height} className="sequence block" role="list" aria-label={`${steps.length} messages`}>
            <defs>
              <marker id="seq-arrow" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
                <path d="M1.5,1.5 L8.5,5 L1.5,8.5" fill="none" stroke="var(--edge)" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
              </marker>
              <marker id="seq-arrow-hot" viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
                <path d="M1.5,1.5 L8.5,5 L1.5,8.5" fill="none" stroke="var(--edge-hot)" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
              </marker>
            </defs>
            {participants.map((id, i) => (
              <line key={id} className={`seq-lifeline${id === selected ? ' on' : ''}`} x1={centerX(i)} x2={centerX(i)} y1={0} y2={height - BOTTOM / 2} />
            ))}
            {steps.map((step) => (
              <Message key={step.id} step={step} column={column} byId={byId} width={width} selected={selected} />
            ))}
            {trace.truncated ? (
              <text className="seq-note" x={LEAD} y={height - 12}>
                Stops here: the trace hit its depth or size limit.
              </text>
            ) : null}
          </svg>
        </div>
      </div>
    </div>
  );
}

/** Step number and call site, in the pinned left column. */
function Gutter({ step }: { step: SequenceStep }) {
  const y = rowY(step.order);
  return (
    <g>
      <text className="seq-order" x={24} y={y + 3.5} textAnchor="end">
        {step.order + 1}
      </text>
      {step.site ? (
        <SiteLabel file={step.site.file} line={step.site.line} y={y} />
      ) : (
        <text className="seq-site muted" x={GUTTER - 14} y={y + 3.5} textAnchor="end">
          —
        </text>
      )}
    </g>
  );
}

function Message({
  step,
  column,
  byId,
  width,
  selected,
}: {
  step: SequenceStep;
  column: Map<string, number>;
  byId: Map<string, ArchNode>;
  width: number;
  selected: string | null;
}) {
  const from = byId.get(step.from);
  const to = byId.get(step.to);
  const a = column.get(step.from);
  const b = column.get(step.to);
  if (!from || !to || a === undefined || b === undefined) return null;

  const y = rowY(step.order);
  const x1 = centerX(a);
  const x2 = centerX(b);
  const mid = (x1 + x2) / 2;
  const span = Math.abs(x2 - x1);
  const hot = step.from === selected || step.to === selected;
  const verbs = edgeVerbs(step.kinds);
  const site = step.site;
  const describe = `${from.label} ${verbs} ${to.label}${step.via?.length ? `, via ${step.via.join(' › ')}` : ''}${site ? `, at ${site.file}:${site.line}` : ''}`;

  return (
    <g className={`seq-step ${linkClassOf(step.kinds)}${hot ? ' hot' : ''}${step.collapsed ? ' collapsed' : ''}`} role="listitem">
      <rect
        className="seq-hit"
        x={0}
        y={y - ROW_H / 2}
        width={width}
        height={ROW_H}
        tabIndex={0}
        role="button"
        aria-label={describe}
        onClick={() => store.select(step.to)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            store.select(step.to);
          }
        }}
      />
      <line className="seq-line" x1={x1} x2={x2} y1={y} y2={y} markerEnd={`url(#seq-arrow${hot ? '-hot' : ''})`} />
      <text className="seq-verb" x={mid} y={y - 7} textAnchor="middle">
        {truncate(step.collapsed ? `${verbs} · shown above` : verbs, Math.max(span, COL_W) - 16)}
      </text>
      <title>{describe}</title>
    </g>
  );
}

/** The call site, clickable: opens the line in the editor. */
function SiteLabel({ file, line, y }: { file: string; line: number; y: number }) {
  // The line number is the point of the label, so the file name gives way first.
  const suffix = `:${line}`;
  const stem = truncate(file.slice(file.lastIndexOf('/') + 1), GUTTER - 44 - suffix.length * 5.9);
  return (
    <g
      className="seq-site-link"
      tabIndex={0}
      role="button"
      aria-label={`Open ${file} line ${line} in the editor`}
      onClick={(e) => {
        e.stopPropagation();
        void api('/api/open', { method: 'POST', body: JSON.stringify({ file, line }) }).catch(() => {});
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        void api('/api/open', { method: 'POST', body: JSON.stringify({ file, line }) }).catch(() => {});
      }}
    >
      <text className="seq-site" x={GUTTER - 14} y={y + 3.5} textAnchor="end">
        {stem}
        {suffix}
      </text>
      <title>{`${file}:${line} — open in editor`}</title>
    </g>
  );
}

/** Rough character budget; SVG has no ellipsis and the labels are short. */
function truncate(text: string, maxPx: number): string {
  const max = Math.max(4, Math.floor(maxPx / 5.9));
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="max-w-sm text-center">
        <h2 className="wide text-[15px] font-[700]">{title}</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-dim">{children}</p>
      </div>
    </div>
  );
}
