import { idFor, type ArchCategory, type ArchEdge, type ArchGraph, type ArchKind, type ArchLane, type ArchNode, type CodeEdgeKind, type SourceRef } from '@eyrie/core';

/** The layers each part of the system is split into, in request order. */
export type SystemLayer = 'ui' | 'api' | 'services' | 'data';

/** What a System-view box stands for. Stored in `meta.system` of the box. */
export interface SystemPart {
  /** Workspace directory the box belongs to (`apps/admin`), or '' for a single-app repository. */
  scope: string;
  layer: SystemLayer;
  /** Component ids folded into the box, sorted. */
  members: string[];
}

/** Every System-view box id starts with this, so it can never collide with a component id. */
export const SYSTEM_ID_PREFIX = 'sys-';

const LAYER: Record<SystemLayer, { name: string; kind: ArchKind; lane: ArchLane; category: ArchCategory }> = {
  ui: { name: 'UI', kind: 'component', lane: 'ui', category: 'frontend' },
  api: { name: 'API', kind: 'api_route', lane: 'api', category: 'api' },
  services: { name: 'Services', kind: 'service', lane: 'logic', category: 'service' },
  data: { name: 'Data', kind: 'database_model', lane: 'data', category: 'data' },
};

const LAYER_OF_LANE: Record<ArchLane, SystemLayer | null> = { ui: 'ui', edge: 'api', api: 'api', logic: 'services', data: 'data', external: null };

/** Top-level folders that hold one workspace app or package per subfolder. */
const WORKSPACE_DIRS = new Set(['apps', 'packages', 'services', 'libs']);

const PLURAL: Record<ArchKind, string> = {
  page: 'pages',
  component: 'components',
  hook: 'hooks',
  middleware: 'middleware',
  api_route: 'API routes',
  server_action: 'server action files',
  service: 'services',
  repository: 'repositories',
  module: 'modules',
  database_model: 'data models',
  external_service: 'external services',
  queue: 'queues',
  background_job: 'background jobs',
};

/** `apps/admin/src/x.ts` → `apps/admin`; anything outside a workspace folder → ''. */
export function scopeOf(file: string | undefined): string {
  const parts = file?.split('/') ?? [];
  return parts.length > 2 && WORKSPACE_DIRS.has(parts[0]!) ? `${parts[0]}/${parts[1]}` : '';
}

/**
 * The box a component belongs to, or null when it stands on its own:
 * external services are systems in their own right, and a missing route
 * must stay visible rather than disappear into a group.
 */
export function systemPartOf(node: ArchNode): { scope: string; layer: SystemLayer } | null {
  if (node.meta?.missing === true) return null;
  const layer = LAYER_OF_LANE[node.lane];
  return layer ? { scope: scopeOf(node.files[0] ?? node.source?.file), layer } : null;
}

export function systemBoxId(scope: string, layer: SystemLayer): string {
  return `${SYSTEM_ID_PREFIX}${idFor(`system:${scope}:${layer}`)}`;
}

/** The id a component is shown under in the System view: its box, or itself. */
export function systemIdOf(node: ArchNode): string {
  const part = systemPartOf(node);
  return part ? systemBoxId(part.scope, part.layer) : node.id;
}

const ACRONYMS = new Set(['ai', 'api', 'cdn', 'cli', 'cms', 'crm', 'db', 'erp', 'ml', 'otp', 'sdk', 'sms', 'sso', 'ui']);
/** `admin-portal` → Admin Portal, `sms` → SMS. */
const title = (s: string) => s.split(/[-_.\s]+/).filter(Boolean).map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1))).join(' ');
const count = (n: number, word: string) => `${n} ${n === 1 ? word.replace(/s$/, '') : word}`;

/**
 * System view of the architecture graph: the parts a reader would draw on a
 * whiteboard. Components are grouped by workspace (each app or package in a
 * monorepo) and by layer, so a two-app repository reads as "Admin UI → Admin
 * API → Data", not as a hundred components. External services and missing
 * routes keep their own boxes. Links between boxes merge the component links
 * they stand for: their kinds, total weight and a few example call sites.
 *
 * Deterministic: a grouping of what static analysis found. Nothing is added.
 */
