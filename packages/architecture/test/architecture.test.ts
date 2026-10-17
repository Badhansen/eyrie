import { beforeEach, describe, expect, it } from 'vitest';
import type { ArchGraph } from '@eyrie/core';
import { FixtureRepo, memoryIndex } from '@eyrie/graph/testing';
import { deriveArchitecture } from '../src/index.js';

function readable(graph: ArchGraph) {
  const label = new Map(graph.nodes.map((n) => [n.id, n.label]));
  return {
    nodes: graph.nodes.map((n) => `${n.lane}:${n.label}`).sort(),
    edges: graph.edges.map((e) => `${label.get(e.source)} -> ${label.get(e.target)}`).sort(),
  };
}

describe('architecture derivation', () => {
  let repo: FixtureRepo;
  beforeEach(async () => {
    repo = await FixtureRepo.load();
  });

  it('reduces the code graph to meaningful components', () => {
    const arch = deriveArchitecture(repo.index);
    const { nodes, edges } = readable(arch);
    expect(nodes).toEqual([
      'api:Auth Session API',
      'api:Book API',
      'api:Book Recommend API',
      'api:Order API',
      'api:Order Checkout API',
      'api:Order Detail API',
      'api:Stripe Webhook API',
      'data:Book',
      'data:Customer',
      'data:Order',
      'data:OrderItem',
      'data:OrderRepository',
      'data:Payment',
      'edge:Middleware',
      'external:Algolia',
      'external:Lemon Squeezy',
      'external:OpenAI',
      'external:Stripe',
      'logic:Auth Service',
      'logic:BackupPaymentService',
      'logic:CatalogService',
      'logic:OrderService',
      'logic:PaymentService',
      'logic:RecommenderService',
      'logic:Webhook Service',
      'ui:BookBrowser',
      'ui:Dashboard Page',
      'ui:Home Page',
      'ui:Order Detail Page',
      'ui:OrderList',
      'ui:OrderViewer',
    ]);
    // Presentational components, hooks, utilities and SDK client wrappers are folded away.
    expect(nodes.some((n) => /Button|useOrders|Format|Prompt|Summary|Prisma/.test(n))).toBe(false);
    expect(edges).toEqual(
      expect.arrayContaining([
        'Dashboard Page -> BookBrowser',
        'BookBrowser -> Order Checkout API',
        'OrderList -> Order API',
        'Order Checkout API -> OrderService',
        'Order Checkout API -> Auth Service',
        'OrderService -> PaymentService',
        'OrderService -> BackupPaymentService',
        'OrderService -> OrderRepository',
        'PaymentService -> Stripe',
        'BackupPaymentService -> Lemon Squeezy',
        'OrderRepository -> Order',
        'OrderRepository -> OrderItem',
        'CatalogService -> Algolia',
        'RecommenderService -> OpenAI',
        'Stripe Webhook API -> Webhook Service',
        'Webhook Service -> Stripe',
        'Webhook Service -> Payment',
      ]),
    );
  });

  it('colors AI services and records pass-through hops', () => {
    const arch = deriveArchitecture(repo.index);
    expect(arch.nodes.find((n) => n.label === 'RecommenderService')?.category).toBe('ai');
    const list = arch.nodes.find((n) => n.label === 'OrderList')!;
    const api = arch.nodes.find((n) => n.label === 'Order API')!;
    const edge = arch.edges.find((e) => e.source === list.id && e.target === api.id)!;
    expect(edge.kinds).toEqual(['HTTP_CALL']);
    expect(edge.via).toEqual(['useOrders']);
  });

  it('uses doc comments as component summaries', () => {
    const arch = deriveArchitecture(repo.index);
    expect(arch.nodes.find((n) => n.label === 'Order Checkout API')?.summary).toBe('Charges the basket and records the order.');
    expect(arch.nodes.find((n) => n.label === 'OpenAI')?.summary).toBe('AI provider (OpenAI). Used by RecommenderService.');
  });

  it('keeps architecture ids stable and shows a new service after an edit', async () => {
    const before = deriveArchitecture(repo.index);
    await repo.write(
      'src/services/gift.service.ts',
      `import { RecommenderService } from './recommender.service';\nexport class GiftService {\n  private recommender = new RecommenderService();\n  suggest(customerId: string) { return this.recommender.suggest(customerId); }\n}\n`,
    );
    const r = 'src/services/order.service.ts';
    await repo.write(
      r,
      repo.files
        .get(r)!
        .replace("import { PaymentService } from './payment.service';", "import { PaymentService } from './payment.service';\nimport { GiftService } from './gift.service';")
        .replace('const reference', 'new GiftService().suggest(customerId);\n    const reference'),
    );
    const after = deriveArchitecture(repo.index);
    const beforeIds = new Set(before.nodes.map((n) => n.id));
    const added = after.nodes.filter((n) => !beforeIds.has(n.id)).map((n) => n.label);
    expect(added).toEqual(['GiftService']);
    expect(readable(after).edges).toEqual(expect.arrayContaining(['OrderService -> GiftService', 'GiftService -> RecommenderService']));
  });
});

