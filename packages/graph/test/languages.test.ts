import { describe, expect, it } from 'vitest';
import { emptyProjectConfig, type GraphIndex, type ProjectConfig } from '../src/index.js';
import { describeNode, memoryIndex } from './fixture.js';

/** Non-structural edges as readable strings, plus IMPORTS (useful across languages). */
function edges(index: GraphIndex): string[] {
  const name = (id: string) => {
    const n = index.store.getNode(id);
    return n ? describeNode(n) : `?${id}`;
  };
  return [...index.store.edges()]
    .filter((e) => e.kind !== 'CONTAINS' && e.kind !== 'EXPORTS')
    .map((e) => `${e.kind} ${name(e.source)} -> ${name(e.target)}`)
    .sort();
}

const build = (files: Record<string, string>, config: Partial<ProjectConfig> = {}) => memoryIndex(files, { ...emptyProjectConfig(), ...config });

describe('Python', () => {
  const files = {
    'app/__init__.py': '',
    'app/models.py': `from django.db import models\n\nclass Customer(models.Model):\n    name = models.CharField(max_length=80)\n\nclass Order(models.Model):\n    """A placed order."""\n    customer = models.ForeignKey("Customer", on_delete=models.CASCADE)\n    total = models.IntegerField()\n`,
    'app/repositories/__init__.py': '',
    'app/repositories/order_repository.py': `from app.models import Order\n\nclass OrderRepository:\n    def find(self, order_id: int) -> Order:\n        return Order.objects.get(id=order_id)\n\n    def save(self, order: Order) -> None:\n        order.save()\n`,
    'app/services/__init__.py': `from .order_service import OrderService\n`,
    'app/services/order_service.py': `import stripe\nimport requests\nfrom openai import OpenAI\nfrom app.repositories.order_repository import OrderRepository\n\nclass OrderService:\n    """Checks out orders."""\n    def __init__(self, repo: OrderRepository):\n        self.repo = repo\n        self.ai = OpenAI()\n\n    def checkout(self, order_id: int):\n        order = self.repo.find(order_id)\n        stripe.Charge.create(amount=order.total)\n        self.ai.chat.completions.create(model="gpt")\n        requests.get("https://api.github.com/repos/acme/shop")\n        return order\n`,
    'app/api.py': `from fastapi import APIRouter\nfrom app.services import OrderService\nfrom app.repositories.order_repository import OrderRepository\n\nrouter = APIRouter(prefix="/api/orders")\n\n@router.post("/{order_id}/checkout")\ndef checkout(order_id: int):\n    svc = OrderService(OrderRepository())\n    return svc.checkout(order_id)\n`,
  };

  it('resolves modules, packages, self fields, routes, models and SDKs', async () => {
    const e = edges(await build(files));
    expect(e).toContain('CALLS api_route:POST /api/orders/:order_id/checkout -> app/api.py#checkout');
    expect(e).toContain('CALLS app/api.py#checkout -> app/services/order_service.py#OrderService.checkout');
    expect(e).toContain('CALLS app/services/order_service.py#OrderService.checkout -> app/repositories/order_repository.py#OrderRepository.find');
    expect(e).toContain('READS_FROM app/repositories/order_repository.py#OrderRepository.find -> database_model:Order');
    expect(e).toContain('WRITES_TO app/repositories/order_repository.py#OrderRepository.save -> database_model:Order');
    expect(e).toContain('USES app/services/order_service.py#OrderService.checkout -> external_service:Stripe');
    expect(e).toContain('USES app/services/order_service.py#OrderService.checkout -> external_service:OpenAI');
    expect(e).toContain('HTTP_CALL app/services/order_service.py#OrderService.checkout -> external_service:GitHub API');
    expect(e).toContain('DEPENDS_ON database_model:Order -> database_model:Customer');
    expect(e).toContain('IMPORTS app/services/__init__.py -> app/services/order_service.py');
    expect(e).toContain('IMPORTS app/api.py -> app/services/__init__.py');
  });

  it('resolves relative imports, from-package submodules and Flask blueprints', async () => {
    const e = edges(
      await build({
        'shop/__init__.py': '',
        'shop/billing/__init__.py': '',
        'shop/billing/invoices.py': `def render(order):\n    return str(order)\n`,
        'shop/views.py': `from flask import Blueprint\nfrom .billing import invoices\nfrom . import billing\n\nbp = Blueprint("shop", __name__, url_prefix="/shop")\n\n@bp.route("/invoice/<int:id>", methods=["GET", "POST"])\ndef invoice(id):\n    return invoices.render(id)\n`,
      }),
    );
    expect(e).toContain('CALLS shop/views.py#invoice -> shop/billing/invoices.py#render');
    expect(e).toContain('CALLS api_route:GET /shop/invoice/:id -> shop/views.py#invoice');
    expect(e).toContain('CALLS api_route:POST /shop/invoice/:id -> shop/views.py#invoice');
    expect(e).toContain('IMPORTS shop/views.py -> shop/billing/invoices.py');
  });
});

