/**
 * 3D architecture view: the layout becomes a city floor. Lanes are districts,
 * components are blocks whose height encodes lines of code, and dependencies
 * are tracks on the floor. CSS 3D transforms for geometry, anime.js for motion.
 */
import { animate as tween, spring, stagger, utils } from 'animejs';
import { ARCH_LANES, type ArchNode } from '@eyrie/core';
import { drawIn, reducedMotion, ripple, sendParticle, startFlow, traceSelection } from '../graph/effects';
import { NODE_H, NODE_W, resample, roundedPath, type Layout, type PlacedNode, type Point } from '../graph/layout';
import type { GraphRenderer, Highlight, RendererCallbacks } from '../graph/renderer';
import { KIND_LABEL, LANE_LABEL, catClass, edgeVerbs, isBroken } from '../graph/vocabulary';
import type { Mark } from '../state/store';

const SVG_NS = 'http://www.w3.org/2000/svg';
const GLYPH: Record<Mark, string> = { new: '+', modified: '~', removed: '−' };
const MOVE_MS = 650;
const SUB_CHARS = 27;

interface Camera {
  tilt: number;
  spin: number;
  zoom: number;
  panX: number;
  panY: number;
}

/** Default viewing angle: from the front-left, above the floor. */
export const HOME_ANGLE = { tilt: 58, spin: -36 };

/** Block height in px: grows with lines of code (log scale) so big modules stand out. */
export function blockHeight(n: ArchNode): number {
  if (isBroken(n)) return 6;
  if (n.kind === 'external_service') return 26;
  if (n.kind === 'database_model') {
    const fields = (n.meta?.fields as string[] | undefined)?.length ?? 4;
    return Math.min(34, 12 + fields * 2);
  }
  const loc = Number(n.meta?.loc ?? 40);
  return Math.round(Math.min(80, 12 + 11 * Math.log2(1 + loc / 30)));
}

const tail = (text: string, max: number) => (text.length <= max ? text : `…${text.slice(text.length - max + 1)}`);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const rad = (deg: number) => (deg * Math.PI) / 180;

export class GraphScene3D implements GraphRenderer {
  private readonly root: HTMLDivElement;
  private readonly cameraEl: HTMLDivElement;
  private readonly world: HTMLDivElement;
  private readonly floor: SVGSVGElement;
  private readonly groundRect: SVGRectElement;
  private readonly lanesG: SVGGElement;
  private readonly edgesG: SVGGElement;
  private readonly ripplesG: SVGGElement;
  private readonly particlesG: SVGGElement;
  private readonly blocksEl: HTMLDivElement;
  private readonly reduced = reducedMotion();