describe('architecture heuristics beyond Next.js apps', () => {
  const labels = (g: ArchGraph) => g.nodes.map((n) => n.label).sort();

  it('hides tests, fixtures and barrels', async () => {
    const index = await memoryIndex({
      'src/services/billing.service.ts': `import { prisma } from '../db';\nexport class BillingService { charge() { return prisma.invoice.create({ data: {} }); } }\n`,
      'src/db.ts': `import { PrismaClient } from '@prisma/client';\nexport const prisma = new PrismaClient();\n`,
      'src/index.ts': `export * from './services/billing.service';\n`,
      'src/services/billing.service.test.ts': `import { BillingService } from './billing.service';\nnew BillingService().charge();\n`,
      'test/fixtures/fake.service.ts': `export class FakeService { run() {} }\n`,
    });
    expect(labels(deriveArchitecture(index))).toEqual(['BillingService', 'Invoice']);
  });

  it('shows shared helpers used by many components instead of fanning out edges', async () => {
    const index = await memoryIndex({
      'src/api/client.ts': `export function request(path: string) { return fetch('https://api.github.com' + path); }\n`,
      'src/components/A.tsx': `import { request } from '../api/client';\nexport function A() { request('/a'); return <div/>; }\n`,
      'src/components/B.tsx': `import { request } from '../api/client';\nexport function B() { request('/b'); return <div/>; }\n`,
      'src/components/C.tsx': `import { request } from '../api/client';\nexport function C() { request('/c'); return <div/>; }\n`,
    });
    const arch = deriveArchitecture(index);
    expect(labels(arch)).toEqual(['A', 'B', 'C', 'Client', 'GitHub API']);
    const client = arch.nodes.find((n) => n.label === 'Client')!;
    expect(arch.edges.filter((e) => e.target === client.id)).toHaveLength(3);
  });

  it('falls back to modules on dependency paths for libraries', async () => {
    const index = await memoryIndex({
      'src/cli.ts': `import { run } from './runner';\nrun();\n`,
      'src/runner.ts': `import { parse } from './parser';\nimport { emit } from './emitter';\nexport function run() { emit(parse('x')); }\n`,
      'src/parser.ts': `import { tokenize } from './lexer';\nexport function parse(s: string) { return tokenize(s); }\n`,
      'src/lexer.ts': `export function tokenize(s: string) { return s.split(''); }\n`,
      'src/emitter.ts': `import { format } from './format';\nexport function emit(x: unknown) { return format(x); }\n`,
      'src/format.ts': `export function format(x: unknown) { return String(x); }\n`,
      'src/types.ts': `export interface Token { value: string }\n`,
    });
    const arch = deriveArchitecture(index);
    expect(labels(arch)).toEqual(['Emitter', 'Parser', 'Runner']);
  });

  it('does not invent missing routes in apps without detectable routing', async () => {
    const index = await memoryIndex({
      'web/src/App.tsx': `export function App() { fetch('/api/state'); return <div/>; }\n`,
    });
    expect([...index.store.nodes()].some((n) => n.kind === 'api_route')).toBe(false);
  });
});
