import { describe, expect, it } from 'vitest';
import { OrthographicCamera, Vector3 } from 'three';
import type { ArchNode } from '@eyrie/core';
import { NODE_H, NODE_W, type Layout } from '../src/graph/layout';
import { CITY_LABEL_H, CITY_LABEL_W, HOME_ANGLE, blockHeight, cityLabelMatrix, orientCamera, projectCity, projectPoint } from '../src/graph3d/projection';

const node: ArchNode = { id: 'service', key: 'service', kind: 'service', category: 'service', lane: 'logic', label: 'OrderService', members: [], files: [], meta: { loc: 120 } };
const origin = { x: 600, y: 300 };
const placed = { node, x: 410, y: 190 };
const layout: Layout = { nodes: new Map([[node.id, placed]]), edges: new Map(), lanes: [], width: 1200, height: 600 };

describe('React Flow / Three.js projection', () => {
  it.each([HOME_ANGLE, { yaw: 40, elevation: 32 }, { yaw: 120, elevation: 89.9 }])('keeps all four label corners on the roof at %j', (angle) => {
    const camera = new OrthographicCamera();
    orientCamera(camera, angle);
    const projected = projectCity(layout, angle, origin).nodes.get(node.id)!;
    const [a, b, c, d, e, f] = cityLabelMatrix(angle);
    const direction = Math.cos(angle.yaw * Math.PI / 180) < 0 ? -1 : 1;
    for (const x of [0, CITY_LABEL_W]) for (const y of [0, CITY_LABEL_H]) {
      const expected = projectPoint(camera, { x: placed.x + NODE_W / 2 + direction * (x - CITY_LABEL_W / 2), y: placed.y + NODE_H / 2 + direction * (y - CITY_LABEL_H / 2) }, blockHeight(node) + 2, origin);
      expect(projected.x + a * x + c * y + e).toBeCloseTo(expected.x, 8);
      expect(projected.y + b * x + d * y + f).toBeCloseTo(expected.y, 8);
    }
  });
  it.each([HOME_ANGLE, { yaw: 40, elevation: 32 }, { yaw: 120, elevation: 89.9 }])('anchors the custom node to its block top at %j', (angle) => {
    const camera = new OrthographicCamera();
    orientCamera(camera, angle);
    const expected = projectPoint(camera, { x: placed.x + NODE_W / 2, y: placed.y + NODE_H / 2 }, blockHeight(node) + 2, origin);
    const projected = projectCity(layout, angle, origin).nodes.get(node.id)!;
    expect(projected.node).toBe(node);
    expect(projected.x + CITY_LABEL_W / 2).toBeCloseTo(expected.x, 8);
    expect(projected.y + CITY_LABEL_H / 2).toBeCloseTo(expected.y, 8);
  });

  it('matches WebGL screen pixels after React Flow pan and zoom', () => {
    const camera = new OrthographicCamera();
    orientCamera(camera, HOME_ANGLE);
    const viewport = { x: 123, y: 241, zoom: 1.3 };
    const width = 1000;
    const height = 600;
    Object.assign(camera, { left: -viewport.x / viewport.zoom, right: (width - viewport.x) / viewport.zoom, top: viewport.y / viewport.zoom, bottom: (viewport.y - height) / viewport.zoom });
    camera.updateProjectionMatrix();
    const point = { x: 460, y: 230 };
    const flow = projectPoint(camera, point, 40, origin);
    const webgl = new Vector3(point.x - origin.x, 40, point.y - origin.y).project(camera);
    expect((webgl.x + 1) * width / 2).toBeCloseTo(flow.x * viewport.zoom + viewport.x, 8);
    expect((1 - webgl.y) * height / 2).toBeCloseTo(flow.y * viewport.zoom + viewport.y, 8);
  });

  it('keeps top-down projection finite and leaves source coordinates untouched', () => {
    const projected = projectCity(layout, { yaw: 0, elevation: 90 }, origin).nodes.get(node.id)!;
    expect(Number.isFinite(projected.x) && Number.isFinite(projected.y)).toBe(true);
    expect(layout.nodes.get(node.id)).toEqual(placed);
    expect(projected).not.toBe(placed);
  });
});

describe('source-backed block heights', () => {
  it('grows monotonically with LOC and caps oversized modules', () => {
    const heights = [0, 30, 120, 1000, 100000].map((loc) => blockHeight({ ...node, meta: { loc } }));
    expect(heights).toEqual([...heights].sort((a, b) => a - b));
    expect(heights.at(-1)).toBe(80);
    expect(blockHeight({ ...node, meta: { loc: -20 } })).toBe(12);
  });
  it('retains the established broken, external, and data-model meanings', () => {
    expect(blockHeight({ ...node, meta: { missing: true } })).toBe(6);
    expect(blockHeight({ ...node, kind: 'external_service' })).toBe(26);
    expect(blockHeight({ ...node, kind: 'database_model', meta: { fields: ['id', 'name', 'email'] } })).toBe(18);
  });
});
