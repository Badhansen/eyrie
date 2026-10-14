import { beforeAll, describe, expect, it } from 'vitest';
import type { ArchEdge, ArchGraph, ArchKind, ArchLane, ArchNode, CodeEdgeKind } from '@eyrie/core';
import { deriveArchitecture } from '@eyrie/architecture';
import { FixtureRepo } from '../../graph/test/fixture.js';
import { SYSTEM_ID_PREFIX, dataFlowLens, dataRole, entryPoints, sequenceTrace, systemLens, type SystemPart } from '../src/index.js';

const LANE: Partial<Record<ArchKind, ArchLane>> = {
  page: 'ui',
  component: 'ui',
  api_route: 'api',
  service: 'logic',
  repository: 'data',
  database_model: 'data',
  external_service: 'external',
  module: 'logic',
};

/** Minimal hand-built component, for rules that need an exact shape. */
function node(id: string, kind: ArchKind): ArchNode {
  return { id, key: `arch:${id}`, kind, category: 'service', lane: LANE[kind] ?? 'logic', label: id, members: [], files: [] };
}

function edge(source: string, target: string, kinds: CodeEdgeKind[], line?: number): ArchEdge {
  const e: ArchEdge = { id: `${source}->${target}`, source, target, kinds, weight: 1 };
  if (line !== undefined) e.sites = [{ file: 'a.ts', line }];
  return e;
}

/** `role Source -> Target` for every edge, sorted. */
function roles(graph: ArchGraph): string[] {
  const label = new Map(graph.nodes.map((n) => [n.id, n.label]));
  return graph.edges.map((e) => `${String(e.meta?.role)} ${label.get(e.source)} -> ${label.get(e.target)}`).sort();
}

describe('data-flow lens', () => {
  it('classifies an edge by what it does to data', () => {
    expect(dataRole(['READS_FROM'])).toBe('read');
    expect(dataRole(['WRITES_TO'])).toBe('write');
    expect(dataRole(['READS_FROM', 'WRITES_TO'])).toBe('readwrite');
    expect(dataRole(['HTTP_CALL'])).toBe('transfer');
    expect(dataRole(['PUBLISHES'])).toBe('write');
    expect(dataRole(['SUBSCRIBES'])).toBe('read');
    expect(dataRole(['CALLS'])).toBe('carry');
    // An SDK call is a network round trip even though the code graph calls it USES.
    expect(dataRole(['USES'], 'external_service')).toBe('transfer');
    expect(dataRole(['USES'], 'service')).toBe('carry');
  });

  it('reverses reads so the arrow follows the data, and leaves writes alone', () => {
    const nodes = [node('Service', 'service'), node('User', 'database_model'), node('Audit', 'database_model')];
    const edges = [edge('Service', 'User', ['READS_FROM']), edge('Service', 'Audit', ['WRITES_TO'])];
    const flow = dataFlowLens(nodes, edges);
    expect(roles(flow)).toEqual(['read User -> Service', 'write Service -> Audit']);
    // Reversing keeps the edge identity, so live updates still match it up.
    expect(flow.edges.map((e) => e.id).sort()).toEqual(['Service->Audit', 'Service->User']);
    expect(flow.edges.find((e) => e.id === 'Service->User')?.meta?.flipped).toBe(true);
    expect(flow.edges.find((e) => e.id === 'Service->Audit')?.meta?.flipped).toBe(false);
  });

  it('keeps an edge that both reads and writes pointing at the store', () => {
    const nodes = [node('Repo', 'repository'), node('Order', 'database_model')];
    const flow = dataFlowLens(nodes, [edge('Repo', 'Order', ['READS_FROM', 'WRITES_TO'])]);
    expect(roles(flow)).toEqual(['readwrite Repo -> Order']);
    expect(flow.edges[0]?.meta?.flipped).toBe(false);
  });

  it('keeps the chain from an entry point to a store, and drops what never touches data', () => {
    const nodes = [
      node('Page', 'page'),
      node('Route', 'api_route'),
      node('Service', 'service'),
      node('User', 'database_model'),
      node('StaticPage', 'page'),
      node('Formatter', 'module'),
      node('DeadService', 'service'),
    ];
    const edges = [
      edge('Page', 'Route', ['HTTP_CALL']),
      edge('Route', 'Service', ['CALLS']),
      edge('Service', 'User', ['READS_FROM']),
      // No path to a store: a static page, the helper it uses, and a dead end.
      edge('StaticPage', 'Formatter', ['CALLS']),
      edge('DeadService', 'Formatter', ['CALLS']),
    ];
    const flow = dataFlowLens(nodes, edges);
    expect(flow.nodes.map((n) => n.label).sort()).toEqual(['Page', 'Route', 'Service', 'User']);
    expect(roles(flow)).toEqual(['carry Route -> Service', 'read User -> Service', 'transfer Page -> Route']);
  });
});