describe('Go', () => {
  const files = {
    'internal/store/repository.go': `package store\n\n// Repository loads orders.\ntype Repository struct{}\n\nfunc (r *Repository) Find(id string) *Order { return nil }\n`,
    'internal/store/order.go': `package store\n\nimport "gorm.io/gorm"\n\ntype Order struct {\n\tgorm.Model\n\tCustomer Customer\n}\n\ntype Customer struct {\n\tgorm.Model\n}\n\nfunc (r *Repository) Save(o *Order) error { return nil }\n`,
    'internal/order/service.go': `package order\n\nimport (\n\t"github.com/acme/shop/internal/store"\n\t"github.com/stripe/stripe-go/v76/charge"\n)\n\ntype Service struct {\n\trepo *store.Repository\n}\n\nfunc NewService(r *store.Repository) *Service { return &Service{repo: r} }\n\n// Checkout charges and saves an order.\nfunc (s *Service) Checkout(id string) error {\n\to := s.repo.Find(id)\n\tcharge.New(nil)\n\ts.repo.Save(o)\n\treturn validate(o)\n}\n`,
    'internal/order/validate.go': `package order\n\nfunc validate(o any) error { return nil }\n`,
    'cmd/api/main.go': `package main\n\nimport (\n\t"net/http"\n\n\t"github.com/acme/shop/internal/order"\n\t"github.com/acme/shop/internal/store"\n)\n\nfunc main() {\n\tsvc := order.NewService(&store.Repository{})\n\thttp.HandleFunc("POST /orders/{id}/checkout", checkout)\n\tsvc.Checkout("1")\n}\n\nfunc checkout(w http.ResponseWriter, r *http.Request) {}\n`,
  };
  const config = { goModules: [{ dir: '', path: 'github.com/acme/shop' }] };

  it('resolves packages as directories, receivers, same-package calls and routes', async () => {
    const e = edges(await build(files, config));
    expect(e).toContain('CALLS cmd/api/main.go#main -> internal/order/service.go#NewService');
    expect(e).toContain('CALLS cmd/api/main.go#main -> internal/order/service.go#Service.Checkout');
    expect(e).toContain('CALLS internal/order/service.go#Service.Checkout -> internal/store/repository.go#Repository.Find');
    // A method declared in a different file of the receiver's package.
    expect(e).toContain('CALLS internal/order/service.go#Service.Checkout -> internal/store/order.go#Repository.Save');
    expect(e).toContain('CALLS internal/order/service.go#Service.Checkout -> internal/order/validate.go#validate');
    expect(e).toContain('USES internal/order/service.go#Service.Checkout -> external_service:Stripe');
    expect(e).toContain('CALLS api_route:POST /orders/:id/checkout -> cmd/api/main.go#checkout');
    expect(e).toContain('IMPORTS cmd/api/main.go -> internal/order/service.go');
    expect(e).not.toContain('IMPORTS cmd/api/main.go -> internal/order/validate.go');
    expect(e).toContain('DEPENDS_ON database_model:Order -> database_model:Customer');
  });

  it('falls back to directory suffixes without go.mod', async () => {
    const e = edges(await build(files));
    expect(e).toContain('CALLS cmd/api/main.go#main -> internal/order/service.go#NewService');
  });
});

