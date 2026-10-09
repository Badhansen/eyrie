import { BaseEdge, EdgeLabelRenderer, Handle, Panel, ReactFlow, ReactFlowProvider, useReactFlow, useViewport, type EdgeProps, type NodeProps } from '@xyflow/react';
import { Maximize2, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import type { ArchNode } from '@eyrie/core';
import type { SequenceStep, SequenceTrace } from '@eyrie/lens';
import { api, store } from '../state/store';
import { reducedMotion } from './effects';
import { KIND_LABEL, catClass } from './vocabulary';
import { SEQUENCE_COLUMN, SEQUENCE_HEAD, SEQUENCE_ROW, SEQUENCE_WIDTH, messageY, sequenceLayout, type MessageEdge, type ParticipantNode } from './sequence-layout';

const Participant = memo(function Participant({ data }: NodeProps<ParticipantNode>) {
  return <div className={`sequence-participant ${catClass(data.node)}${data.active ? ' is-active' : ''}`} style={{ height: data.height }}>
    <button type="button" className="sequence-participant-title nodrag nopan" aria-pressed={data.active} title={`${data.node.label} · ${KIND_LABEL[data.node.kind]}`} onClick={() => store.select(data.node.id)}>
      <strong>{data.node.label}</strong><span>{KIND_LABEL[data.node.kind]}</span>
    </button>
    <div className="sequence-lifeline" />
    {data.handles.map((handle) => <Handle key={handle.id} id={handle.id} type={handle.type} position={handle.position} isConnectable={false} style={{ top: handle.top, left: SEQUENCE_WIDTH / 2, right: 'auto' }} />)}
  </div>;
});

function Message({ id, sourceX, sourceY, targetX, targetY, markerEnd, data }: EdgeProps<MessageEdge>) {
  if (!data) return null;
  const path = data.self ? `M${sourceX},${sourceY} h48 v18 H${targetX}` : `M${sourceX},${sourceY} L${targetX},${targetY}`;
  const center = data.self ? sourceX + 48 : (sourceX + targetX) / 2;
  return <>
    <BaseEdge id={id} path={path} markerEnd={markerEnd} interactionWidth={24} className="seq-line" />
    <EdgeLabelRenderer>
      <button type="button" className={`sequence-message-label nodrag nopan${data.hot ? ' is-active' : ''}${data.step.collapsed ? ' is-collapsed' : ''}`} style={{ transform: `translate(-50%, -100%) translate(${center}px, ${sourceY - 6}px)`, maxWidth: data.self ? 150 : Math.max(120, Math.abs(targetX - sourceX) - 24) }} title={data.description} aria-label={data.description} onClick={() => store.select(data.step.to)}>
        {data.verb}
      </button>
    </EdgeLabelRenderer>
    <title>{data.description}</title>
  </>;
}

const NODE_TYPES = { participant: Participant };
const EDGE_TYPES = { message: Message };

export function SequenceCanvas(props: { trace: SequenceTrace; byId: Map<string, ArchNode>; selected: string | null }) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>;
}

function Canvas({ trace, byId, selected }: { trace: SequenceTrace; byId: Map<string, ArchNode>; selected: string | null }) {
  const host = useRef<HTMLDivElement>(null);
  const flow = useReactFlow<ParticipantNode, MessageEdge>();
  const layout = useMemo(() => sequenceLayout(trace, byId, selected), [trace, byId, selected]);
  const home = useCallback(() => {
    const narrow = (host.current?.clientWidth ?? 1000) < 600;
    void flow.setViewport({ x: narrow ? 122 : 172, y: 16, zoom: narrow ? 0.85 : 1 }, { duration: 0 });
  }, [flow]);
  useEffect(() => { home(); }, [trace.entry, home]);
  useEffect(() => {
    let narrow = (host.current?.clientWidth ?? 1000) < 600;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry!.contentRect.width < 600;
      if (next !== narrow) { narrow = next; home(); }
    });
    observer.observe(host.current!);
    return () => observer.disconnect();
  }, [home]);
  return <div ref={host} className="sequence-canvas">
    <ReactFlow<ParticipantNode, MessageEdge> nodes={layout.nodes} edges={layout.edges} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES}
      nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} minZoom={0.25} maxZoom={2} zoomOnDoubleClick={false}
      onEdgeClick={(_, edge) => store.select(edge.target)} onPaneClick={() => store.select(null)}
      fitView={false} attributionPosition="bottom-right" aria-label="Request sequence diagram">
      <Gutter steps={trace.steps} />
      <Panel position="bottom-right" className="sequence-tools">
        <button type="button" title="Zoom in" aria-label="Zoom in sequence" onClick={() => void flow.zoomIn({ duration: reducedMotion() ? 0 : 180 })}><ZoomIn size={16} /></button>
        <button type="button" title="Zoom out" aria-label="Zoom out sequence" onClick={() => void flow.zoomOut({ duration: reducedMotion() ? 0 : 180 })}><ZoomOut size={16} /></button>
        <button type="button" title="Fit sequence" aria-label="Fit sequence" onClick={() => void flow.fitBounds({ x: -150, y: 0, width: layout.nodes.length * SEQUENCE_COLUMN + 150, height: layout.nodes[0]?.data.height ?? 200 }, { padding: 0.15, duration: reducedMotion() ? 0 : 240 })}><Maximize2 size={16} /></button>
        <button type="button" title="Reset sequence view" aria-label="Reset sequence view" onClick={home}><RotateCcw size={16} /></button>
      </Panel>
      {trace.truncated ? <Panel position="top-right" className="sequence-limit" role="status">Trace limit reached</Panel> : null}
    </ReactFlow>
  </div>;
}

function Gutter({ steps }: { steps: SequenceStep[] }) {
  const { y, zoom } = useViewport();
  const rowHeight = Math.min(26, SEQUENCE_ROW * zoom);
  return <div className="sequence-gutter"><div className="sequence-gutter-heading" style={{ height: Math.max(0, y + SEQUENCE_HEAD * zoom) }}>Source</div>
    {steps.map((step) => <div className="sequence-source" key={step.id} style={{ top: y + messageY(step.order) * zoom - rowHeight / 2, height: rowHeight }}>
      <span>{step.order + 1}</span>
      {step.site ? <button type="button" title={`${step.site.file}:${step.site.line}`} aria-label={`Open ${step.site.file} line ${step.site.line} in the editor`} onClick={() => { const site = step.site!; void api('/api/open', { method: 'POST', body: JSON.stringify({ file: site.file, line: site.line }) }).catch(() => {}); }}>
        <span>{step.site.file.split('/').at(-1)}</span><b>:{step.site.line}</b>
      </button> : <span className="sequence-no-site">-</span>}
    </div>)}
  </div>;
}
