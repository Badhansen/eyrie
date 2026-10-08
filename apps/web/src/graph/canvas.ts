import { easeCubicInOut, easeCubicOut } from 'd3-ease';
import { select, type Selection } from 'd3-selection';
import 'd3-transition';
import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior } from 'd3-zoom';
import type { Mark } from '../state/store';
import { drawIn, ripple, sendParticle, startFlow, traceSelection } from './effects';
import type { GraphRenderer, Highlight, RendererCallbacks } from './renderer';
import { NODE_H, NODE_W, resample, roundedPath, type Layout, type PlacedEdge, type PlacedNode, type Point } from './layout';
import { KIND_LABEL, LANE_LABEL, ROLE_LABEL, catClass, dataRoleOf, edgeVerbs, isBroken, linkClass } from './vocabulary';

export type { Highlight } from './renderer';

const MOVE_MS = 560;
const MIN_FIT_SCALE = 0.85;
const GLYPH: Record<Mark, string> = { new: '+', modified: '~', removed: '−' };

const measure = document.createElement('canvas').getContext('2d')!;
function fitText(text: string, font: string, stretch: CanvasFontStretch, max: number): string {
  measure.font = font;
  measure.fontStretch = stretch;
  if (measure.measureText(text).width <= max) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure.measureText(`${text.slice(0, mid)}…`).width <= max) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

/** Keeps the end of paths readable: `…/resume/generate/route.ts`. */
function fitTail(text: string, font: string, max: number): string {
  measure.font = font;
  measure.fontStretch = 'normal';
  if (measure.measureText(text).width <= max) return text;
  let cut = 1;
  while (cut < text.length && measure.measureText(`…${text.slice(cut)}`).width > max) cut++;
  return `…${text.slice(cut)}`;
}

const transform = (x: number, y: number, s = 1) => (s === 1 ? `translate(${x},${y})` : `translate(${x + NODE_W / 2},${y + NODE_H / 2}) scale(${s}) translate(${-NODE_W / 2},${-NODE_H / 2})`);

/** Transitions leave an inline opacity behind, which would override the dim/faded classes. */
function clearOpacity(this: SVGGElement) {
  this.style.removeProperty('opacity');
}

type NodeSel = Selection<SVGGElement, PlacedNode, SVGGElement, unknown>;
type EdgeSel = Selection<SVGGElement, PlacedEdge, SVGGElement, unknown>;