describe('Java', () => {
  const base = 'src/main/java/com/acme/shop';
  const files = {
    [`${base}/order/Order.java`]: `package com.acme.shop.order;\n\nimport jakarta.persistence.*;\n\n@Entity\npublic class Order {\n  @Id private Long id;\n  @ManyToOne private Customer customer;\n}\n`,
    [`${base}/order/Customer.java`]: `package com.acme.shop.order;\n\n@Entity\npublic class Customer { @Id private Long id; }\n`,
    [`${base}/order/OrderRepository.java`]: `package com.acme.shop.order;\n\npublic interface OrderRepository extends JpaRepository<Order, Long> {\n  Order findByRef(String ref);\n}\n`,
    [`${base}/order/OrderService.java`]: `package com.acme.shop.order;\n\nimport com.acme.shop.payment.PaymentGateway;\n\n/** Checks out orders. */\n@Service\npublic class OrderService {\n  private final OrderRepository repo;\n  private final PaymentGateway payments;\n\n  public OrderService(OrderRepository repo, PaymentGateway payments) {\n    this.repo = repo;\n    this.payments = payments;\n  }\n\n  public Order checkout(String ref) {\n    Order o = repo.findByRef(ref);\n    payments.charge(o);\n    return o;\n  }\n}\n`,
    [`${base}/payment/PaymentGateway.java`]: `package com.acme.shop.payment;\n\nimport com.stripe.model.Charge;\n\npublic class PaymentGateway {\n  public void charge(Object o) {\n    Charge.create(null);\n  }\n}\n`,
    [`${base}/web/OrderController.java`]: `package com.acme.shop.web;\n\nimport com.acme.shop.order.*;\n\n@RestController\n@RequestMapping("/api/orders")\npublic class OrderController {\n  private final OrderService service;\n\n  public OrderController(OrderService service) { this.service = service; }\n\n  @PostMapping("/{ref}/checkout")\n  public Order checkout(@PathVariable String ref) {\n    return service.checkout(ref);\n  }\n}\n`,
  };

  it('resolves packages, wildcard imports, implicit this, Spring routes and JPA entities', async () => {
    const e = edges(await build(files));
    const c = (s: string) => `${base}/${s}`;
    expect(e).toContain(`CALLS api_route:POST /api/orders/:ref/checkout -> ${c('web/OrderController.java')}#OrderController.checkout`);
    expect(e).toContain(`CALLS ${c('web/OrderController.java')}#OrderController.checkout -> ${c('order/OrderService.java')}#OrderService.checkout`);
    expect(e).toContain(`CALLS ${c('order/OrderService.java')}#OrderService.checkout -> ${c('order/OrderRepository.java')}#OrderRepository.findByRef`);
    expect(e).toContain(`CALLS ${c('order/OrderService.java')}#OrderService.checkout -> ${c('payment/PaymentGateway.java')}#PaymentGateway.charge`);
    expect(e).toContain(`USES ${c('payment/PaymentGateway.java')}#PaymentGateway.charge -> external_service:Stripe`);
    expect(e).toContain('DEPENDS_ON database_model:Order -> database_model:Customer');
    expect(e).toContain(`IMPORTS ${c('web/OrderController.java')} -> ${c('order/OrderService.java')}`);
    expect(e).toContain(`IMPORTS ${c('order/OrderService.java')} -> ${c('payment/PaymentGateway.java')}`);
  });
});

describe('C#', () => {
  const files = {
    'Models/Order.cs': `namespace Shop.Models;\n\npublic class Order { public int Id { get; set; } }\n`,
    'Data/AppDbContext.cs': `using Microsoft.EntityFrameworkCore;\nusing Shop.Models;\n\nnamespace Shop.Data;\n\npublic class AppDbContext : DbContext\n{\n    public DbSet<Order> Orders { get; set; }\n}\n`,
    'Services/IOrderService.cs': `using Shop.Models;\n\nnamespace Shop.Services;\n\npublic interface IOrderService { Task<Order> CheckoutAsync(int id); }\n`,
    'Services/OrderService.cs': `using System;\nusing Shop.Data;\nusing Shop.Models;\nusing Stripe;\n\nnamespace Shop.Services;\n\npublic class OrderService : IOrderService\n{\n    private readonly AppDbContext _db;\n    public OrderService(AppDbContext db) { _db = db; }\n\n    public async Task<Order> CheckoutAsync(int id)\n    {\n        var order = await _db.Orders.FindAsync(id);\n        _db.Orders.Add(order);\n        var items = new List<int>();\n        await new ChargeService().CreateAsync(null);\n        return order;\n    }\n}\n`,
    'Controllers/OrdersController.cs': `using Microsoft.AspNetCore.Mvc;\nusing Shop.Services;\n\nnamespace Shop.Controllers;\n\n[ApiController]\n[Route("api/[controller]")]\npublic class OrdersController : ControllerBase\n{\n    private readonly IOrderService _orders;\n    public OrdersController(IOrderService orders) { _orders = orders; }\n\n    [HttpPost("{id}/checkout")]\n    public Task<Order> Checkout(int id) => _orders.CheckoutAsync(id);\n}\n`,
  };

  it('resolves namespaces, DI fields, ASP.NET routes and EF Core DbSets', async () => {
    const e = edges(await build(files));
    expect(e).toContain('CALLS api_route:POST /api/orders/:id/checkout -> Controllers/OrdersController.cs#OrdersController.Checkout');
    expect(e).toContain('CALLS Controllers/OrdersController.cs#OrdersController.Checkout -> Services/IOrderService.cs#IOrderService.CheckoutAsync');
    expect(e).toContain('IMPLEMENTS Services/OrderService.cs#OrderService -> Services/IOrderService.cs#IOrderService');
    expect(e).toContain('READS_FROM Services/OrderService.cs#OrderService.CheckoutAsync -> database_model:Order');
    expect(e).toContain('WRITES_TO Services/OrderService.cs#OrderService.CheckoutAsync -> database_model:Order');
    expect(e).toContain('USES Services/OrderService.cs -> external_service:Stripe');
    // `using Stripe;` must not claim every unknown name.
    expect(e.filter((x) => x.startsWith('USES Services/OrderService.cs#') && x.endsWith('external_service:Stripe'))).toEqual([]);
    expect(e).toContain('IMPORTS Controllers/OrdersController.cs -> Services/IOrderService.cs');
    expect(e).toContain('IMPORTS Services/OrderService.cs -> Data/AppDbContext.cs');
  });
});

