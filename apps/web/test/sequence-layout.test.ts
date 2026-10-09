import { describe, expect, it } from 'vitest';
import type { ArchNode } from '@eyrie/core';
import type { SequenceTrace } from '@eyrie/lens';
import { messageY, sequenceLayout } from '../src/graph/sequence-layout';

const component = (id: string): ArchNode => ({ id, key: id, label: id, kind: 'service', category: 'service', lane: 'logic', members: [], files: [] });
const byId = new Map(['a', 'b', 'c'].map((id) => [id, component(id)]));
const trace: SequenceTrace = { entry: 'a', participants: ['a', 'b', 'c'], truncated: false, steps: [
  { id: 'first', order: 0, depth: 0, from: 'a', to: 'b', kinds: ['CALLS'], collapsed: false, site: { file: 'service.ts', line: 12 } },
  { id: 'second', order: 1, depth: 1, from: 'b', to: 'c', kinds: ['READS_FROM'], collapsed: true, via: ['repository'] },
] };

describe('React Flow sequence layout', () => {
  it('anchors both ends of each message to the same ordered row', () => {
    const layout = sequenceLayout(trace, byId, null);
    for (const edge of layout.edges) {
      const source = layout.nodes.find((node) => node.id === edge.source)!;
      const target = layout.nodes.find((node) => node.id === edge.target)!;
      expect(source.data.handles.find((handle) => handle.id === edge.sourceHandle)?.top).toBe(messageY(edge.data!.step.order));
      expect(target.data.handles.find((handle) => handle.id === edge.targetHandle)?.top).toBe(messageY(edge.data!.step.order));
    }
    expect(layout.nodes.map((node) => node.position.x)).toEqual([0, 220, 440]);
    expect(layout.nodes.every((node) => node.draggable === false)).toBe(true);
  });
  it('preserves source links, collapsed calls, and selection without changing topology', () => {
    const layout = sequenceLayout(trace, byId, 'b');
    expect(layout.edges[0]!.data!.description).toContain('service.ts:12');
    expect(layout.edges[1]!.data!.verb).toContain('shown above');
    expect(layout.edges.every((edge) => edge.data!.hot)).toBe(true);
    expect(layout.nodes.find((node) => node.id === 'b')!.data.active).toBe(true);
    expect(sequenceLayout(trace, byId, null).edges.map((edge) => edge.id)).toEqual(layout.edges.map((edge) => edge.id));
  });
  it('allocates distinct ports for a self call and omits missing participants safely', () => {
    const self = { ...trace, steps: [{ ...trace.steps[0]!, to: 'a' }] };
    const layout = sequenceLayout(self, byId, null);
    const handles = layout.nodes[0]!.data.handles;
    expect(handles[1]!.top - handles[0]!.top).toBe(18);
    expect(layout.edges[0]!.data!.self).toBe(true);
    expect(sequenceLayout(trace, new Map([['a', component('a')]]), null).edges).toEqual([]);
  });
});