export class GraphCanvas implements GraphRenderer {
  private readonly svg: Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly viewport: Selection<SVGGElement, unknown, null, undefined>;
  private readonly lanesG: Selection<SVGGElement, unknown, null, undefined>;
  private readonly edgesG: Selection<SVGGElement, unknown, null, undefined>;
  private readonly particlesG: Selection<SVGGElement, unknown, null, undefined>;
  private readonly ripplesG: Selection<SVGGElement, unknown, null, undefined>;
  private readonly nodesG: Selection<SVGGElement, unknown, null, undefined>;
  private readonly rulerG: Selection<SVGGElement, unknown, null, undefined>;
  private readonly zoomer: ZoomBehavior<SVGSVGElement, unknown>;
  private layout: Layout | null = null;
  private shownPoints = new Map<string, Point[]>();
  private labels = new Map<string, string>();
  private marks = new Map<string, Mark>();
  private laneCounts = new Map<string, number>();
  private hl: Highlight = { selected: null, focus: null, flow: false, matches: null, frame: null };
  private hover: string | null = null;
  private stopFlow: () => void = () => {};
  private stopSelection: () => void = () => {};
  private readonly reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(
    private readonly el: SVGSVGElement,
    private readonly cb: RendererCallbacks,
  ) {
    this.svg = select(el).attr('class', 'graph h-full w-full').attr('role', 'application').attr('aria-label', 'Architecture graph');
    const defs = this.svg.append('defs');
    for (const [id, cls] of [
      ['gv-arrow', 'marker-path'],
      ['gv-arrow-hot', 'marker-hot'],
    ] as const) {
      defs
        .append('marker')
        .attr('id', id)
        .attr('viewBox', '0 0 10 10')
        .attr('refX', 9)
        .attr('refY', 5)
        .attr('markerWidth', 7)
        .attr('markerHeight', 7)
        .attr('orient', 'auto-start-reverse')
        .append('path')
        .attr('d', 'M1.5,1.5 L8.5,5 L1.5,8.5')
        .attr('fill', 'none')
        .attr('stroke-width', 1.4)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round')
        .style('stroke', cls === 'marker-hot' ? 'var(--edge-hot)' : 'var(--edge)');
    }
    this.viewport = this.svg.append('g');
    this.lanesG = this.viewport.append('g');
    this.edgesG = this.viewport.append('g');
    this.ripplesG = this.viewport.append('g');
    this.particlesG = this.viewport.append('g');
    this.nodesG = this.viewport.append('g');
    this.rulerG = this.svg.append('g').attr('class', 'ruler');
    this.zoomer = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 2.5])
      .on('zoom', (ev: D3ZoomEvent<SVGSVGElement, unknown>) => {
        this.viewport.attr('transform', ev.transform.toString());
        this.renderRuler();
      });
    this.svg.call(this.zoomer).on('dblclick.zoom', null);
    this.svg.on('click', (ev: MouseEvent) => {
      if (ev.target === el || (ev.target as Element).classList.contains('lane-band')) cb.onSelect(null);
    });
  }

  destroy(): void {
    this.stopFlow();
    this.stopSelection();
    this.svg.selectAll('*').remove();
  }

  // ── rendering ────────────────────────────────────────────────────────────

  render(layout: Layout, marks: Map<string, Mark>, opts: { animate: boolean }): void {
    const prev = this.layout;
    this.layout = layout;
    this.marks = marks;
    const animate = opts.animate && !this.reduced;
    for (const p of layout.nodes.values()) this.labels.set(p.node.id, p.node.label);
    this.renderLanes(layout, animate);
    this.renderEdges(layout, animate, !prev);
    this.renderNodes(layout, animate, !prev);
    this.applyMarks();
    this.applyHighlight();
  }

  private renderLanes(layout: Layout, animate: boolean): void {
    const counts = new Map<string, number>();
    for (const p of layout.nodes.values()) counts.set(p.node.lane, (counts.get(p.node.lane) ?? 0) + 1);
    const height = Math.max(layout.height, 200);
    const sel = this.lanesG.selectAll<SVGGElement, Layout['lanes'][number]>('g.lane').data(layout.lanes, (d) => d.lane);
    sel.exit().remove();
    const enter = sel.enter().append('g').attr('class', 'lane');
    enter.append('rect').attr('class', 'lane-band');
    const all = enter.merge(sel);
    all.each(function (d, i) {
      select(this).select('rect').classed('alt', i % 2 === 1);
    });
    const rects = all.select<SVGRectElement>('rect');
    // Bands run far beyond the content so lanes read as columns at any zoom.
    const place = (r: typeof rects) => r.attr('x', (d) => d.x0).attr('y', -4000).attr('width', (d) => d.x1 - d.x0).attr('height', height + 8000);
    if (animate) {
      rects
        .transition()
        .duration(MOVE_MS)
        .ease(easeCubicInOut)
        .attr('x', (d) => d.x0)
        .attr('width', (d) => d.x1 - d.x0)
        .attr('height', height + 8000);
    } else place(rects);
    place(rects.filter(function () {
      return !this.getAttribute('width');
    }));
    this.laneCounts = counts;
    this.renderRuler();
  }

  /** Lane names pinned to the top of the canvas; off-screen lanes point the way. */
  private renderRuler(): void {
    if (!this.layout) return;
    const t = (this.el as SVGSVGElement & { __zoom?: { k: number; x: number; y: number } }).__zoom ?? { k: 1, x: 0, y: 0 };
    const width = this.el.clientWidth;
    const items = this.layout.lanes.map((l) => {
      const x0 = l.x0 * t.k + t.x;
      const x1 = l.x1 * t.k + t.x;
      const side = x1 < 40 ? 'left' : x0 > width - 40 ? 'right' : 'in';
      return { lane: l.lane, x0, x1, side };
    });
    this.rulerG.selectAll('*').remove();
    this.rulerG.append('rect').attr('class', 'ruler-bg').attr('x', 0).attr('y', 0).attr('width', width).attr('height', 26);
    const visible = items.filter((i) => i.side === 'in');
    const left = items.filter((i) => i.side === 'left').map((i) => LANE_LABEL[i.lane]);
    const right = items.filter((i) => i.side === 'right').map((i) => LANE_LABEL[i.lane]);
    const leftEdge = left.length ? 24 + `← ${left.join(' · ')}`.length * 7.2 : 0;
    const rightEdge = right.length ? width - 24 - `${right.join(' · ')} →`.length * 7.2 : width;
    for (const i of visible) {
      const label = `${LANE_LABEL[i.lane]}  ${this.laneCounts.get(i.lane) ?? 0}`;
      const x = Math.max(i.x0, leftEdge) + 12;
      if (x > Math.min(i.x1, width) - 30 || x + label.length * 7.2 > rightEdge) continue;
      this.rulerG
        .append('text')
        .attr('class', 'lane-label')
        .attr('x', x)
        .attr('y', 17)
        .text(label);
      if (i.x0 > 0) this.rulerG.append('line').attr('class', 'lane-rule').attr('x1', i.x0).attr('x2', i.x0).attr('y1', 6).attr('y2', 20);
    }
    // Changes that happen off-screen still get noticed: a dot on the edge hint.
    const offscreenMark = (side: 'left' | 'right') => {
      let found: Mark | null = null;
      for (const [id, m] of this.marks) {
        const p = this.layout!.nodes.get(id);
        if (!p) continue;
        const x0 = p.x * t.k + t.x;
        const x1 = x0 + NODE_W * t.k;
        if ((side === 'right' && x0 > width - 20) || (side === 'left' && x1 < 20)) found = found === 'new' ? found : m;
      }
      return found;
    };
    const hint = (side: 'left' | 'right', names: string[]) => {
      const mark = offscreenMark(side);
      const text = this.rulerG
        .append('text')
        .attr('class', 'lane-label lane-offscreen')
        .attr('x', side === 'left' ? 12 : width - 12)
        .attr('y', 17)
        .attr('text-anchor', side === 'left' ? 'start' : 'end');
      const label = side === 'left' ? `← ${names.join(' · ')}` : `${names.join(' · ')} →`;
      if (mark && side === 'left') text.append('tspan').attr('class', `ruler-dot ${mark}`).text('● ');
      text.append('tspan').text(label);
      if (mark && side === 'right') text.append('tspan').attr('class', `ruler-dot ${mark}`).text(' ●');
    };
    if (left.length) hint('left', left);
    if (right.length) hint('right', right);
  }

  private renderEdges(layout: Layout, animate: boolean, initial: boolean): void {
    const data = [...layout.edges.values()];
    const sel: EdgeSel = this.edgesG.selectAll<SVGGElement, PlacedEdge>('g.edge').data(data, (d) => d.edge.id);
    sel
      .exit()
      .transition()
      .duration(animate ? 300 : 0)
      .style('opacity', 0)
      .remove();

    const enter = sel.enter().append('g');
    enter.append('path').attr('class', 'hit');
    enter.append('path').attr('class', 'line').attr('marker-end', 'url(#gv-arrow)');
    enter.append('title');

    const all = enter.merge(sel);
    all.attr('class', (d) => `edge ${linkClass(d.edge)}`.trimEnd());
    all.select('title').text((d) => {
      const src = this.labels.get(d.edge.source) ?? '';
      const dst = this.labels.get(d.edge.target) ?? '';
      const via = d.edge.via?.length ? ` via ${d.edge.via.join(' › ')}` : '';
      const role = dataRoleOf(d.edge);
      // A reversed read points the way the data travels, so the sentence reads the other way.
      const flipped = d.edge.meta?.flipped === true;
      const what = role ? (flipped ? `${dst} ${ROLE_LABEL[role]} ${src} — the arrow follows the data` : `${src} ${ROLE_LABEL[role]} ${dst}`) : edgeVerbs(d.edge.kinds);
      return `${src} → ${dst}\n${what}${d.edge.weight > 1 ? ` ×${d.edge.weight}` : ''}${via}`;
    });
    // A component that both reads and writes a store gets an arrow at each end.
    all.select('path.line').attr('marker-start', (d) => (dataRoleOf(d.edge) === 'readwrite' ? 'url(#gv-arrow)' : null));
    all.select('path.hit').attr('d', (d) => roundedPath(d.points));

    const self = this;
    all.select<SVGPathElement>('path.line').each(function (d) {
      const path = select(this);
      const target = d.points;
      const from = self.shownPoints.get(d.edge.id);
      self.shownPoints.set(d.edge.id, target);
      if (!animate || initial) {
        path.interrupt().attr('d', roundedPath(target));
        return;
      }
      if (!from) {
        // New dependency: draw it from source to target, then send one request along it.
        path.attr('d', roundedPath(target));
        const el = this as SVGPathElement;
        drawIn(el, { delay: MOVE_MS * 0.6, duration: 700, onComplete: () => sendParticle(self.particlesG.node()!, el) });
        return;
      }
      const a = resample(from, 28);
      const b = resample(target, 28);
      path
        .transition()
        .duration(MOVE_MS)
        .ease(easeCubicInOut)
        .attrTween('d', () => (t: number) => (t >= 1 ? roundedPath(target) : roundedPath(a.map((p, i) => ({ x: p.x + (b[i]!.x - p.x) * t, y: p.y + (b[i]!.y - p.y) * t })), 0)));
    });
    for (const id of [...this.shownPoints.keys()]) if (!layout.edges.has(id)) this.shownPoints.delete(id);
  }

  private renderNodes(layout: Layout, animate: boolean, initial: boolean): void {
    const data = [...layout.nodes.values()];
    const sel: NodeSel = this.nodesG.selectAll<SVGGElement, PlacedNode>('g.node').data(data, (d) => d.node.id);

    const exit = sel.exit<PlacedNode>();
    exit.classed('mark-removed', true).attr('pointer-events', 'none');
    exit
      .transition()
      .delay(animate ? 700 : 0)
      .duration(animate ? 500 : 0)
      .style('opacity', 0)
      .remove();

    const enter = sel
      .enter()
      .append('g')
      .attr('tabindex', 0)
      .attr('role', 'button')
      .on('click', (ev: MouseEvent, d) => {
        ev.stopPropagation();
        this.cb.onSelect(d.node.id);
      })
      .on('keydown', (ev: KeyboardEvent, d) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          this.cb.onSelect(d.node.id);
        }
      })
      .on('mouseenter', (_ev, d) => {
        this.hover = d.node.id;
        this.applyHighlight();
      })
      .on('mouseleave', () => {
        this.hover = null;
        this.applyHighlight();
      });
    enter.append('rect').attr('class', 'glow').attr('x', -1).attr('y', -1).attr('width', NODE_W + 2).attr('height', NODE_H + 2).attr('rx', 10);
    enter.append('rect').attr('class', 'halo').attr('x', -5).attr('y', -5).attr('width', NODE_W + 10).attr('height', NODE_H + 10).attr('rx', 13);
    enter.append('rect').attr('class', 'body').attr('width', NODE_W).attr('height', NODE_H).attr('rx', 9);
    enter.append('rect').attr('class', 'accent').attr('x', 0).attr('y', 10).attr('width', 3).attr('height', NODE_H - 20).attr('rx', 1.5);
    enter.append('text').attr('class', 'kind').attr('x', 13).attr('y', 15.5);
    enter.append('text').attr('class', 'label').attr('x', 13).attr('y', 31);
    enter.append('text').attr('class', 'sub').attr('x', 13).attr('y', 44);
    const badge = enter.append('g').attr('class', 'badge').attr('transform', `translate(${NODE_W - 4},4)`);
    badge.append('circle').attr('r', 8.5);
    badge.append('text').attr('text-anchor', 'middle').attr('dy', '0.36em');

    if (initial && !this.reduced) {
      // Page load: lanes appear left to right.
      enter
        .attr('transform', (d) => transform(d.x, d.y))
        .style('opacity', 0)
        .transition()
        .delay((d) => ['ui', 'edge', 'api', 'logic', 'data', 'external'].indexOf(d.node.lane) * 70)
        .duration(420)
        .style('opacity', 1)
        .on('end', clearOpacity);
    } else if (animate) {
      enter
        .attr('transform', (d) => transform(d.x, d.y, 0.82))
        .style('opacity', 0)
        .transition()
        .delay(MOVE_MS * 0.5)
        .duration(480)
        .ease(easeCubicOut)
        .attr('transform', (d) => transform(d.x, d.y))
        .style('opacity', 1)
        .on('end', clearOpacity);
    } else {
      enter.attr('transform', (d) => transform(d.x, d.y));
    }

    const all = enter.merge(sel);
    all
      .attr('class', (d) => `node ${catClass(d.node)}${isBroken(d.node) ? ' broken' : ''}`)
      .attr('aria-label', (d) => `${d.node.label}, ${KIND_LABEL[d.node.kind]}`);
    all.select('text.kind').text((d) => (isBroken(d.node) ? 'Missing route' : KIND_LABEL[d.node.kind]));
    all.select('text.label').text((d) => fitText(d.node.label, '620 13px "Archivo Variable"', 'semi-condensed', NODE_W - 28));
    all.select('text.sub').text((d) => fitTail(d.node.sublabel ?? '', '10px "Fragment Mono"', NODE_W - 22));
    if (animate) {
      sel
        .transition()
        .duration(MOVE_MS)
        .ease(easeCubicInOut)
        .attr('transform', (d) => transform(d.x, d.y))
        .style('opacity', 1)
        .on('end', clearOpacity);
    } else sel.attr('transform', (d) => transform(d.x, d.y)).style('opacity', null);
  }

  // ── marks & highlight ────────────────────────────────────────────────────

  setMarks(marks: Map<string, Mark>): void {
    this.marks = marks;
    this.applyMarks();
    this.renderRuler();
  }

  private applyMarks(): void {
    const marks = this.marks;
    const layer = this.ripplesG.node()!;
    const rippleAt = (d: PlacedNode, kind: Mark) => ripple(layer, d.x + NODE_W / 2, d.y + NODE_H / 2, kind, { w: NODE_W, h: NODE_H });
    this.nodesG.selectAll<SVGGElement, PlacedNode>('g.node').each(function (d) {
      const g = select(this);
      if (g.classed('mark-removed') && !marks.has(d.node.id)) return;
      const m = marks.get(d.node.id);
      const wasModified = g.classed('mark-modified');
      g.classed('mark-new', m === 'new').classed('mark-modified', m === 'modified');
      g.select('.badge text').text(m ? GLYPH[m] : '');
      if (m === 'modified' && !wasModified) {
        g.classed('pulse', false);
        void (this as SVGGElement).getBoundingClientRect();
        g.classed('pulse', true);
        rippleAt(d, 'modified');
      } else if (!m) g.classed('pulse', false);
      if (m === 'new' && !g.classed('rippled')) {
        g.classed('rippled', true);
        rippleAt(d, 'new');
      }
    });
  }

  setHighlight(hl: Highlight): void {
    const changed = this.hl.selected !== hl.selected;
    this.hl = hl;
    this.applyHighlight();
    if (changed) {
      this.stopSelection();
      const paths: SVGPathElement[] = [];
      if (hl.selected && !hl.flow) {
        this.edgesG.selectAll<SVGGElement, PlacedEdge>('g.edge').each((d, i, groups) => {
          if (hl.focus?.edges.has(d.edge.id)) paths.push(groups[i]!.querySelector<SVGPathElement>('path.line')!);
        });
      }
      this.stopSelection = traceSelection(this.particlesG.node()!, paths);
    }
  }

  private applyHighlight(): void {
    const { selected, focus, matches, frame, flow } = this.hl;
    let activeNodes: Set<string> | null = null;
    let hotEdges: Set<string> | null = null;
    let soft = false;
    if (frame) activeNodes = frame;
    else if (focus) {
      activeNodes = focus.nodes;
      hotEdges = focus.edges;
    } else if (matches) activeNodes = matches;
    else if (this.hover && this.layout) {
      soft = true;
      activeNodes = new Set([this.hover]);
      hotEdges = new Set();
      for (const p of this.layout.edges.values()) {
        if (p.edge.source === this.hover || p.edge.target === this.hover) {
          hotEdges.add(p.edge.id);
          activeNodes.add(p.edge.source);
          activeNodes.add(p.edge.target);
        }
      }
    }
    this.nodesG
      .selectAll<SVGGElement, PlacedNode>('g.node')
      .classed('selected', (d) => d.node.id === selected)
      .classed('match', (d) => !!matches?.has(d.node.id))
      .classed('dim', (d) => !soft && !!activeNodes && !activeNodes.has(d.node.id))
      .classed('faded', (d) => soft && !!activeNodes && !activeNodes.has(d.node.id));
    const edgeOff = (d: PlacedEdge) => (hotEdges ? !hotEdges.has(d.edge.id) : !!activeNodes && !(activeNodes.has(d.edge.source) && activeNodes.has(d.edge.target)));
    this.edgesG
      .selectAll<SVGGElement, PlacedEdge>('g.edge')
      .classed('hot', (d) => !!hotEdges?.has(d.edge.id))
      .classed('dim', (d) => !soft && edgeOff(d))
      .classed('faded', (d) => soft && edgeOff(d))
      .select('path.line')
      .attr('marker-end', (d) => (hotEdges?.has(d.edge.id) ? 'url(#gv-arrow-hot)' : 'url(#gv-arrow)'))
      .attr('marker-start', (d) => (dataRoleOf(d.edge) !== 'readwrite' ? null : hotEdges?.has(d.edge.id) ? 'url(#gv-arrow-hot)' : 'url(#gv-arrow)'));
    this.runFlow(flow && hotEdges ? hotEdges : null);
  }

  /** Particles travel along focused edges to show request/data flow. */
  private runFlow(edgeIds: Set<string> | null): void {
    this.stopFlow();
    this.stopFlow = () => {};
    if (!edgeIds?.size) return;
    const paths: SVGPathElement[] = [];
    this.edgesG.selectAll<SVGGElement, PlacedEdge>('g.edge').each((d, i, groups) => {
      if (edgeIds.has(d.edge.id)) paths.push(select(groups[i]!).select<SVGPathElement>('path.line').node()!);
    });
    this.stopFlow = startFlow(this.particlesG.node()!, paths);
  }

  // ── camera ───────────────────────────────────────────────────────────────

  fit(duration = 600): void {
    if (!this.layout) return;
    const box = this.el.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const { width, height } = this.layout;
    // Never shrink text below a readable size; wide maps start at the UI lane and pan right.
    const k = Math.max(MIN_FIT_SCALE, Math.min(1.1, (box.width - 32) / width, (box.height - 32) / height));
    const tx = width * k <= box.width ? (box.width - width * k) / 2 : 8;
    const ty = height * k <= box.height ? Math.max(8, (box.height - height * k) / 2) : 8;
    const target = zoomIdentity.translate(tx, ty).scale(k);
    if (duration && !this.reduced) this.svg.transition().duration(duration).ease(easeCubicInOut).call(this.zoomer.transform, target);
    else this.svg.call(this.zoomer.transform, target);
  }

  zoomBy(factor: number): void {
    this.svg.transition().duration(this.reduced ? 0 : 220).call(this.zoomer.scaleBy, factor);
  }

  reveal(id: string): void {
    const p = this.layout?.nodes.get(id);
    if (!p) return;
    const box = this.el.getBoundingClientRect();
    const k = Math.max(0.85, Math.min(1.2, this.currentScale()));
    const target = zoomIdentity.translate(box.width / 2 - (p.x + NODE_W / 2) * k, box.height / 2 - (p.y + NODE_H / 2) * k).scale(k);
    this.svg.transition().duration(this.reduced ? 0 : 500).ease(easeCubicInOut).call(this.zoomer.transform, target);
  }

  /** Pans just enough to bring a node into view (e.g. after the panel narrows the canvas). */
  ensureVisible(id: string): void {
    const p = this.layout?.nodes.get(id);
    if (!p) return;
    const t = (this.el as SVGSVGElement & { __zoom?: { k: number; x: number; y: number } }).__zoom ?? { k: 1, x: 0, y: 0 };
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    const x0 = p.x * t.k + t.x;
    const y0 = p.y * t.k + t.y;
    const x1 = x0 + NODE_W * t.k;
    const y1 = y0 + NODE_H * t.k;
    const pad = 40;
    let dx = 0;
    let dy = 0;
    if (x1 > w - pad) dx = w - pad - x1;
    else if (x0 < pad) dx = pad - x0;
    if (y1 > h - pad) dy = h - pad - y1;
    else if (y0 < pad + 26) dy = pad + 26 - y0;
    if (!dx && !dy) return;
    this.svg.transition().duration(this.reduced ? 0 : 420).ease(easeCubicInOut).call(this.zoomer.translateBy, dx / t.k, dy / t.k);
  }

  private currentScale(): number {
    const t = (this.el as SVGSVGElement & { __zoom?: { k: number } }).__zoom;
    return t?.k ?? 1;
  }

  /** Lets the panel keep using node labels for removed components. */
  labelOf(id: string): string | undefined {
    return this.labels.get(id);
  }
}