describe('PHP', () => {
  const files = {
    'app/Models/Order.php': `<?php\nnamespace App\\Models;\n\nuse Illuminate\\Database\\Eloquent\\Model;\n\nclass Order extends Model\n{\n    public function customer() { return $this->belongsTo(Customer::class); }\n}\n`,
    'app/Models/Customer.php': `<?php\nnamespace App\\Models;\n\nuse Illuminate\\Database\\Eloquent\\Model;\n\nclass Customer extends Model {}\n`,
    'app/Services/OrderService.php': `<?php\nnamespace App\\Services;\n\nuse App\\Models\\Order;\nuse Stripe\\StripeClient;\n\nclass OrderService\n{\n    public function __construct(private StripeClient $stripe) {}\n\n    public function checkout(int $id): Order\n    {\n        $order = Order::findOrFail($id);\n        $this->stripe->charges->create([]);\n        $copy = new Order();\n        $copy->save();\n        return $order;\n    }\n}\n`,
    'app/Http/Controllers/OrderController.php': `<?php\nnamespace App\\Http\\Controllers;\n\nuse App\\Services\\OrderService;\n\nclass OrderController extends Controller\n{\n    public function __construct(private OrderService $orders) {}\n\n    public function checkout(int $id) { return $this->orders->checkout($id); }\n}\n`,
    'routes/api.php': `<?php\nuse App\\Http\\Controllers\\OrderController;\nuse Illuminate\\Support\\Facades\\Route;\n\nRoute::post('/orders/{id}/checkout', [OrderController::class, 'checkout']);\n`,
  };

  it('resolves namespaces, promoted properties, Laravel routes and Eloquent models', async () => {
    const e = edges(await build(files));
    expect(e).toContain('CALLS api_route:POST /api/orders/:id/checkout -> app/Http/Controllers/OrderController.php#OrderController.checkout');
    expect(e).toContain('CALLS app/Http/Controllers/OrderController.php#OrderController.checkout -> app/Services/OrderService.php#OrderService.checkout');
    expect(e).toContain('READS_FROM app/Services/OrderService.php#OrderService.checkout -> database_model:Order');
    expect(e).toContain('WRITES_TO app/Services/OrderService.php#OrderService.checkout -> database_model:Order');
    expect(e).toContain('USES app/Services/OrderService.php#OrderService.checkout -> external_service:Stripe');
    expect(e).toContain('DEPENDS_ON database_model:Order -> database_model:Customer');
    expect(e).toContain('IMPORTS routes/api.php -> app/Http/Controllers/OrderController.php');
  });
});

