import { describe, expect, it } from 'vitest';
import type { ArchEdge, ArchNode } from '@eyrie/core';
import { archPath, focusSet, impactOf, matches } from '../src/index.js';

const edge = (source: string, target: string): ArchEdge => ({ id: `${source}>${target}`, source, target, kinds: ['CALLS'], weight: 1 });
const node = (id: string, kind: ArchNode['kind'], lane: ArchNode['lane']): ArchNode => ({ id, key: id, kind, lane, category: 'service', label: id.toUpperCase(), members: [], files: [`src/${id}.ts`] });

// page → api → svc → repo → db, and svc → stripe
const edges = [edge('page', 'api'), edge('api', 'svc'), edge('svc', 'repo'), edge('repo', 'db'), edge('svc', 'stripe')];
const nodes = new Map(
  [node('page', 'page', 'ui'), node('api', 'api_route', 'api'), node('svc', 'service', 'logic'), node('repo', 'repository', 'data'), node('db', 'database_model', 'data'), node('stripe', 'external_service', 'external')].map((n) => [n.id, n]),
);

describe('focusSet and impactOf', () => {
  it('walks downstream and upstream with depth from the selection', () => {
    const down = focusSet(edges, 'svc', 'downstream');
    expect(Object.fromEntries(down.depth)).toEqual({ svc: 0, repo: 1, stripe: 1, db: 2 });
    const up = focusSet(edges, 'svc', 'upstream');
    expect(Object.fromEntries(up.depth)).toEqual({ svc: 0, api: 1, page: 2 });
    expect(focusSet(edges, 'svc', 'neighbors').nodes).toEqual(new Set(['svc', 'api', 'repo', 'stripe']));
  });

  it('summarises a closure by kind of component', () => {
    expect(impactOf(nodes, focusSet(edges, 'svc', 'downstream'))).toEqual({ direct: 2, indirect: 1, apis: [], ui: [], services: [], data: ['REPO', 'DB'], external: ['STRIPE'] });
    expect(impactOf(nodes, focusSet(edges, 'db', 'upstream'))).toMatchObject({ direct: 1, indirect: 3, apis: ['API'], ui: ['PAGE'] });
  });
});

describe('archPath', () => {
  it('returns the shortest chain in the edges’ direction', () => {
    const path = archPath([...edges, edge('page', 'svc')], 'page', 'db')!;
    expect(path.nodes).toEqual(['page', 'svc', 'repo', 'db']);
    expect(path.edges.map((e) => e.id)).toEqual(['page>svc', 'svc>repo', 'repo>db']);
  });

  it('is null against the direction or between unrelated components, and trivial from a component to itself', () => {
    expect(archPath(edges, 'db', 'page')).toBeNull();
    expect(archPath(edges, 'stripe', 'db')).toBeNull();
    expect(archPath(edges, 'api', 'api')).toEqual({ nodes: ['api'], edges: [] });
  });
});

describe('matches', () => {
  it('matches label, file and domain, ignoring case, and never an empty query', () => {
    const n = { ...node('svc', 'service', 'logic'), domain: 'orders' };
    expect(matches(n, 'sv')).toBe(true);
    expect(matches(n, 'SRC/SVC')).toBe(true);
    expect(matches(n, 'Orders')).toBe(true);
    expect(matches(n, '  ')).toBe(false);
  });
});