describe('lenses over the fixture app', () => {
  let arch: ArchGraph;
  let label: Map<string, string>;
  beforeAll(async () => {
    arch = deriveArchitecture((await FixtureRepo.load()).index);
    label = new Map(arch.nodes.map((n) => [n.id, n.label]));
  });

  it('shows where the app reads, writes and crosses a boundary', () => {
    const flow = dataFlowLens(arch.nodes, arch.edges);
    expect(roles(flow)).toEqual(
      expect.arrayContaining([
        'read Customer -> Auth Service',
        'read Book -> CatalogService',
        'readwrite OrderRepository -> Order',
        'write OrderRepository -> OrderItem',
        'write Webhook Service -> Payment',
        'transfer OrderList -> Order API',
        'transfer RecommenderService -> OpenAI',
        'transfer CatalogService -> Algolia',
        'transfer PaymentService -> Stripe',
        'transfer BackupPaymentService -> Lemon Squeezy',
        'carry Order API -> OrderService',
      ]),
    );
    // Every network and SDK crossing is a transfer, not an in-process hand-off.
    expect(roles(flow).filter((r) => r.startsWith('transfer')).length).toBe(8);
    // The static home page and the middleware touch no data, so they drop out.
    const kept = new Set(flow.nodes.map((n) => n.label));
    expect(kept.has('Home Page')).toBe(false);
    expect(kept.has('Middleware')).toBe(false);
    expect(kept.has('Dashboard Page')).toBe(true);
    expect(kept.has('Stripe Webhook API')).toBe(true);
  });

  it('offers pages and routes as places a request can start', () => {
    const starts = entryPoints(arch.nodes, arch.edges).map((n) => `${n.kind}:${n.label}`);
    expect(starts.slice(0, 2)).toEqual(['page:Dashboard Page', 'page:Order Detail Page']);
    expect(starts).toContain('api_route:Stripe Webhook API');
    // Nothing calls out of the home page, so there is no sequence to show.
    expect(starts.some((s) => s.includes('Home Page'))).toBe(false);
  });

  it('orders a trace by where each call is written', () => {
    const entry = arch.nodes.find((n) => n.label === 'Dashboard Page')!;
    const trace = sequenceTrace(arch.nodes, arch.edges, entry.id)!;
    expect(trace.truncated).toBe(false);
    expect(trace.steps.map((s) => `${s.depth} ${label.get(s.from)} -> ${label.get(s.to)}`)).toEqual([
      '0 Dashboard Page -> OrderList',
      '1 OrderList -> Order API',
      '2 Order API -> Auth Service',
      '3 Auth Service -> Customer',
      '2 Order API -> OrderService',
      '3 OrderService -> PaymentService',
      '4 PaymentService -> Stripe',
      '3 OrderService -> BackupPaymentService',
      '4 BackupPaymentService -> Lemon Squeezy',
      '3 OrderService -> OrderRepository',
      '4 OrderRepository -> Order',
      '4 OrderRepository -> OrderItem',
      '0 Dashboard Page -> BookBrowser',
      '1 BookBrowser -> Order Checkout API',
      '2 Order Checkout API -> Auth Service',
      '2 Order Checkout API -> OrderService',
    ]);
    // Within one caller, the source line decides: route.ts:6 before route.ts:7.
    const fromRoute = trace.steps.filter((s) => label.get(s.from) === 'Order API');
    expect(fromRoute.map((s) => s.site?.line)).toEqual([6, 7]);
    // The first lifeline is the entry point, and each appears once.
    expect(trace.participants[0]).toBe(entry.id);
    expect(new Set(trace.participants).size).toBe(trace.participants.length);
    // Auth Service and OrderService were expanded under Order API already.
    expect(trace.steps.filter((s) => s.collapsed).map((s) => label.get(s.to))).toEqual(['Auth Service', 'OrderService']);
  });
});

describe('sequence trace', () => {
  it('orders calls by source line, then falls back to lane and name', () => {
    const nodes = [node('Page', 'page'), node('B', 'service'), node('C', 'service'), node('D', 'service')];
    const edges = [edge('Page', 'D', ['CALLS'], 30), edge('Page', 'B', ['CALLS'], 10), edge('Page', 'C', ['CALLS'])];
    const trace = sequenceTrace(nodes, edges, 'Page')!;
    // Edges with a call site come first, in line order; the rest sort by name.
    expect(trace.steps.map((s) => s.to)).toEqual(['B', 'D', 'C']);
  });

  it('stops at a cycle instead of looping', () => {
    const nodes = [node('A', 'service'), node('B', 'service')];
    const edges = [edge('A', 'B', ['CALLS']), edge('B', 'A', ['CALLS'])];
    const trace = sequenceTrace(nodes, edges, 'A')!;
    expect(trace.steps.map((s) => `${s.from} -> ${s.to}`)).toEqual(['A -> B']);
  });

  it('returns nothing for a component that is not on the map', () => {
    expect(sequenceTrace([node('A', 'service')], [], 'missing')).toBeNull();
  });

  it('has no steps when a component calls nothing', () => {
    const trace = sequenceTrace([node('A', 'service')], [], 'A')!;
    expect(trace.steps).toEqual([]);
    expect(trace.participants).toEqual(['A']);
  });
});

