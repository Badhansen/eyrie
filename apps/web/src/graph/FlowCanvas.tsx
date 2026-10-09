import {
  BaseEdge, Background, BackgroundVariant, Handle, MarkerType, MiniMap, Position, ReactFlow,
  ViewportPortal, useReactFlow, useViewport, type Edge, type EdgeProps, type Node, type NodeProps, type ReactFlowInstance,
} from '@xyflow/react';
import { ArrowLeft, ArrowRight, Boxes, Database, FileCode2, Network, Route } from 'lucide-react';
import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { ArchNode } from '@eyrie/core';
import type { Mark } from '../state/store';
import { focusSet } from './analysis';
import { reducedMotion, sendParticle, startFlow } from './effects';
import { NODE_H, NODE_W, roundedPath, type Layout, type PlacedNode, type Point } from './layout';
import type { GraphRenderer, Highlight, RendererCallbacks } from './renderer';
import { KIND_LABEL, LANE_LABEL, catClass, dataRoleOf, edgeVerbs, isBroken, linkClass } from './vocabulary';

type ComponentNode = Node<{ node: ArchNode; mark?: Mark; dim: boolean; faded: boolean; match: boolean; exiting: boolean }, 'component'>;
type DependencyEdge = Edge<{ points: Point[]; hot: boolean; flow: boolean; sweep: number; description: string }, 'dependency'>;
type Instance = ReactFlowInstance<ComponentNode, DependencyEdge>;
const EMPTY_HIGHLIGHT: Highlight = { selected: null, focus: null, flow: false, matches: null, frame: null };
const GLYPH: Record<Mark, string> = { new: '+', modified: '~', removed: '−' };

