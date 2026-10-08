/**
 * Motion effects shared by the 2D and 3D views, built on anime.js.
 * Every effect is skipped when the user prefers reduced motion.
 */
import { animate, createDrawable, createMotionPath, utils, type JSAnimation } from 'animejs';

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Draws a path from its start to its end (a new dependency appearing). */
export function drawIn(path: SVGPathElement, opts: { delay?: number; duration?: number; onComplete?: () => void } = {}): JSAnimation | null {
  if (reducedMotion()) {
    opts.onComplete?.();
    return null;
  }
  const edge = path.closest('.edge');
  // Dashed (HTTP) styling would override the drawing dashes while the line draws.
  edge?.classList.add('drawing');
  const [drawable] = createDrawable(path);
  return animate(drawable!, {
    draw: ['0 0', '0 1'],
    delay: opts.delay ?? 0,
    duration: opts.duration ?? 700,
    ease: 'inOutQuad',
    onComplete: () => {
      for (const attr of ['pathLength', 'stroke-dasharray', 'stroke-dashoffset']) path.removeAttribute(attr);
      path.style.removeProperty('stroke-linecap');
      edge?.classList.remove('drawing');
      opts.onComplete?.();
    },
  });
}

function particle(layer: SVGGElement, r: number, className: string): SVGCircleElement {
  const dot = document.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('r', String(r));
  dot.setAttribute('class', className);
  layer.appendChild(dot);
  return dot;
}

/** Sends one request travelling along a path. */
export function sendParticle(layer: SVGGElement, path: SVGPathElement, opts: { delay?: number; r?: number; className?: string } = {}): () => void {
  if (reducedMotion()) return () => {};
  const len = path.getTotalLength();
  if (!len) return () => {};
  const dot = particle(layer, opts.r ?? 3, opts.className ?? 'particle');
  const motion = createMotionPath(path);
  animate(dot, {
    translateX: motion.translateX,
    translateY: motion.translateY,
    delay: opts.delay ?? 0,
    duration: Math.min(1600, 450 + len * 1.4),
    ease: 'inOutSine',
    onComplete: () => dot.remove(),
  });
  return () => {
    utils.remove(dot);
    dot.remove();
  };
}

/** One bounded sweep makes the selected component's dependencies visible. */
export function traceSelection(layer: SVGGElement, paths: SVGPathElement[]): () => void {
  const stops = paths.slice(0, 18).map((path, i) => sendParticle(layer, path, { delay: i * 12, r: 3.2, className: 'particle selection-particle' }));
  return () => stops.forEach((stop) => stop());
}

/** Continuous request flow along a set of paths; returns a stop function. */
export function startFlow(layer: SVGGElement, paths: SVGPathElement[]): () => void {
  if (reducedMotion() || !paths.length) return () => {};
  const dots: SVGCircleElement[] = [];
  paths.forEach((path, i) => {
    const len = path.getTotalLength();
    if (!len) return;
    const motion = createMotionPath(path);
    for (let k = 0; k < 2; k++) {
      const dot = particle(layer, 2.4, 'particle flow');
      dots.push(dot);
      animate(dot, {
        translateX: motion.translateX,
        translateY: motion.translateY,
        duration: Math.max(900, len * 7),
        delay: (k * Math.max(900, len * 7)) / 2 + i * 60,
        ease: 'linear',
        loop: true,
      });
    }
  });
  return () => {
    utils.remove(dots);
    for (const d of dots) d.remove();
  };
}

/** An expanding ring on a floor/canvas at (cx, cy): new, edited or removed. */
export function ripple(layer: SVGGElement, cx: number, cy: number, kind: 'new' | 'modified' | 'removed', size: { w: number; h: number }): void {
  if (reducedMotion()) return;
  const ring = document.createElementNS(SVG_NS, 'rect');
  ring.setAttribute('class', `ripple ripple-${kind}`);
  ring.setAttribute('x', String(cx - size.w / 2));
  ring.setAttribute('y', String(cy - size.h / 2));
  ring.setAttribute('width', String(size.w));
  ring.setAttribute('height', String(size.h));
  ring.setAttribute('rx', '14');
  ring.style.transformOrigin = `${cx}px ${cy}px`;
  layer.appendChild(ring);
  animate(ring, {
    scale: [1, 1.6],
    opacity: [0.9, 0],
    duration: 1100,
    ease: 'outQuad',
    loop: 1,
    onComplete: () => ring.remove(),
  });
}
