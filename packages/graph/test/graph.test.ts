import { beforeEach, describe, expect, it } from 'vitest';
import { FixtureRepo } from './fixture.js';

const R = 'src/services/order.service.ts';

describe('code graph: full build', () => {
  let repo: FixtureRepo;
  beforeEach(async () => {
    repo = await FixtureRepo.load();
  });

  it('resolves calls through imports, instances, aliases and this-fields', () => {
    const edges = repo.edgeStrings();
    expect(edges).toContain('CALLS src/app/api/order/checkout/route.ts#POST -> src/services/order.service.ts#OrderService.checkout');
    expect(edges).toContain('CALLS src/services/order.service.ts#OrderService.checkout -> src/services/payment.service.ts#PaymentService.charge');
    expect(edges).toContain('CALLS src/services/order.service.ts#OrderService.checkout -> src/repositories/order.repository.ts#OrderRepository.save');
    expect(edges).toContain('CALLS src/services/order.service.ts#OrderService.checkout -> src/lib/summary.ts#buildOrderSummary');
    expect(edges).toContain('CALLS src/app/api/order/[id]/route.ts#GET -> src/repositories/order.repository.ts#OrderRepository.findById');
    expect(edges).toContain('CALLS src/services/auth.service.ts#requireCustomer -> src/services/auth.service.ts#getSession');
  });

  it('links route nodes to handlers and frontend fetches to routes', () => {
    const edges = repo.edgeStrings();
    expect(edges).toContain('CALLS api_route:POST /api/order/checkout -> src/app/api/order/checkout/route.ts#POST');
    expect(edges).toContain('HTTP_CALL src/components/book/BookBrowser.tsx#BookBrowser -> api_route:POST /api/order/checkout');
    expect(edges).toContain('HTTP_CALL src/components/order/OrderViewer.tsx#OrderViewer -> api_route:GET /api/order/:id');
    expect(edges).toContain('HTTP_CALL src/hooks/useOrders.ts#useOrders -> api_route:GET /api/order');
  });

  it('detects database reads/writes and external services', () => {
    const edges = repo.edgeStrings();
    expect(edges).toContain('WRITES_TO src/repositories/order.repository.ts#OrderRepository.save -> database_model:Order');
    expect(edges).toContain('WRITES_TO src/repositories/order.repository.ts#OrderRepository.save -> database_model:OrderItem');
    expect(edges).toContain('READS_FROM src/services/auth.service.ts#getSession -> database_model:Customer');
    expect(edges).toContain('READS_FROM src/services/catalog.service.ts#CatalogService.browse -> database_model:Book');
    expect(edges).toContain('USES src/services/recommender.service.ts#RecommenderService.suggest -> external_service:OpenAI');
    expect(edges).toContain('USES src/services/catalog.service.ts#CatalogService.find -> external_service:Algolia');
    expect(edges).toContain('USES src/services/webhook.service.ts#webhookService.handleWebhook -> external_service:Stripe');
  });

  it('marks Next.js middleware and resolves next/dynamic imports', () => {
    const mw = [...repo.index.store.nodes()].find((n) => n.file === 'src/middleware.ts' && n.name === 'middleware');
    expect(mw?.kind).toBe('middleware');
    expect(repo.edgeStrings()).toContain('USES src/app/order/[id]/page.tsx#OrderPage -> src/components/order/OrderViewer.tsx#OrderViewer');
  });
});