const Component = memo(function Component({ data, selected }: NodeProps<ComponentNode>) {
  const { node, mark, dim, faded, match, exiting } = data;
  const Icon = node.lane === 'ui' ? FileCode2 : node.lane === 'api' || node.lane === 'edge' ? Route : node.lane === 'data' ? Database : node.lane === 'external' ? Network : Boxes;
  const path = node.sublabel ?? node.source?.file ?? '';
  return (
    <div className={`flow-node ${catClass(node)}${selected ? ' is-selected' : ''}${dim ? ' is-dim' : ''}${faded ? ' is-faded' : ''}${match ? ' is-match' : ''}${isBroken(node) ? ' is-broken' : ''}${mark ? ` mark-${mark}` : ''}${exiting ? ' is-exiting' : ''}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="flow-node-meta"><Icon size={12} aria-hidden="true" /><span>{KIND_LABEL[node.kind]}</span>{mark ? <span className={`flow-change ${mark}`} aria-label={mark}>{GLYPH[mark]}</span> : null}</div>
      <strong className="flow-node-title" title={node.label}>{node.label}</strong>
      <span className="flow-node-path" title={path}>{path.length > 31 ? `…${path.slice(-30)}` : path}</span>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
});

const Dependency = memo(function Dependency({ id, data, markerStart, markerEnd }: EdgeProps<DependencyEdge>) {
  const motionPath = useRef<SVGPathElement>(null);
  const particles = useRef<SVGGElement>(null);
  const path = roundedPath(data?.points ?? []);
  useEffect(() => {
    if (!data?.hot || !motionPath.current || !particles.current) return;
    if (data.flow) return startFlow(particles.current, [motionPath.current]);
    if (data.sweep) return sendParticle(particles.current, motionPath.current, { r: 3, className: 'particle selection-particle' });
  }, [data?.hot, data?.flow, data?.sweep, path]);
  return (
    <g className={`flow-edge${data?.hot ? ' hot' : ''}`}>
      <BaseEdge id={id} path={path} markerStart={markerStart} markerEnd={markerEnd} interactionWidth={16} />
      <path ref={motionPath} d={path} fill="none" stroke="none" aria-hidden="true" />
      <g ref={particles} aria-hidden="true" />
      <title>{data?.description}</title>
    </g>
  );
});

const nodeTypes = { component: Component };
const edgeTypes = { dependency: Dependency };

/** React Flow owns the viewport and interactions; ELK remains the layout authority. */
export const FlowCanvas = forwardRef<GraphRenderer, RendererCallbacks>(function FlowCanvas({ onSelect }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<Instance | null>(null);
  const currentLayout = useRef<Layout | null>(null);
  const pendingCamera = useRef<((api: Instance) => void) | null>(null);
  const lastSelected = useRef<string | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [marks, setMarks] = useState(new Map<string, Mark>());
  const [highlight, setHighlight] = useState(EMPTY_HIGHLIGHT);
  const [hover, setHover] = useState<string | null>(null);
  const [sweep, setSweep] = useState(0);
  const [exiting, setExiting] = useState<PlacedNode[]>([]);
  const [moving, setMoving] = useState(false);

  useEffect(() => () => clearTimeout(exitTimer.current), []);

  useImperativeHandle(ref, () => {
    const camera = (action: (api: Instance) => void) => {
      if (instance.current) action(instance.current);
      else pendingCamera.current = action;
    };
    const duration = (ms: number) => reducedMotion() ? 0 : ms;
    const fit = (ms = 420) => camera((api) => {
      const graph = currentLayout.current;
      const el = host.current;
      if (!graph?.nodes.size || !el?.clientWidth || !el.clientHeight) return;
      const zoom = Math.max(0.85, Math.min(1.1, (el.clientWidth - 64) / graph.width, (el.clientHeight - 120) / graph.height));
      const x = graph.width * zoom <= el.clientWidth ? (el.clientWidth - graph.width * zoom) / 2 : 24;
      const y = Math.max(56, (el.clientHeight - graph.height * zoom) / 2);
      void api.setViewport({ x, y, zoom }, { duration: duration(ms) });
    });
    const reveal = (id: string, force: boolean) => camera((api) => {
      const placed = currentLayout.current?.nodes.get(id);
      const el = host.current;
      if (!placed || !el) return;
      const box = el.getBoundingClientRect();
      const panel = document.querySelector('.detail-panel')?.getBoundingClientRect();
      const height = panel && panel.top > box.top && panel.left < box.right && panel.right > box.left ? Math.max(80, panel.top - box.top) : box.height;
      const view = api.getViewport();
      const zoom = force ? Math.max(1, view.zoom) : view.zoom;
      const left = placed.x * zoom + view.x;
      const top = placed.y * zoom + view.y;
      if (!force && left >= 24 && left + NODE_W * zoom <= box.width - 24 && top >= 48 && top + NODE_H * zoom <= height - 24) return;
      void api.setViewport({ x: box.width / 2 - (placed.x + NODE_W / 2) * zoom, y: Math.max(70, height / 2) - (placed.y + NODE_H / 2) * zoom, zoom }, { duration: duration(320) });
    });
    return {
      render(next, nextMarks, opts) {
        clearTimeout(exitTimer.current);
        const old = currentLayout.current;
        currentLayout.current = next;
        setMoving(opts.animate && !reducedMotion());
        const removed = opts.animate && !reducedMotion() ? [...(old?.nodes.values() ?? [])].filter((p) => !next.nodes.has(p.node.id)) : [];
        setExiting(removed);
        if (removed.length) exitTimer.current = setTimeout(() => setExiting([]), 280);
        setLayout(next);
        setMarks(nextMarks);
      },
      setMarks,
      setHighlight(next) {
        if (lastSelected.current !== next.selected) {
          lastSelected.current = next.selected;
          setSweep((n) => n + 1);
        }
        setHighlight(next);
      },
      fit,
      zoomBy(factor) { camera((api) => { void api.zoomTo(api.getZoom() * factor, { duration: duration(180) }); }); },
      reveal(id) { reveal(id, true); },
      ensureVisible(id) { reveal(id, false); },
      destroy() { clearTimeout(exitTimer.current); pendingCamera.current = null; },
    };
  }, []);

  const emphasis = useMemo(() => {
    if (highlight.frame) return { nodes: highlight.frame, edges: null, soft: false };
    if (highlight.focus) return { nodes: highlight.focus.nodes, edges: highlight.focus.edges, soft: false };
    if (highlight.matches) return { nodes: highlight.matches, edges: null, soft: false };
    if (hover && layout) {
      const focus = focusSet([...layout.edges.values()].map((p) => p.edge), hover, 'neighbors');
      return { nodes: focus.nodes, edges: focus.edges, soft: true };
    }
    return { nodes: null, edges: null, soft: false };
  }, [highlight, hover, layout]);

  const nodes = useMemo<ComponentNode[]>(() => [...(layout?.nodes.values() ?? []), ...exiting].map((p) => {
    const removed = !layout?.nodes.has(p.node.id);
    const inactive = !!emphasis.nodes && !emphasis.nodes.has(p.node.id);
    return {
      id: p.node.id, type: 'component', position: { x: p.x, y: p.y }, width: NODE_W, height: NODE_H,
      selected: p.node.id === highlight.selected, selectable: !removed, focusable: !removed,
      ariaRole: 'button', ariaLabel: `${p.node.label}, ${KIND_LABEL[p.node.kind]}${marks.has(p.node.id) ? `, ${marks.get(p.node.id)}` : ''}`,
      data: { node: p.node, mark: marks.get(p.node.id), dim: inactive && !emphasis.soft, faded: inactive && emphasis.soft, match: !!highlight.matches?.has(p.node.id), exiting: removed },
    };
  }), [layout, exiting, marks, highlight.selected, highlight.matches, emphasis]);

  const edges = useMemo<DependencyEdge[]>(() => {
    const sweepEdges = new Set([...(highlight.focus?.edges ?? [])].slice(0, 18));
    return [...(layout?.edges.values() ?? [])].map((p) => {
    const edge = p.edge;
    const hot = !!emphasis.edges?.has(edge.id);
    const inactive = emphasis.edges ? !hot : !!emphasis.nodes && !(emphasis.nodes.has(edge.source) && emphasis.nodes.has(edge.target));
    const role = dataRoleOf(edge);
    const color = hot ? 'var(--color-text)' : role === 'read' ? 'var(--color-data)' : role === 'write' || role === 'readwrite' ? 'var(--color-service)' : 'var(--color-dim)';
    const marker = { type: MarkerType.Arrow, color, width: 14, height: 14 };
    const source = layout?.nodes.get(edge.source)?.node.label;
    const target = layout?.nodes.get(edge.target)?.node.label;
    return {
      id: edge.id, source: edge.source, target: edge.target, type: 'dependency', selectable: false,
      className: `${linkClass(edge)}${inactive ? emphasis.soft ? ' is-faded' : ' is-dim' : ''}`,
      markerEnd: marker, markerStart: role === 'readwrite' ? marker : undefined,
      data: { points: p.points, hot, flow: highlight.flow && !!highlight.focus && !highlight.frame, sweep: highlight.selected && sweepEdges.has(edge.id) ? sweep : 0,
        description: `${source} → ${target}: ${edgeVerbs(edge.kinds)}${edge.weight > 1 ? ` ×${edge.weight}` : ''}${edge.via?.length ? ` via ${edge.via.join(' › ')}` : ''}${edge.meta?.flipped ? ' (arrow follows the data)' : ''}` },
    };
    });
  }, [layout, emphasis, highlight.flow, highlight.focus, highlight.frame, highlight.selected, sweep]);

  return (
    <div ref={host} className={`flow-canvas${moving ? ' animate-layout' : ''}`}>
      <ReactFlow<ComponentNode, DependencyEdge>
        nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        onInit={(api) => { instance.current = api; pendingCamera.current?.(api); pendingCamera.current = null; }}
        onNodeClick={(_, node) => onSelect(node.id)} onPaneClick={() => onSelect(null)}
        onNodeMouseEnter={(_, node) => setHover(node.id)} onNodeMouseLeave={() => setHover(null)}
        onNodesChange={(changes) => {
          const selections = changes.filter((c) => c.type === 'select');
          const chosen = selections.find((c) => c.selected);
          if (chosen) onSelect(chosen.id);
          else if (selections.some((c) => c.id === lastSelected.current && !c.selected)) onSelect(null);
        }}
        nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false} edgesFocusable={false}
        deleteKeyCode={null} multiSelectionKeyCode={null} selectionKeyCode={null}
        minZoom={0.35} maxZoom={2.5} zoomOnDoubleClick={false} attributionPosition="top-right"
        ariaLabelConfig={{ 'node.a11yDescription.default': 'Press Enter or Space to inspect this component. Press Escape to clear selection.' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--color-rule-strong)" />
        <ViewportPortal>
          <div className="flow-lanes" aria-hidden="true">
            {layout?.lanes.map((lane, i) => <div key={lane.lane} className={`flow-lane${i % 2 ? ' alternate' : ''}`} style={{ left: lane.x0, width: lane.x1 - lane.x0 }} />)}
          </div>
        </ViewportPortal>
        {layout ? <LaneRuler layout={layout} marks={marks} /> : null}
        <MiniMap<ComponentNode> position="bottom-left" pannable zoomable nodeColor={(n) => `var(--color-${isBroken(n.data.node) ? 'broken' : n.data.node.category === 'infra' ? 'utility' : n.data.node.category})`} nodeBorderRadius={4} maskColor="color-mix(in oklab, var(--color-ink-0) 70%, transparent)" ariaLabel="Architecture overview" />
      </ReactFlow>
    </div>
  );
});

function LaneRuler({ layout, marks }: { layout: Layout; marks: Map<string, Mark> }) {
  const viewport = useViewport();
  const ruler = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ruler.current) return;
    const resize = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    resize.observe(ruler.current);
    return () => resize.disconnect();
  }, []);
  const lanes = layout.lanes.map((lane) => ({ ...lane, left: lane.x0 * viewport.zoom + viewport.x, right: lane.x1 * viewport.zoom + viewport.x }));
  const left = lanes.filter((lane) => lane.right < 36).at(-1);
  const right = lanes.find((lane) => lane.left > width - 36);
  const changed = (name: string) => marks.get([...layout.nodes.values()].find((p) => p.node.lane === name && marks.has(p.node.id))?.node.id ?? '');
  return (
    <nav ref={ruler} className="flow-ruler" aria-label="Architecture lanes">
      {left ? <LaneJump lane={left} viewport={viewport} width={width} side="left" changed={changed(left.lane)} /> : null}
      {lanes.filter((lane) => lane.right >= 36 && lane.left <= width - 36).map((lane) => {
        const x = Math.max(left ? 112 : 0, lane.left);
        const available = Math.min(right ? width - 112 : width, lane.right) - x;
        if (available < 64) return null;
        const count = [...layout.nodes.values()].filter((p) => p.node.lane === lane.lane).length;
        return <span key={lane.lane} className="flow-lane-label" style={{ left: x + 14, width: available - 20 }}>{LANE_LABEL[lane.lane]}<b>{count}</b></span>;
      })}
      {right ? <LaneJump lane={right} viewport={viewport} width={width} side="right" changed={changed(right.lane)} /> : null}
    </nav>
  );
}

function LaneJump({ lane, viewport, width, side, changed }: { lane: Layout['lanes'][number]; viewport: { x: number; y: number; zoom: number }; width: number; side: 'left' | 'right'; changed?: Mark }) {
  const api = useReactFlow<ComponentNode, DependencyEdge>();
  const Icon = side === 'left' ? ArrowLeft : ArrowRight;
  // A lane jump preserves vertical orientation and zoom.
  return <button type="button" className={`flow-lane-jump ${side}`} title={`Reveal ${LANE_LABEL[lane.lane]} lane`} aria-label={`Reveal ${LANE_LABEL[lane.lane]} lane`} onClick={() => void api.setViewport({ x: width / 2 - (lane.x0 + lane.x1) / 2 * viewport.zoom, y: viewport.y, zoom: viewport.zoom }, { duration: reducedMotion() ? 0 : 320 })}>
    <Icon size={13} aria-hidden="true" /><span>{LANE_LABEL[lane.lane]}</span>{changed ? <span className={`flow-lane-change ${changed}`} aria-label={`Contains ${changed} components`}>{GLYPH[changed]}</span> : null}
  </button>;
}