describe('system lens', () => {
  let arch: ArchGraph;
  beforeAll(async () => {
    arch = deriveArchitecture((await FixtureRepo.load()).index);
  });

  const partOf = (n: ArchNode) => n.meta?.system as SystemPart | undefined;

  it('groups every component into one box per layer and keeps external services on their own', () => {
    const sys = systemLens(arch.nodes, arch.edges);
    const boxes = sys.nodes.filter((n) => partOf(n));
    expect(boxes.map((b) => b.label).sort()).toEqual(['API', 'Data', 'Services', 'UI']);

    const grouped = boxes.flatMap((b) => partOf(b)!.members).sort();
    const standalone = sys.nodes.filter((n) => !partOf(n));
    expect(standalone.every((n) => n.kind === 'external_service' || n.meta?.missing === true)).toBe(true);
    // Every component appears exactly once: inside one box, or as itself.
    expect([...grouped, ...standalone.map((n) => n.id)].sort()).toEqual(arch.nodes.map((n) => n.id).sort());
    expect(sys.nodes.length).toBeLessThan(arch.nodes.length);
  });

  it('merges links between boxes without losing their weight or kinds', () => {
    const sys = systemLens(arch.nodes, arch.edges);
    const label = new Map(sys.nodes.map((n) => [n.id, n.label]));
    const link = (from: string, to: string) => sys.edges.find((e) => label.get(e.source) === from && label.get(e.target) === to);
    expect(link('UI', 'API')?.kinds).toContain('HTTP_CALL');
    expect(link('Services', 'Data')?.kinds).toEqual(expect.arrayContaining(['READS_FROM', 'WRITES_TO']));
    expect(sys.edges.every((e) => e.source !== e.target)).toBe(true);

    const boxOf = new Map<string, string>();
    for (const n of sys.nodes) for (const m of partOf(n)?.members ?? [n.id]) boxOf.set(m, n.id);
    const crossing = arch.edges.filter((e) => boxOf.get(e.source) !== boxOf.get(e.target)).reduce((sum, e) => sum + e.weight, 0);
    expect(sys.edges.reduce((sum, e) => sum + e.weight, 0)).toBe(crossing);
  });

  it('is deterministic and uses ids that cannot collide with components', () => {
    expect(systemLens(arch.nodes, arch.edges)).toEqual(systemLens([...arch.nodes].reverse(), [...arch.edges].reverse()));
    const sys = systemLens(arch.nodes, arch.edges);
    for (const n of sys.nodes.filter((x) => partOf(x))) expect(n.id.startsWith(SYSTEM_ID_PREFIX)).toBe(true);
  });

  it('separates the apps and packages of a monorepo and keeps missing routes visible', () => {
    const at = (id: string, kind: ArchKind, file: string, extra: Partial<ArchNode> = {}): ArchNode => ({ ...node(id, kind), files: [file], ...extra });
    const nodes = [
      at('shop-page', 'page', 'apps/shop/src/app/page.tsx'),
      at('shop-route', 'api_route', 'apps/shop/src/app/api/cart/route.ts'),
      at('admin-page', 'page', 'apps/admin/src/app/page.tsx'),
      at('mailer', 'service', 'packages/mail/src/index.ts'),
      { ...node('missing', 'api_route'), meta: { missing: true } },
    ];
    const edges = [edge('shop-page', 'shop-route', ['HTTP_CALL']), edge('shop-page', 'missing', ['HTTP_CALL']), edge('shop-route', 'mailer', ['CALLS'])];
    const sys = systemLens(nodes, edges);
    const labels = sys.nodes.map((n) => n.label).sort();
    // A scope with one layer is named after the scope alone.
    expect(labels).toEqual(['Admin', 'Mail', 'Shop API', 'Shop UI', 'missing']);
    const label = new Map(sys.nodes.map((n) => [n.id, n.label]));
    expect(sys.edges.map((e) => `${label.get(e.source)} -> ${label.get(e.target)}`).sort()).toEqual(['Shop API -> Mail', 'Shop UI -> Shop API', 'Shop UI -> missing']);
  });
});