describe('code graph: incremental updates', () => {
  let repo: FixtureRepo;
  beforeEach(async () => {
    repo = await FixtureRepo.load();
  });

  it('keeps ids stable and only re-resolves the edited file for body-only edits', async () => {
    const before = new Set([...repo.index.store.nodes()].map((n) => n.id));
    const src = repo.files.get(R)!;
    const result = await repo.write(R, `// a new leading comment\n\n${src.replace('return this.repo.findByCustomer(customerId);', 'const all = await this.repo.findByCustomer(customerId);\n    return all;')}`);
    expect(result.reresolved).toEqual([R]);
    expect(result.diff.addedNodes).toHaveLength(0);
    expect(result.diff.removedNodes).toHaveLength(0);
    expect(result.diff.updatedNodes.length).toBeGreaterThan(0);
    expect(new Set([...repo.index.store.nodes()].map((n) => n.id))).toEqual(before);
  });

  it('adds a new service and its dependency edges (the Shipping demo)', async () => {
    await repo.write(
      'src/services/shipping.service.ts',
      `import { PaymentService } from './payment.service';\n\n/** Prices delivery for an order. */\nexport class ShippingService {\n  private payments = new PaymentService();\n  async quote(weightGrams: number) {\n    return this.payments.charge(weightGrams);\n  }\n}\n`,
    );
    const src = repo.files.get(R)!;
    const result = await repo.write(
      R,
      src
        .replace("import { buildOrderSummary } from '@/lib/summary';", "import { buildOrderSummary } from '@/lib/summary';\nimport { ShippingService } from './shipping.service';")
        .replace('const reference = await this.payments.charge(totalCents);', 'await new ShippingService().quote(totalCents);\n    const reference = await this.payments.charge(totalCents);'),
    );
    const edges = repo.edgeStrings();
    expect(edges).toContain('CALLS src/services/shipping.service.ts#ShippingService.quote -> src/services/payment.service.ts#PaymentService.charge');
    expect(edges).toContain('CALLS src/services/order.service.ts#OrderService.checkout -> src/services/shipping.service.ts#ShippingService');
    expect(result.diff.addedEdges.some((e) => repo.name(e.target) === 'src/services/shipping.service.ts#ShippingService')).toBe(true);
  });

  it('invalidates dependents when an export changes and restores them when it comes back', async () => {
    const path = 'src/repositories/order.repository.ts';
    const original = repo.files.get(path)!;
    const result = await repo.write(path, original.replace('async save(', 'async persist('));
    expect(result.reresolved).toContain(R);
    expect(repo.edgeStrings()).not.toContain('CALLS src/services/order.service.ts#OrderService.checkout -> src/repositories/order.repository.ts#OrderRepository.save');
    // Falls back to the class with lower confidence.
    expect(repo.edgeStrings()).toContain('CALLS src/services/order.service.ts#OrderService.checkout -> src/repositories/order.repository.ts#OrderRepository');

    await repo.write(path, original);
    expect(repo.edgeStrings()).toContain('CALLS src/services/order.service.ts#OrderService.checkout -> src/repositories/order.repository.ts#OrderRepository.save');
  });

  it('handles deleting and re-adding a file', async () => {
    const path = 'src/services/payment.service.ts';
    const content = repo.files.get(path)!;
    const removed = await repo.remove(path);
    expect(removed.diff.removedNodes.length).toBeGreaterThan(0);
    expect(repo.edgeStrings().some((e) => e.includes('payment.service.ts'))).toBe(false);
    // Stripe is no longer charged from the service layer, only from the webhook handler.
    expect(repo.edgeStrings()).not.toContain('USES src/services/payment.service.ts#PaymentService.charge -> external_service:Stripe');

    await repo.write(path, content);
    expect(repo.edgeStrings()).toContain('CALLS src/services/order.service.ts#OrderService.checkout -> src/services/payment.service.ts#PaymentService.charge');
  });

  it('flags calls to missing API routes and re-links them when the route appears', async () => {
    const browser = 'src/components/book/BookBrowser.tsx';
    await repo.write(browser, repo.files.get(browser)!.replace("'/api/order/checkout'", "'/api/basket/pay'"));
    expect(repo.edgeStrings()).toContain('HTTP_CALL src/components/book/BookBrowser.tsx#BookBrowser -> api_route:POST /api/basket/pay');
    const missing = [...repo.index.store.nodes()].find((n) => n.kind === 'api_route' && n.meta?.missing);
    expect(missing).toBeDefined();

    await repo.write('src/app/api/basket/pay/route.ts', 'export async function POST() {\n  return Response.json({ ok: true });\n}\n');
    expect(repo.index.store.getNode(missing!.id)).toBeUndefined();
    const route = [...repo.index.store.nodes()].find((n) => n.kind === 'api_route' && n.name === 'POST /api/basket/pay' && n.file);
    expect(route).toBeDefined();
    expect(repo.edgeStrings()).toContain('HTTP_CALL src/components/book/BookBrowser.tsx#BookBrowser -> api_route:POST /api/basket/pay');
  });
});

describe('external services by URL', () => {
  it('maps API hosts in fetch calls to known providers', async () => {
    const { providerForUrl } = await import('../src/index.js');
    expect(providerForUrl('https://api.stripe.com:param')?.label).toBe('Stripe');
    expect(providerForUrl('https://api.github.com/repos/:param')?.label).toBe('GitHub API');
    expect(providerForUrl('https://:param/v1')).toBeNull();
  });
});