  private cam: Camera = { tilt: HOME_ANGLE.tilt, spin: HOME_ANGLE.spin, zoom: 1, panX: 0, panY: 0 };
  /** World point the camera rotates around; fixed after the first render so the city never jumps. */
  private origin: Point | null = null;
  private layout: Layout | null = null;
  private blocks = new Map<string, HTMLDivElement>();
  private heights = new Map<string, number>();
  private edges = new Map<string, SVGGElement>();
  private shown = new Map<string, Point[]>();
  private labels = new Map<string, string>();
  private marks = new Map<string, Mark>();
  private hl: Highlight = { selected: null, focus: null, flow: false, matches: null, frame: null };
  private hover: string | null = null;
  private lifted: string | null = null;
  private stopFlow: () => void = () => {};
  private stopSelection: () => void = () => {};
  private drag: { mode: 'pan' | 'orbit'; x: number; y: number; moved: boolean } | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; zoom: number } | null = null;
  private suppressClick = false;

  constructor(
    host: HTMLElement,
    private readonly cb: RendererCallbacks,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'scene3d';
    this.root.setAttribute('role', 'application');
    this.root.setAttribute('aria-label', 'Architecture graph in 3D');
    host.appendChild(this.root);

    this.cameraEl = document.createElement('div');
    this.cameraEl.className = 'cam3d';
    this.world = document.createElement('div');
    this.world.className = 'world3d';
    this.cameraEl.appendChild(this.world);
    this.root.appendChild(this.cameraEl);

    const gridId = `gv-grid-${Math.random().toString(36).slice(2, 8)}`;
    const fadeId = `gv-fade-${Math.random().toString(36).slice(2, 8)}`;
    this.floor = document.createElementNS(SVG_NS, 'svg');
    this.floor.setAttribute('class', 'floor3d');
    this.floor.innerHTML = `
      <defs>
        <pattern id="${gridId}" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M40 0H0V40" class="grid-line" />
        </pattern>
        <radialGradient id="${fadeId}-g"><stop offset="0.45" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
        <mask id="${fadeId}"><rect x="-1200" y="-1200" width="1" height="1" fill="url(#${fadeId}-g)" class="fade-rect"/></mask>
        <marker id="gv3-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M1.5,1.5 L8.5,5 L1.5,8.5" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="stroke: var(--edge)"/>
        </marker>
        <marker id="gv3-arrow-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M1.5,1.5 L8.5,5 L1.5,8.5" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="stroke: var(--edge-hot)"/>
        </marker>
      </defs>`;
    this.groundRect = document.createElementNS(SVG_NS, 'rect');
    this.groundRect.setAttribute('class', 'ground');
    this.groundRect.setAttribute('fill', `url(#${gridId})`);
    this.groundRect.setAttribute('mask', `url(#${fadeId})`);
    this.floor.appendChild(this.groundRect);
    const g = (cls: string) => {
      const el = document.createElementNS(SVG_NS, 'g');
      el.setAttribute('class', cls);
      this.floor.appendChild(el);
      return el;
    };
    this.lanesG = g('lanes3d');
    this.edgesG = g('edges3d');
    this.ripplesG = g('ripples3d');
    this.particlesG = g('particles3d');
    this.world.appendChild(this.floor);

    this.blocksEl = document.createElement('div');
    this.blocksEl.className = 'blocks3d';
    this.world.appendChild(this.blocksEl);

    this.root.addEventListener('pointerdown', this.onPointerDown);
    this.root.addEventListener('wheel', this.onWheel, { passive: false });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.root.addEventListener('click', (e) => {
      if (this.suppressClick) return;
      if (!(e.target as Element).closest('.block3d')) this.cb.onSelect(null);
    });
    this.root.addEventListener('dblclick', (e) => {
      if (!(e.target as Element).closest('.block3d')) this.home();
    });
    window.addEventListener('keydown', this.onKey);
    this.applyCamera();
  }

  destroy(): void {
    this.stopFlow();
    this.stopSelection();
    utils.remove(this.cam);
    utils.remove([...this.blocks.values()]);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.root.remove();
  }

  // ── rendering ────────────────────────────────────────────────────────────

  render(layout: Layout, marks: Map<string, Mark>, opts: { animate: boolean }): void {
    const first = !this.layout || this.layout.nodes.size === 0;
    this.layout = layout;
    this.marks = marks;
    if (!this.origin || first) this.origin = { x: layout.width / 2, y: layout.height / 2 };
    const animate = opts.animate && !this.reduced && !first;
    for (const p of layout.nodes.values()) this.labels.set(p.node.id, p.node.label);

    this.world.style.transform = `translate(${-this.origin.x}px, ${-this.origin.y}px)`;
    this.floor.setAttribute('width', String(layout.width));
    this.floor.setAttribute('height', String(layout.height));
    const pad = 900;
    for (const [el, attrs] of [
      [this.groundRect, { x: -pad, y: -pad, width: layout.width + pad * 2, height: layout.height + pad * 2 }],
      [this.floor.querySelector('.fade-rect')!, { x: -pad / 2, y: -pad / 2, width: layout.width + pad, height: layout.height + pad }],
    ] as const) {
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    }

    this.renderLanes(layout);
    this.renderEdges(layout, animate, first);
    this.renderBlocks(layout, animate, first);
    this.applyMarks();
    this.applyHighlight();
    if (first) this.intro();
  }

  private renderLanes(layout: Layout): void {
    const counts = new Map<string, number>();
    for (const p of layout.nodes.values()) counts.set(p.node.lane, (counts.get(p.node.lane) ?? 0) + 1);
    this.lanesG.replaceChildren();
    layout.lanes.forEach((lane, i) => {
      const band = document.createElementNS(SVG_NS, 'rect');
      band.setAttribute('class', `lane3d${i % 2 ? ' alt' : ''}`);
      band.setAttribute('x', String(lane.x0));
      band.setAttribute('y', '-40');
      band.setAttribute('width', String(lane.x1 - lane.x0));
      band.setAttribute('height', String(layout.height + 80));
      this.lanesG.appendChild(band);
      // Lane names are painted on the ground at the near edge, like road markings.
      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('class', 'lane3d-label');
      label.setAttribute('x', String(lane.x0 + 14));
      label.setAttribute('y', String(layout.height + 26));
      label.textContent = `${LANE_LABEL[lane.lane]} ${counts.get(lane.lane) ?? 0}`;
      this.lanesG.appendChild(label);
    });
  }

  private renderEdges(layout: Layout, animate: boolean, initial: boolean): void {
    for (const [id, g] of this.edges) {
      if (layout.edges.has(id)) continue;
      this.edges.delete(id);
      this.shown.delete(id);
      if (animate) tween(g, { opacity: 0, duration: 300, ease: 'outQuad', onComplete: () => g.remove() });
      else g.remove();
    }
    for (const placed of layout.edges.values()) {
      const id = placed.edge.id;
      let g = this.edges.get(id);
      const isNew = !g;
      if (!g) {
        g = document.createElementNS(SVG_NS, 'g');
        const hit = document.createElementNS(SVG_NS, 'path');
        hit.setAttribute('class', 'hit');
        const line = document.createElementNS(SVG_NS, 'path');
        line.setAttribute('class', 'line');
        line.setAttribute('marker-end', 'url(#gv3-arrow)');
        g.append(hit, line, document.createElementNS(SVG_NS, 'title'));
        this.edgesG.appendChild(g);
        this.edges.set(id, g);
      }
      const kinds = placed.edge.kinds;
      g.setAttribute('class', `edge${kinds.includes('HTTP_CALL') ? ' http' : ''}${kinds.includes('READS_FROM') || kinds.includes('WRITES_TO') ? ' data' : ''}`);
      const via = placed.edge.via?.length ? ` via ${placed.edge.via.join(' › ')}` : '';
      g.querySelector('title')!.textContent = `${this.labels.get(placed.edge.source) ?? ''} → ${this.labels.get(placed.edge.target) ?? ''}\n${edgeVerbs(kinds)}${placed.edge.weight > 1 ? ` ×${placed.edge.weight}` : ''}${via}`;
      const line = g.querySelector<SVGPathElement>('path.line')!;
      g.querySelector('path.hit')!.setAttribute('d', roundedPath(placed.points));
      const from = this.shown.get(id);
      this.shown.set(id, placed.points);

      if (isNew) {
        line.setAttribute('d', roundedPath(placed.points));
        if (initial && !this.reduced) g.classList.add('pending'); // drawn by the intro
        else if (animate) drawIn(line, { delay: MOVE_MS * 0.8, duration: 750, onComplete: () => sendParticle(this.particlesG, line, { r: 3.4 }) });
        continue;
      }
      if (!animate || !from) {
        line.setAttribute('d', roundedPath(placed.points));
        continue;
      }
      this.tweenPath(line, from, placed.points);
    }
  }

  private tweenPath(line: SVGPathElement, from: Point[], to: Point[]): void {
    const a = resample(from, 28);
    const b = resample(to, 28);
    const progress = { t: 0 };
    tween(progress, {
      t: 1,
      duration: MOVE_MS,
      ease: 'inOutCubic',
      onUpdate: () => {
        const t = progress.t;
        line.setAttribute('d', t >= 1 ? roundedPath(to) : roundedPath(a.map((p, i) => ({ x: p.x + (b[i]!.x - p.x) * t, y: p.y + (b[i]!.y - p.y) * t })), 0));
      },
      onComplete: () => line.setAttribute('d', roundedPath(to)),
    });
  }

  private renderBlocks(layout: Layout, animate: boolean, initial: boolean): void {
    for (const [id, el] of this.blocks) {
      if (layout.nodes.has(id)) continue;
      this.blocks.delete(id);
      const h = this.heights.get(id) ?? 20;
      this.heights.delete(id);
      el.classList.add('mark-removed', 'leaving');
      el.querySelector('.b-badge')!.textContent = GLYPH.removed;
      if (!animate) {
        el.remove();
        continue;
      }
      // Removed components sink into the floor.
      const x = parseFloat(el.style.getPropertyValue('--x'));
      const y = parseFloat(el.style.getPropertyValue('--y'));
      ripple(this.ripplesG, x + NODE_W / 2, y + NODE_H / 2, 'removed', { w: NODE_W, h: NODE_H });
      tween(el, { '--lift': `${-(h + 4)}px`, delay: 350, duration: 800, ease: 'inBack(1.6)', onComplete: () => el.remove() });
      tween(el.querySelectorAll('.b-face, .b-shadow'), { opacity: 0, delay: 700, duration: 450 });
    }

    for (const placed of layout.nodes.values()) {
      const n = placed.node;
      const h = blockHeight(n);
      let el = this.blocks.get(n.id);
      if (!el) {
        el = this.createBlock(n);
        el.style.setProperty('--x', `${placed.x}px`);
        el.style.setProperty('--y', `${placed.y}px`);
        el.style.setProperty('--h', `${initial && !this.reduced ? 0 : h}px`);
        el.style.setProperty('--lift', '0px');
        this.blocksEl.appendChild(el);
        this.blocks.set(n.id, el);
        this.heights.set(n.id, h);
        this.updateBlock(el, n);
        if (animate) this.dropIn(el, placed);
        continue;
      }
      this.updateBlock(el, n);
      const prevH = this.heights.get(n.id);
      this.heights.set(n.id, h);
      if (animate) {
        tween(el, { '--x': `${placed.x}px`, '--y': `${placed.y}px`, duration: MOVE_MS, ease: 'inOutCubic' });
        if (prevH !== h) tween(el, { '--h': `${h}px`, duration: 700, ease: 'outBack(1.4)' });
      } else {
        el.style.setProperty('--x', `${placed.x}px`);
        el.style.setProperty('--y', `${placed.y}px`);
        if (!(initial && !this.reduced)) el.style.setProperty('--h', `${h}px`);
      }
    }
  }

  private createBlock(n: ArchNode): HTMLDivElement {
    const el = document.createElement('div');
    el.dataset.id = n.id;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.innerHTML = `
      <div class="b-shadow"></div>
      <div class="b-ring"></div>
      <div class="b-face b-back"></div>
      <div class="b-face b-right"></div>
      <div class="b-face b-left"></div>
      <div class="b-face b-front"></div>
      <div class="b-face b-top"><span class="b-kind"></span><span class="b-label"></span><span class="b-sub"></span><span class="b-badge"></span></div>`;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.suppressClick) this.cb.onSelect(n.id);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.cb.onSelect(n.id);
      }
    });
    el.addEventListener('pointerenter', () => {
      this.hover = n.id;
      this.applyHighlight();
    });
    el.addEventListener('pointerleave', () => {
      this.hover = null;
      this.applyHighlight();
    });
    return el;
  }

  private updateBlock(el: HTMLDivElement, n: ArchNode): void {
    const keep = ['selected', 'dim', 'faded', 'match', 'mark-new', 'mark-modified', 'mark-removed', 'leaving'].filter((c) => el.classList.contains(c));
    el.className = `block3d ${catClass(n)}${isBroken(n) ? ' broken' : ''} ${keep.join(' ')}`.trim();
    el.setAttribute('aria-label', `${n.label}, ${KIND_LABEL[n.kind]}`);
    el.querySelector('.b-kind')!.textContent = isBroken(n) ? 'Missing route' : KIND_LABEL[n.kind];
    el.querySelector('.b-label')!.textContent = n.label;
    el.querySelector('.b-sub')!.textContent = tail(n.sublabel ?? '', SUB_CHARS);
  }

  /** New components fall from above and land with a bounce. */
  private dropIn(el: HTMLDivElement, placed: PlacedNode): void {
    el.style.setProperty('--lift', '260px');
    const faces = el.querySelectorAll('.b-face, .b-shadow');
    for (const f of faces) (f as HTMLElement).style.opacity = '0';
    tween(faces, { opacity: 1, delay: MOVE_MS * 0.55, duration: 260, ease: 'outQuad' });
    tween(el, {
      '--lift': '0px',
      delay: MOVE_MS * 0.55,
      ease: spring({ bounce: 0.5, duration: 900 }),
      // The spring overshoots below zero; reflecting it makes the block bounce off the floor instead of sinking into it.
      modifier: (v: number) => Math.abs(v),
      onComplete: () => ripple(this.ripplesG, placed.x + NODE_W / 2, placed.y + NODE_H / 2, 'new', { w: NODE_W, h: NODE_H }),
    });
  }

  /** First render: the flat map tilts into perspective, blocks rise lane by lane, tracks draw in. */
  private intro(): void {
    const target = this.fitCamera(HOME_ANGLE.tilt, HOME_ANGLE.spin);
    if (this.reduced) {
      Object.assign(this.cam, target);
      this.applyCamera();
      return;
    }
    const flat = this.fitCamera(0, 0);
    Object.assign(this.cam, flat);
    this.applyCamera();
    tween(this.cam, { ...target, delay: 120, duration: 1500, ease: 'inOutCubic', onUpdate: () => this.applyCamera() });

    const laneOrder = (n: ArchNode) => ARCH_LANES.indexOf(n.lane);
    const ordered = [...this.layout!.nodes.values()].sort((a, b) => laneOrder(a.node) - laneOrder(b.node) || a.y - b.y).map((p) => this.blocks.get(p.node.id)!);
    tween(ordered, {
      '--h': (el?: unknown) => `${this.heights.get((el as HTMLElement).dataset.id!) ?? 20}px`,
      delay: stagger(26, { start: 520 }),
      duration: 900,
      ease: 'outBack(1.5)',
    });

    const lines = [...this.edges.values()].map((g) => g.querySelector<SVGPathElement>('path.line')!);
    const start = 1250;
    lines.forEach((line, i) => {
      const g = line.parentElement!;
      setTimeoutAnimated(() => g.classList.remove('pending'), start + i * 24);
      drawIn(line, {
        delay: start + i * 24,
        duration: 650,
        onComplete: i === lines.length - 1 ? () => lines.forEach((l, k) => sendParticle(this.particlesG, l, { delay: k * 45, r: 3.2 })) : undefined,
      });
    });
  }

  // ── marks & highlight ────────────────────────────────────────────────────

  setMarks(marks: Map<string, Mark>): void {
    const prev = this.marks;
    this.marks = marks;
    // Edited components bounce in place (new and removed ones animate during render).
    for (const [id, m] of marks) {
      if (m !== 'modified' || prev.get(id) === 'modified') continue;
      const el = this.blocks.get(id);
      const p = this.layout?.nodes.get(id);
      if (!el || !p || this.reduced) continue;
      const h = this.heights.get(id) ?? 20;
      tween(el, {
        '--h': [
          { to: `${h + 18}px`, duration: 220, ease: 'outQuad' },
          { to: `${h}px`, ease: spring({ bounce: 0.6, duration: 900 }) },
        ],
      });
      ripple(this.ripplesG, p.x + NODE_W / 2, p.y + NODE_H / 2, 'modified', { w: NODE_W, h: NODE_H });
    }
    this.applyMarks();
  }

  private applyMarks(): void {
    for (const [id, el] of this.blocks) {
      const m = this.marks.get(id);
      el.classList.toggle('mark-new', m === 'new');
      el.classList.toggle('mark-modified', m === 'modified');
      el.querySelector('.b-badge')!.textContent = m ? GLYPH[m] : '';
    }
  }

  setHighlight(hl: Highlight): void {
    const changed = this.hl.selected !== hl.selected;
    this.hl = hl;
    this.applyHighlight();
    if (changed) {
      this.stopSelection();
      const paths = hl.selected && !hl.flow
        ? [...(hl.focus?.edges ?? [])].map((id) => this.edges.get(id)?.querySelector<SVGPathElement>('path.line')).filter((p): p is SVGPathElement => !!p)
        : [];
      this.stopSelection = traceSelection(this.particlesG, paths);
    }
  }

  private applyHighlight(): void {
    const { selected, focus, matches, frame, flow } = this.hl;
    let active: Set<string> | null = null;
    let hot: Set<string> | null = null;
    let soft = false;
    if (frame) active = frame;
    else if (focus) {
      active = focus.nodes;
      hot = focus.edges;
    } else if (matches) active = matches;
    else if (this.hover && this.layout) {
      soft = true;
      active = new Set([this.hover]);
      hot = new Set();
      for (const p of this.layout.edges.values()) {
        if (p.edge.source !== this.hover && p.edge.target !== this.hover) continue;
        hot.add(p.edge.id);
        active.add(p.edge.source);
        active.add(p.edge.target);
      }
    }
    for (const [id, el] of this.blocks) {
      el.classList.toggle('selected', id === selected);
      el.classList.toggle('match', !!matches?.has(id));
      el.classList.toggle('dim', !soft && !!active && !active.has(id));
      el.classList.toggle('faded', soft && !!active && !active.has(id));
    }
    for (const [id, g] of this.edges) {
      const placed = this.layout?.edges.get(id);
      const off = hot ? !hot.has(id) : !!active && !!placed && !(active.has(placed.edge.source) && active.has(placed.edge.target));
      g.classList.toggle('hot', !!hot?.has(id));
      g.classList.toggle('dim', !soft && off);
      g.classList.toggle('faded', soft && off);
      g.querySelector('path.line')!.setAttribute('marker-end', hot?.has(id) ? 'url(#gv3-arrow-hot)' : 'url(#gv3-arrow)');
    }
    // The selected block lifts off the floor.
    if (this.lifted !== selected) {
      const down = this.lifted ? this.blocks.get(this.lifted) : undefined;
      const up = selected ? this.blocks.get(selected) : undefined;
      if (this.reduced) {
        down?.style.setProperty('--lift', '0px');
        up?.style.setProperty('--lift', '14px');
      } else {
        if (down) tween(down, { '--lift': '0px', duration: 400, ease: 'outQuad' });
        if (up) tween(up, { '--lift': '14px', ease: spring({ bounce: 0.45, duration: 600 }) });
      }
      this.lifted = selected;
    }
    this.stopFlow();
    this.stopFlow = flow && hot ? startFlow(this.particlesG, [...hot].map((id) => this.edges.get(id)?.querySelector<SVGPathElement>('path.line')).filter((p): p is SVGPathElement => !!p)) : () => {};
  }

  // ── camera ───────────────────────────────────────────────────────────────

  private applyCamera(): void {
    const c = this.cam;
    this.cameraEl.style.transform = `translate(${c.panX}px, ${c.panY}px) scale(${c.zoom}) rotateX(${c.tilt}deg) rotateZ(${c.spin}deg)`;
    this.root.classList.toggle('top-down', c.tilt < 8);
  }

  private moveCamera(target: Partial<Camera>, duration = 900, ease = 'inOutCubic'): void {
    utils.remove(this.cam);
    if (this.reduced || duration === 0) {
      Object.assign(this.cam, target);
      this.applyCamera();
      return;
    }
    tween(this.cam, { ...target, duration, ease, onUpdate: () => this.applyCamera() });
  }

  /**
   * Camera that frames the whole city at the given angle. Perspective makes
   * the analytic estimate imprecise, so the result is refined by measuring the
   * projected blocks the browser actually renders (two passes converge).
   */
  private fitCamera(tilt: number, spin: number): Camera {
    const estimate = this.estimateCamera(tilt, spin);
    if (!this.blocks.size) return estimate;
    const saved = { ...this.cam };
    // Measure the finished city: blocks may still be flat during the intro.
    const savedHeights = new Map<HTMLDivElement, string>();
    for (const [id, el] of this.blocks) {
      savedHeights.set(el, el.style.getPropertyValue('--h'));
      el.style.setProperty('--h', `${this.heights.get(id) ?? 20}px`);
    }
    const box = this.root.getBoundingClientRect();
    const margin = { x: 28, top: 36, bottom: 64 };
    let cam = estimate;
    for (let pass = 0; pass < 2; pass++) {
      Object.assign(this.cam, cam);
      this.applyCamera();
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const el of this.blocks.values()) {
        for (const face of [el.querySelector('.b-top'), el.querySelector('.b-shadow')]) {
          const r = face!.getBoundingClientRect();
          x0 = Math.min(x0, r.left);
          y0 = Math.min(y0, r.top);
          x1 = Math.max(x1, r.right);
          y1 = Math.max(y1, r.bottom);
        }
      }
      const availW = box.width - margin.x * 2;
      const availH = box.height - margin.top - margin.bottom;
      const scale = Math.min(availW / (x1 - x0), availH / (y1 - y0));
      const zoom = clamp(cam.zoom * scale, 0.25, 1.6);
      // Content centre relative to the screen centre, in unscaled camera units.
      const cx = (x0 + x1) / 2 - (box.left + box.width / 2);
      const cy = (y0 + y1) / 2 - (box.top + box.height / 2);
      const targetCy = (margin.top - margin.bottom) / 2;
      cam = {
        tilt,
        spin,
        zoom,
        panX: -((cx - cam.panX) / cam.zoom) * zoom,
        panY: -((cy - cam.panY) / cam.zoom) * zoom + targetCy,
      };
    }
    for (const [el, h] of savedHeights) el.style.setProperty('--h', h);
    Object.assign(this.cam, saved);
    this.applyCamera();
    return cam;
  }

  private estimateCamera(tilt: number, spin: number): Camera {
    const box = this.root.getBoundingClientRect();
    const l = this.layout;
    if (!l || !box.width) return { tilt, spin, zoom: 1, panX: 0, panY: 0 };
    const s = Math.abs(rad(spin));
    const t = rad(tilt);
    const w = l.width * Math.cos(s) + l.height * Math.sin(s);
    const depth = l.width * Math.sin(s) + l.height * Math.cos(s);
    const h = depth * Math.cos(t) + 80 * Math.sin(t);
    const zoom = clamp(Math.min((box.width - 40) / w, (box.height - 40) / h) * 0.94, 0.25, 1.35);
    // Center the content (not the world origin) on screen.
    const cx = l.width / 2 - this.origin!.x;
    const cy = l.height / 2 - this.origin!.y;
    const p = this.project(cx, cy, tilt, spin, zoom);
    return { tilt, spin, zoom, panX: -p.x, panY: -p.y + 10 * Math.sin(t) };
  }

  /** Approximate screen offset of a world point relative to the camera origin (ignores perspective). */
  private project(x: number, y: number, tilt = this.cam.tilt, spin = this.cam.spin, zoom = this.cam.zoom): Point {
    const s = rad(spin);
    const xr = x * Math.cos(s) - y * Math.sin(s);
    const yr = x * Math.sin(s) + y * Math.cos(s);
    return { x: xr * zoom, y: yr * Math.cos(rad(tilt)) * zoom };
  }

  fit(duration = 700): void {
    this.moveCamera(this.fitCamera(this.cam.tilt, this.cam.spin), duration);
  }

  /** Back to the default angle, framing everything. */
  home(): void {
    this.moveCamera(this.fitCamera(HOME_ANGLE.tilt, HOME_ANGLE.spin), 1000);
  }

  rotateBy(deg: number): void {
    this.moveCamera({ spin: this.cam.spin + deg }, 700, 'inOutQuad');
  }

  /** Toggles between a top-down plan and the 3D view. */
  toggleTilt(): void {
    const tilt = this.cam.tilt > 8 ? 0 : HOME_ANGLE.tilt;
    this.moveCamera(this.fitCamera(tilt, tilt === 0 ? 0 : this.cam.spin || HOME_ANGLE.spin), 900);
  }

  zoomBy(factor: number): void {
    this.moveCamera({ zoom: clamp(this.cam.zoom * factor, 0.2, 3), panX: this.cam.panX * factor, panY: this.cam.panY * factor }, 260, 'outQuad');
  }

  reveal(id: string): void {
    const p = this.layout?.nodes.get(id);
    if (!p || !this.origin) return;
    const zoom = Math.max(this.cam.zoom, 0.8);
    const s = this.project(p.x + NODE_W / 2 - this.origin.x, p.y + NODE_H / 2 - this.origin.y, this.cam.tilt, this.cam.spin, zoom);
    this.moveCamera({ zoom, panX: -s.x, panY: -s.y }, 700);
  }

  ensureVisible(id: string): void {
    const top = this.blocks.get(id)?.querySelector('.b-top');
    if (!top) return;
    const r = top.getBoundingClientRect();
    const box = this.root.getBoundingClientRect();
    const m = 32;
    if (r.left < box.left + m || r.right > box.right - m || r.top < box.top + m || r.bottom > box.bottom - m) this.reveal(id);
  }

  // ── input ────────────────────────────────────────────────────────────────

  private onPointerDown = (e: PointerEvent) => {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), zoom: this.cam.zoom };
      this.drag = null;
    } else {
      this.drag = { mode: e.button === 2 || e.altKey || e.shiftKey ? 'orbit' : 'pan', x: e.clientX, y: e.clientY, moved: false };
    }
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  };

  private onPointerMove = (e: PointerEvent) => {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      this.cam.zoom = clamp((this.pinch.zoom * dist) / this.pinch.dist, 0.2, 3);
      this.applyCamera();
      return;
    }
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) {
      d.moved = true;
      utils.remove(this.cam);
      this.root.classList.add('dragging');
    }
    d.x = e.clientX;
    d.y = e.clientY;
    if (d.mode === 'pan') {
      this.cam.panX += dx;
      this.cam.panY += dy;
    } else {
      this.cam.spin += dx * 0.35;
      this.cam.tilt = clamp(this.cam.tilt - dy * 0.3, 0, 78);
    }
    this.applyCamera();
  };

  private onPointerUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.drag?.moved) {
      this.suppressClick = true;
      window.setTimeout(() => (this.suppressClick = false), 0);
    }
    this.drag = null;
    this.root.classList.remove('dragging');
    if (!this.pointers.size) {
      window.removeEventListener('pointermove', this.onPointerMove);
      window.removeEventListener('pointerup', this.onPointerUp);
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    utils.remove(this.cam);
    const box = this.root.getBoundingClientRect();
    const px = e.clientX - box.left - box.width / 2;
    const py = e.clientY - box.top - box.height / 2;
    const k = clamp(this.cam.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), 0.2, 3) / this.cam.zoom;
    // Zoom toward the pointer.
    this.cam.panX = px - (px - this.cam.panX) * k;
    this.cam.panY = py - (py - this.cam.panY) * k;
    this.cam.zoom *= k;
    this.applyCamera();
  };

  private onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, [contenteditable]') || e.metaKey || e.ctrlKey) return;
    if (e.key === 'q' || e.key === 'Q') this.rotateBy(-30);
    else if (e.key === 'e' || e.key === 'E') this.rotateBy(30);
    else if (e.key === 'r' || e.key === 'R') this.home();
    else if (e.key === 't' || e.key === 'T') this.toggleTilt();
  };
}

/** A delayed call on the anime.js clock, so it stays in sync with the animations around it. */
function setTimeoutAnimated(fn: () => void, delay: number): void {
  tween({ v: 0 }, { v: 1, duration: 1, delay, onComplete: fn });
}
