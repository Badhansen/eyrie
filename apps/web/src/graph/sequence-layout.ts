import { MarkerType, Position, type Edge, type Node } from '@xyflow/react';
import type { ArchNode } from '@eyrie/core';
import type { SequenceStep, SequenceTrace } from '@eyrie/lens';
import { edgeVerbs, linkClassOf } from './vocabulary';

export const SEQUENCE_COLUMN = 220;
export const SEQUENCE_WIDTH = 180;
export const SEQUENCE_HEAD = 52;
export const SEQUENCE_ROW = 48;
export const messageY = (order: number) => SEQUENCE_HEAD + 30 + order * SEQUENCE_ROW;
export type ParticipantNode = Node<{ node: ArchNode; active: boolean; height: number; handles: { id: string; type: 'source' | 'target'; top: number; position: Position }[] }, 'participant'>;
export type MessageEdge = Edge<{ step: SequenceStep; description: string; verb: string; hot: boolean; self: boolean }, 'message'>;

export function sequenceLayout(trace: SequenceTrace, byId: Map<string, ArchNode>, selected: string | null): { nodes: ParticipantNode[]; edges: MessageEdge[] } {
  const height = messageY(trace.steps.length) + 24;
  const columns = new Map(trace.participants.map((id, index) => [id, index]));
  const nodes: ParticipantNode[] = trace.participants.flatMap((id, index) => {
    const node = byId.get(id);
    if (!node) return [];
    return [{ id, type: 'participant', position: { x: index * SEQUENCE_COLUMN, y: 0 }, width: SEQUENCE_WIDTH, height,
      draggable: false, selectable: false, focusable: false,
      data: { node, active: id === selected, height, handles: trace.steps.flatMap((step) => [
        ...(step.from === id ? [{ id: `from-${step.id}`, type: 'source' as const, top: messageY(step.order), position: Position.Right }] : []),
        ...(step.to === id ? [{ id: `to-${step.id}`, type: 'target' as const, top: messageY(step.order) + (step.from === step.to ? 18 : 0), position: Position.Left }] : []),
      ]) } }];
  });
  const edges: MessageEdge[] = trace.steps.filter((step) => byId.has(step.from) && byId.has(step.to) && columns.has(step.from) && columns.has(step.to)).map((step) => {
    const from = byId.get(step.from)!;
    const to = byId.get(step.to)!;
    const verb = edgeVerbs(step.kinds);
    const hot = step.from === selected || step.to === selected;
    return { id: step.id, type: 'message', source: step.from, target: step.to, sourceHandle: `from-${step.id}`, targetHandle: `to-${step.id}`, selectable: false, focusable: false,
      className: `seq-step ${linkClassOf(step.kinds)}${hot ? ' hot' : ''}${step.collapsed ? ' collapsed' : ''}`,
      markerEnd: { type: MarkerType.ArrowClosed, color: hot ? 'var(--color-text)' : 'var(--color-dim)', width: 16, height: 16 },
      data: { step, hot, self: step.from === step.to, verb: step.collapsed ? `${verb} · shown above` : verb,
        description: `${step.order + 1}. ${from.label} ${verb} ${to.label}${step.via?.length ? `, via ${step.via.join(' > ')}` : ''}${step.site ? `, at ${step.site.file}:${step.site.line}` : ''}` } };
  });
  return { nodes, edges };
}