export function systemLens(nodes: readonly ArchNode[], edges: readonly ArchEdge[]): ArchGraph {
  const groups = new Map<string, { scope: string; layer: SystemLayer; members: ArchNode[] }>();
  const boxOf = new Map<string, string>();
  const standalone: ArchNode[] = [];
  for (const n of nodes) {
    const part = systemPartOf(n);
    if (!part) {
      standalone.push(n);
      boxOf.set(n.id, n.id);
      continue;
    }
    const id = systemBoxId(part.scope, part.layer);
    const g = groups.get(id) ?? { ...part, members: [] };
    g.members.push(n);
    groups.set(id, g);
    boxOf.set(n.id, id);
  }

  const layersPerScope = new Map<string, number>();
  for (const g of groups.values()) layersPerScope.set(g.scope, (layersPerScope.get(g.scope) ?? 0) + 1);

  const boxes: ArchNode[] = [];
  for (const [id, g] of groups) {
    const layer = LAYER[g.layer];
    const name = g.scope ? title(g.scope.split('/')[1]!) : '';
    const label = !name ? layer.name : layersPerScope.get(g.scope) === 1 ? name : `${name} ${layer.name}`;
    const members = [...g.members].sort((a, b) => a.key.localeCompare(b.key));
    const kinds = new Map<ArchKind, number>();
    const categories = new Map<ArchCategory, number>();
    for (const m of members) {
      kinds.set(m.kind, (kinds.get(m.kind) ?? 0) + 1);
      categories.set(m.category, (categories.get(m.category) ?? 0) + 1);
    }
    const breakdown = [...kinds].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => count(n, PLURAL[k]));
    const unit = g.layer === 'data' ? 'data component' : 'component';
    // The most common category among members; ties go to the layer's own, then alphabetically.
    const category = [...categories].sort((a, b) => b[1] - a[1] || Number(b[0] === layer.category) - Number(a[0] === layer.category) || a[0].localeCompare(b[0]))[0]![0];
    const loc = members.reduce((sum, m) => sum + (Number(m.meta?.loc) || 0), 0);
    const part: SystemPart = { scope: g.scope, layer: g.layer, members: members.map((m) => m.id) };
    boxes.push({
      id,
      key: `system:${g.scope}:${g.layer}`,
      kind: layer.kind,
      category,
      lane: layer.lane,
      label,
      // The card already shows the count; the subtitle says where the box lives, or what it holds.
      sublabel: g.scope || breakdown.slice(0, 2).join(', '),
      members: [],
      files: [...new Set(members.flatMap((m) => m.files))].sort(),
      summary: `Groups ${count(members.length, `${unit}s`)}${g.scope ? ` in ${g.scope}` : ''}: ${breakdown.join(', ')}.`,
      meta: { system: part, loc },
    });
  }

  const merged = new Map<string, { source: string; target: string; kinds: Set<CodeEdgeKind>; weight: number; links: number; sites: SourceRef[] }>();
  // Stable input order, so the example call sites kept on a merged link do not depend on it.
  for (const e of [...edges].sort((a, b) => a.id.localeCompare(b.id))) {
    const source = boxOf.get(e.source);
    const target = boxOf.get(e.target);
    if (!source || !target || source === target) continue;
    const key = `${source}>${target}`;
    const m = merged.get(key) ?? { source, target, kinds: new Set<CodeEdgeKind>(), weight: 0, links: 0, sites: [] };
    for (const k of e.kinds) m.kinds.add(k);
    m.weight += e.weight;
    m.links++;
    for (const s of e.sites ?? []) if (m.sites.length < 3) m.sites.push(s);
    merged.set(key, m);
  }
  const links: ArchEdge[] = [...merged.values()].map((m) => {
    const edge: ArchEdge = {
      id: `${SYSTEM_ID_PREFIX}${idFor(`system-edge:${m.source}>${m.target}`)}`,
      source: m.source,
      target: m.target,
      kinds: [...m.kinds].sort(),
      weight: m.weight,
      meta: { system: { links: m.links } },
    };
    if (m.sites.length) edge.sites = m.sites;
    return edge;
  });

  return {
    nodes: [...boxes, ...standalone].sort((a, b) => a.key.localeCompare(b.key)),
    edges: links.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function isSystemBox(node: ArchNode): boolean {
  return node.id.startsWith(SYSTEM_ID_PREFIX) && !!node.meta?.system;
}