describe('Ruby', () => {
  const files = {
    'app/models/order.rb': `class Order < ApplicationRecord\n  belongs_to :customer\nend\n`,
    'app/models/customer.rb': `class Customer < ApplicationRecord\n  has_many :orders\nend\n`,
    'app/services/payment_gateway.rb': `require "stripe"\n\nclass PaymentGateway\n  def charge(order)\n    Stripe::Charge.create(amount: 100)\n  end\nend\n`,
    'app/services/checkout_service.rb': `# Charges and confirms an order.\nclass CheckoutService\n  def initialize(gateway = PaymentGateway.new)\n    @gateway = gateway\n  end\n\n  def call(id)\n    order = Order.find(id)\n    @gateway.charge(order)\n    order\n  end\nend\n`,
    'app/controllers/orders_controller.rb': `class OrdersController < ApplicationController\n  def checkout\n    CheckoutService.new.call(params[:id])\n  end\nend\n`,
    'config/routes.rb': `Rails.application.routes.draw do\n  post "/orders/:id/checkout", to: "orders#checkout"\n  resources :customers, only: [:index, :show]\nend\n`,
  };

  it('resolves autoloaded constants, instance variables, Rails routes and ActiveRecord', async () => {
    const e = edges(await build(files));
    expect(e).toContain('CALLS api_route:POST /orders/:id/checkout -> app/controllers/orders_controller.rb#OrdersController.checkout');
    expect(e).toContain('CALLS app/controllers/orders_controller.rb#OrdersController.checkout -> app/services/checkout_service.rb#CheckoutService.call');
    expect(e).toContain('CALLS app/services/checkout_service.rb#CheckoutService.call -> app/services/payment_gateway.rb#PaymentGateway.charge');
    expect(e).toContain('READS_FROM app/services/checkout_service.rb#CheckoutService.call -> database_model:Order');
    expect(e).toContain('USES app/services/payment_gateway.rb#PaymentGateway.charge -> external_service:Stripe');
    expect(e).toContain('DEPENDS_ON database_model:Order -> database_model:Customer');
    expect(e).toContain('DEPENDS_ON database_model:Customer -> database_model:Order');
    const routes = [...(await build(files)).store.nodes()].filter((n) => n.kind === 'api_route').map((n) => n.name).sort();
    expect(routes).toEqual(['GET /customers', 'GET /customers/:id', 'POST /orders/:id/checkout']);
  });
});

describe('Rust', () => {
  const files = {
    'src/main.rs': `mod db;\nmod routes;\nmod services;\n\nuse axum::{routing::post, Router};\n\nfn app() -> Router {\n    Router::new().route("/orders/:id/checkout", post(routes::checkout))\n}\n`,
    'src/routes.rs': `use crate::services::orders::OrderService;\n\npub async fn checkout() {\n    let svc = OrderService::new();\n    svc.checkout(1).await;\n}\n`,
    'src/services/mod.rs': `pub mod orders;\n`,
    'src/services/orders.rs': `use crate::db::Repo;\nuse async_openai::Client;\n\n/// Checks out orders.\npub struct OrderService {\n    repo: Repo,\n}\n\nimpl OrderService {\n    pub fn new() -> Self {\n        Self { repo: Repo::new() }\n    }\n\n    pub async fn checkout(&self, id: u64) {\n        self.repo.find(id);\n        let ai = Client::new();\n        ai.chat();\n    }\n}\n`,
    'src/db.rs': `pub struct Repo;\n\nimpl Repo {\n    pub fn new() -> Self { Repo }\n    pub fn find(&self, id: u64) {}\n}\n`,
  };

  it('resolves mod files, use trees, impl methods, axum routes and crates', async () => {
    const e = edges(await build(files));
    expect(e).toContain('CALLS api_route:POST /orders/:id/checkout -> src/routes.rs#checkout');
    expect(e).toContain('CALLS src/routes.rs#checkout -> src/services/orders.rs#OrderService.checkout');
    expect(e).toContain('CALLS src/services/orders.rs#OrderService.checkout -> src/db.rs#Repo.find');
    expect(e).toContain('USES src/services/orders.rs#OrderService.checkout -> external_service:OpenAI');
    expect(e).toContain('IMPORTS src/main.rs -> src/routes.rs');
    expect(e).toContain('IMPORTS src/services/mod.rs -> src/services/orders.rs');
    expect(e).toContain('IMPORTS src/routes.rs -> src/services/orders.rs');
  });
});

