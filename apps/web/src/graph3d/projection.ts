import { OrthographicCamera, Vector3 } from 'three';
import type { ArchNode } from '@eyrie/core';
import { NODE_H, NODE_W, type Layout, type Point } from '../graph/layout';
import { isBroken } from '../graph/vocabulary';

export const CITY_LABEL_W = 216;
export const CITY_LABEL_H = 68;
export const HOME_ANGLE = { yaw: -28, elevation: 52 };
export type CityAngle = typeof HOME_ANGLE;

/** The DOM label lies on the same x/z plane as the block roof. */
export function cityLabelMatrix(angle: CityAngle): [number, number, number, number, number, number] {
  const camera = new OrthographicCamera();
  orientCamera(camera, angle);
  const origin = { x: 0, y: 0 };
  const center = projectPoint(camera, origin, 0, origin);
  const x = projectPoint(camera, { x: 1, y: 0 }, 0, origin);
  const z = projectPoint(camera, { x: 0, y: 1 }, 0, origin);
  // Keep lettering facing the reader when orbiting to the far side.
  const direction = Math.cos(angle.yaw * Math.PI / 180) < 0 ? -1 : 1;
  const a = (x.x - center.x) * direction;
  const b = (x.y - center.y) * direction;
  const c = (z.x - center.x) * direction;
  const d = (z.y - center.y) * direction;
  return [a, b, c, d, (CITY_LABEL_W - a * CITY_LABEL_W - c * CITY_LABEL_H) / 2, (CITY_LABEL_H - b * CITY_LABEL_W - d * CITY_LABEL_H) / 2];
}

export function blockHeight(node: ArchNode): number {
  if (isBroken(node)) return 6;
  if (node.kind === 'external_service') return 26;
  if (node.kind === 'database_model') return Math.min(34, 12 + ((node.meta?.fields as string[] | undefined)?.length ?? 4) * 2);
  const loc = Math.max(0, Number(node.meta?.loc ?? 40) || 0);
  return Math.round(Math.min(80, 12 + 11 * Math.log2(1 + loc / 30)));
}

export function orientCamera(camera: OrthographicCamera, angle: CityAngle): void {
  const yaw = angle.yaw * Math.PI / 180;
  const elevation = Math.min(89.9, angle.elevation) * Math.PI / 180;
  camera.position.set(Math.sin(yaw) * Math.cos(elevation), Math.sin(elevation), Math.cos(yaw) * Math.cos(elevation)).multiplyScalar(10000);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
}

/** Camera-space pixels are React Flow coordinates, before pan and zoom. */
export function projectPoint(camera: OrthographicCamera, point: Point, height: number, origin: Point): Point {
  const vector = new Vector3(point.x - origin.x, height, point.y - origin.y).applyMatrix4(camera.matrixWorldInverse);
  return { x: vector.x, y: -vector.y };
}

export function projectCity(layout: Layout, angle: CityAngle, origin: Point): Layout {
  const camera = new OrthographicCamera();
  orientCamera(camera, angle);
  const nodes = new Map([...layout.nodes].map(([id, p]) => {
    const center = projectPoint(camera, { x: p.x + NODE_W / 2, y: p.y + NODE_H / 2 }, blockHeight(p.node) + 2, origin);
    return [id, { node: p.node, x: center.x - CITY_LABEL_W / 2, y: center.y - CITY_LABEL_H / 2 }];
  }));
  const edges = new Map([...layout.edges].map(([id, p]) => [id, { ...p, points: p.points.map((point) => projectPoint(camera, point, 1, origin)) }]));
  return { ...layout, nodes, edges, lanes: [] };
}
