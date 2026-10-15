import type { ArchCategory, ArchEdge, ArchKind, ArchLane, ArchNode, CodeEdgeKind } from '@eyrie/core';
import type { DataRole, SystemLayer, SystemPart } from '@eyrie/lens';

export const CATEGORY_LABEL: Record<ArchCategory, string> = {
  frontend: 'Frontend',
  api: 'API',
  service: 'Services',
  ai: 'AI',
  data: 'Data',
  external: 'External',
  infra: 'Infra',
  utility: 'Utility',
};

export const CATEGORY_ORDER: ArchCategory[] = ['frontend', 'api', 'service', 'ai', 'data', 'external', 'utility'];

export const LANE_LABEL: Record<ArchLane, string> = {
  ui: 'UI',
  edge: 'Edge',
  api: 'API',
  logic: 'Logic',
  data: 'Data',
  external: 'External',
};

export const KIND_LABEL: Record<ArchKind, string> = {
  page: 'Page',
  component: 'Component',
  hook: 'Hook',
  middleware: 'Middleware',
  api_route: 'API route',
  server_action: 'Server actions',
  service: 'Service',
  repository: 'Repository',
  module: 'Module',
  database_model: 'Data model',
  external_service: 'External service',
  queue: 'Queue',
  background_job: 'Background job',
};

const EDGE_VERB: Partial<Record<CodeEdgeKind, string>> = {
  CALLS: 'calls',
  USES: 'uses',
  HTTP_CALL: 'HTTP',
  READS_FROM: 'reads',
  WRITES_TO: 'writes',
  EXTENDS: 'extends',
  IMPLEMENTS: 'implements',
  PUBLISHES: 'publishes',
  SUBSCRIBES: 'subscribes',
  TRIGGERS: 'triggers',
};

const LAYER_LABEL: Record<SystemLayer, string> = { ui: 'Frontend', api: 'API', services: 'Services', data: 'Data' };

/** What kind of thing a node is; for a System-view box, the layer it groups and how many components. */
export function kindLabel(n: ArchNode): string {
  const part = n.meta?.system as SystemPart | undefined;
  return part ? `${LAYER_LABEL[part.layer]} · ${part.members.length}` : KIND_LABEL[n.kind];
}

export function systemPart(n: ArchNode): SystemPart | null {
  return (n.meta?.system as SystemPart | undefined) ?? null;
}

export function edgeVerbs(kinds: CodeEdgeKind[]): string {
  return kinds.map((k) => EDGE_VERB[k] ?? k.toLowerCase()).join(' · ');
}

export const ROLE_LABEL: Record<DataRole, string> = {
  read: 'reads',
  write: 'writes',
  readwrite: 'reads and writes',
  transfer: 'sends over the network',
  carry: 'passes along',
};

export function dataRoleOf(edge: ArchEdge): DataRole | null {
  const role = edge.meta?.role;
  return typeof role === 'string' && role in ROLE_LABEL ? (role as DataRole) : null;
}

/** Class that styles a link by what it carries. The data-flow lens tags a role; otherwise the edge kinds decide. */
export function linkClassOf(kinds: readonly CodeEdgeKind[], role?: DataRole | null): string {
  if (role) return `role-${role}`;
  return [kinds.includes('HTTP_CALL') ? 'http' : '', kinds.includes('READS_FROM') || kinds.includes('WRITES_TO') ? 'data' : ''].filter(Boolean).join(' ');
}

export function linkClass(edge: ArchEdge): string {
  return linkClassOf(edge.kinds, dataRoleOf(edge));
}

export function isBroken(n: ArchNode): boolean {
  return n.meta?.missing === true;
}

/** CSS class that binds the category colour. */
export function catClass(n: ArchNode): string {
  return isBroken(n) ? 'cat-broken' : `cat-${n.category}`;
}