describe('incremental updates across languages', () => {
  it('refreshes Go callers when receiver methods are added or removed in another package file', async () => {
    const config = { ...emptyProjectConfig(), goModules: [{ dir: '', path: 'example' }] };
    const files = {
      'svc/type.go': `package svc\ntype Service struct {}\nfunc NewService() *Service { return &Service{} }\n`,
      'svc/method.go': `package svc\n`,
      'api/main.go': `package api\nimport "example/svc"\nfunc Run() { s := svc.NewService(); s.Work() }\n`,
    };
    const index = await build(files, config);
    const { SourceParser } = await import('@eyrie/parser');
    const parser = new SourceParser();
    try {
      const method = `package svc\nfunc (s *Service) Work() {}\n`;
      const change = index.update([{ path: 'svc/method.go', facts: await parser.parse('svc/method.go', method) }]);
      expect(change.reresolved).toContain('api/main.go');
      expect(edges(index)).toEqual(edges(await build({ ...files, 'svc/method.go': method }, config)));
      expect(edges(index)).toContain('CALLS api/main.go#Run -> svc/method.go#Service.Work');
      index.update([{ path: 'svc/method.go', facts: null }]);
      const { ['svc/method.go']: _removed, ...remaining } = files;
      expect(edges(index)).toEqual(edges(await build(remaining, config)));
      index.update([{ path: 'svc/method.go', facts: await parser.parse('svc/method.go', method) }]);
      expect(edges(index)).toContain('CALLS api/main.go#Run -> svc/method.go#Service.Work');
      index.update([{ path: 'svc/method.go', facts: await parser.parse('svc/method.go', files['svc/method.go']) }]);
      expect(edges(index)).toEqual(edges(await build(files, config)));
    } finally { parser.dispose(); }
  });

  it('composes imported FastAPI router mounts and updates prefixes without a full reindex', async () => {
    const main = (prefix: string) => `from fastapi import FastAPI\nfrom app.routes import router as orders\napp = FastAPI()\napp.include_router(orders, prefix="${prefix}")\n`;
    const files = {
      'app/main.py': main('/v1'),
      'app/routes.py': `from fastapi import APIRouter\nrouter = APIRouter(prefix="/orders")\n@router.get("/{id}")\ndef detail(id: int): return id\n`,
    };
    const index = await build(files);
    const routeNames = () => [...index.store.nodes()].filter((n) => n.kind === 'api_route').map((n) => n.name).sort();
    expect(routeNames()).toEqual(['GET /v1/orders/:id']);
    expect(edges(index)).toContain('CALLS api_route:GET /v1/orders/:id -> app/routes.py#detail');
    const { SourceParser } = await import('@eyrie/parser');
    const parser = new SourceParser();
    try {
      index.update([{ path: 'app/main.py', facts: await parser.parse('app/main.py', main('/v2')) }]);
      expect(routeNames()).toEqual(['GET /v2/orders/:id']);
      expect(edges(index)).toEqual(edges(await build({ ...files, 'app/main.py': main('/v2') })));
      index.update([{ path: 'app/main.py', facts: null }]);
      expect(routeNames()).toEqual(['GET /orders/:id']);
    } finally { parser.dispose(); }
  });

  it('supports nested and multiple mounts of the same Python router', async () => {
    const index = await build({
      'app/main.py': `from fastapi import FastAPI\nfrom app.api import api\napp = FastAPI()\napp.include_router(api, prefix="/v1")\napp.include_router(api, prefix="/v2")\n`,
      'app/api.py': `from fastapi import APIRouter\nfrom app.routes import router\napi = APIRouter(prefix="/api")\napi.include_router(router=router, prefix="/shop")\n`,
      'app/routes.py': `from fastapi import APIRouter\nrouter = APIRouter(prefix="/orders")\n@router.get("/{id}")\ndef detail(id: int): return id\n`,
    });
    expect([...index.store.nodes()].filter((n) => n.kind === 'api_route').map((n) => n.name).sort()).toEqual(['GET /v1/api/shop/orders/:id', 'GET /v2/api/shop/orders/:id']);
  });

  it('links a Go call once the callee appears in another file of the package', async () => {
    const index = await build({ 'svc/a.go': `package svc\n\nfunc Run() { helper() }\n` });
    expect(edges(index)).not.toContain('CALLS svc/a.go#Run -> svc/b.go#helper');
    const { SourceParser } = await import('@eyrie/parser');
    const parser = new SourceParser();
    index.update([{ path: 'svc/b.go', facts: await parser.parse('svc/b.go', `package svc\n\nfunc helper() {}\n`) }]);
    expect(edges(index)).toContain('CALLS svc/a.go#Run -> svc/b.go#helper');
  });
});
