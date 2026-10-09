import { describe, expect, it } from 'vitest';
import type { FileFacts } from '@eyrie/core';
import { SourceParser, detectLanguage, goPackageName } from '../src/index.js';

const parser = new SourceParser();
const parse = async (path: string, src: string) => (await parser.parse(path, src))!;
const imports = (f: FileFacts) => f.imports.map((i) => `${i.source}${i.wildcard ? ' *' : ''}${i.typeOnly ? ' type' : ''} {${i.specifiers.map((s) => `${s.imported}>${s.local}`).join(',')}}`);
const routes = (f: FileFacts) => f.routes.map((r) => `${r.method} ${r.path} -> ${r.handlers.join(',')}`);
const refs = (f: FileFacts, from: string) => f.references.filter((r) => r.from === from).map((r) => `${r.kind}:${r.callee.join('.')}`);

describe('language detection', () => {
  it('maps extensions and skips generated code', () => {
    expect(['a.py', 'a.go', 'A.java', 'a.rs', 'A.cs', 'a.php', 'a.rb', 'Rakefile.rake'].map(detectLanguage)).toEqual(['python', 'go', 'java', 'rust', 'csharp', 'php', 'ruby', 'ruby']);
    expect(['api.pb.go', 'msg_pb2.py', 'Form1.Designer.cs', 'types.d.ts'].map(detectLanguage)).toEqual([null, null, null, null]);
  });
});

describe('Python adapter', () => {
  it('records imports, typed locals, self fields and docstrings', async () => {
    const f = await parse(
      'app/svc.py',
      `from __future__ import annotations\nimport os.path\nimport numpy as np\nfrom . import models\nfrom ..repo import Repo as R, other\nfrom x import *\nfrom typing import TYPE_CHECKING\nif TYPE_CHECKING:\n    from app.types import Order\n\nclass Svc(Base):\n    """Runs things.\n\n    More detail.\n    """\n    repo: R\n    def __init__(self, ai: AI):\n        self.ai = ai\n        self.cache = Cache()\n\n    async def run(self, n: int):\n        helper = Helper()\n        helper.go()\n        self.repo.save(n)\n        super().run()\n`,
    );
    expect(imports(f)).toEqual([
      '__future__ {annotations>annotations}',
      'os.path {*>os}',
      'numpy {*>np}',
      '. {models>models}',
      '..repo {Repo>R,other>other}',
      'x * {}',
      'typing {TYPE_CHECKING>TYPE_CHECKING}',
      'app.types type {Order>Order}',
    ]);
    const svc = f.symbols.find((s) => s.name === 'Svc')!;
    expect(svc).toMatchObject({ kind: 'class', exported: true, extends: ['Base'], doc: 'Runs things.' });
    expect(svc.fields).toEqual([{ name: 'repo', type: 'R' }, { name: 'ai', type: 'AI' }, { name: 'cache', instanceOf: 'Cache' }]);
    expect(f.symbols.find((s) => s.qualifiedName === 'Svc.run')).toMatchObject({ kind: 'method', async: true, locals: { n: 'int', helper: 'Helper' } });
    expect(refs(f, 'Svc.run')).toEqual(['new:Helper', 'call:helper.go', 'call:this.repo.save', 'ref:n', 'call:super().run']);
  });

  it('records Django urlpatterns and Django / SQLAlchemy models', async () => {
    const urls = await parse('shop/urls.py', `from django.urls import path, include\nfrom . import views\n\nurlpatterns = [\n    path("orders/<int:pk>/", views.OrderDetail.as_view()),\n    path("api/", include("shop.api")),\n]\n`);
    expect(routes(urls)).toEqual(['ANY /orders/:pk -> views.OrderDetail']);
    const models = await parse(
      'shop/models.py',
      `from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship\n\nclass Base(DeclarativeBase):\n    pass\n\nclass Order(Base):\n    __tablename__ = "orders"\n    id: Mapped[int] = mapped_column(primary_key=True)\n    items: Mapped[list["Item"]] = relationship(back_populates="order")\n\nclass Plain(Base):\n    pass\n`,
    );
    expect(models.models?.map((m) => `${m.name}:${m.orm}:${m.relations}`)).toEqual(['Order:sqlalchemy:Item']);
  });
});

describe('Go adapter', () => {
  it('derives package names from import paths', () => {
    expect(['github.com/go-chi/chi/v5', 'github.com/sashabaranov/go-openai', 'gopkg.in/yaml.v3', 'net/http'].map(goPackageName)).toEqual(['chi', 'openai', 'yaml', 'http']);
  });

  it('records dot and blank imports, gorilla routes and constructor locals', async () => {
    const f = await parse(
      'cmd/main.go',
      `package main\n\nimport (\n\t. "github.com/acme/util"\n\t_ "github.com/lib/pq"\n\tsvc "github.com/acme/shop/order"\n)\n\nfunc main() {\n\ts := svc.NewService(nil)\n\tr := mux.NewRouter()\n\tr.HandleFunc("/orders/{id}", s.Get).Methods("PUT")\n\te.GET("/items", listItems)\n}\n`,
    );
    expect(imports(f)).toEqual(['github.com/acme/util * {}', 'github.com/lib/pq {}', 'github.com/acme/shop/order {*>svc}']);
    expect(routes(f)).toEqual(['PUT /orders/:id -> s.Get', 'GET /items -> listItems']);
    expect(f.symbols.find((s) => s.name === 'main')?.locals).toMatchObject({ s: 'svc.Service' });
  });
});

describe('Java adapter', () => {
  it('records static imports, JAX-RS routes and entity relations', async () => {
    const f = await parse(
      'src/a/OrderResource.java',
      `package a;\n\nimport static a.util.Strings.trim;\n\n@Path("/orders")\npublic class OrderResource {\n  @GET\n  @Path("/{id}")\n  public Order get(@PathParam("id") long id) { return trim(id); }\n\n  @POST\n  public void create() {}\n}\n\n@Entity\nclass Order {\n  @OneToMany(mappedBy = "order") private List<Item> items;\n  @ManyToOne private Customer customer;\n}\n`,
    );
    expect(imports(f)).toEqual(['a.util.Strings {Strings.trim>trim}']);
    expect(routes(f)).toEqual(['GET /orders/:id -> OrderResource.get', 'POST /orders -> OrderResource.create']);
    expect(f.models?.map((m) => `${m.name}:${m.relations}`)).toEqual(['Order:Item,Customer']);
  });
});

describe('C# adapter', () => {
  it('records alias usings, controller actions, minimal-API groups and primary constructors', async () => {
    const f = await parse(
      'Api/Program.cs',
      `using Repo = Shop.Data.OrderRepository;\nnamespace Shop.Api\n{\n    [Route("api/[controller]")]\n    public class ItemsController(IItemService items) : ControllerBase\n    {\n        [HttpGet("[action]/{id}")]\n        public Item Find(int id) => items.Find(id);\n    }\n}\n`,
    );
    expect(f.namespace).toBe('Shop.Api');
    expect(imports(f)).toEqual(['Shop.Data.OrderRepository {OrderRepository>Repo}']);
    expect(routes(f)).toEqual(['GET /api/items/find/:id -> ItemsController.Find']);
    expect(f.symbols.find((s) => s.name === 'ItemsController')?.fields).toEqual([{ name: 'items', type: 'IItemService' }]);
    expect(refs(f, 'ItemsController.Find')).toContain('call:this.items.Find');

    const min = await parse('Program.cs', `var app = builder.Build();\nvar api = app.MapGroup("/api");\napi.MapPost("/orders", CreateOrder);\napp.MapGet("/health", () => Results.Ok());\n`);
    expect(routes(min)).toEqual(['POST /api/orders -> CreateOrder', 'GET /health -> ']);
  });
});

describe('PHP adapter', () => {
  it('records grouped uses, includes, Symfony attribute routes', async () => {
    const f = await parse(
      'src/Controller/OrderController.php',
      `<?php\nnamespace App\\Controller;\n\nuse App\\Entity\\{Order, Item as Line};\nrequire_once __DIR__ . '/../helpers.php';\n\n#[Route('/orders')]\nclass OrderController extends AbstractController\n{\n    #[Route('/{id}', methods: ['GET', 'HEAD'])]\n    public function show(int $id): Response { return $this->render('x'); }\n}\n`,
    );
    expect(f.namespace).toBe('App.Controller');
    expect(imports(f)).toEqual(['App.Entity.Order {Order>Order}', 'App.Entity.Item {Item>Line}', './../helpers.php {}']);
    expect(routes(f)).toEqual(['GET /orders/:id -> OrderController.show', 'HEAD /orders/:id -> OrderController.show']);
  });

  it('records Laravel groups, match, resources and fluent prefixes', async () => {
    const f = await parse(
      'routes/api.php',
      `<?php\nRoute::group(['prefix' => 'v1', 'namespace' => 'Api'], function () {\n    Route::match(['put', 'patch'], 'user', 'UserController@update');\n    Route::resource('articles', 'ArticleController', ['except' => ['create', 'edit', 'update']]);\n});\nRoute::prefix('admin')->middleware('auth')->group(function () {\n    Route::get('stats', [StatsController::class, 'index']);\n});\n`,
    );
    expect(routes(f)).toEqual([
      'PUT /api/v1/user -> UserController.update',
      'PATCH /api/v1/user -> UserController.update',
      'GET /api/v1/articles -> ArticleController.index',
      'POST /api/v1/articles -> ArticleController.store',
      'GET /api/v1/articles/:article -> ArticleController.show',
      'DELETE /api/v1/articles/:article -> ArticleController.destroy',
      'GET /api/admin/stats -> StatsController.index',
    ]);
  });
});

describe('Ruby adapter', () => {
  it('records namespaced and nested Rails routes and Sinatra blocks', async () => {
    const f = await parse(
      'config/routes.rb',
      `Rails.application.routes.draw do\n  root "home#index"\n  namespace :api do\n    resources :orders, only: [:show] do\n      resources :items, only: [:index]\n    end\n    patch "/orders/:id/pay" => "payments#create"\n  end\nend\n`,
    );
    expect(routes(f)).toEqual([
      'GET / -> HomeController.index',
      'GET /api/orders/:id -> OrdersController.show',
      'GET /api/orders/:order_id/items -> ItemsController.index',
      'PATCH /api/orders/:id/pay -> PaymentsController.create',
    ]);
    const app = await parse('app.rb', `require "sinatra"\n\nget "/hi/:name" do\n  Greeter.new.greet(params[:name])\nend\n`);
    expect(routes(app)).toEqual(['GET /hi/:name -> ']);
    expect(refs(app, 'route:GET /hi/:name')).toEqual(['call:Greeter.greet', 'new:Greeter']);
  });

  it('records attr readers, mixins and the enclosing module as namespace', async () => {
    const f = await parse('lib/billing/charge.rb', `module Billing\n  class Charge < Base\n    include Auditable\n    attr_reader :gateway\n\n    def run\n      gateway.call\n    end\n  end\nend\n`);
    expect(f.namespace).toBe('Billing');
    expect(f.symbols.find((s) => s.name === 'Charge')).toMatchObject({ extends: ['Base', 'Auditable'], fields: [{ name: 'gateway' }] });
    expect(refs(f, 'Charge.run')).toEqual(['call:this.gateway.call']);
  });
});

describe('Rust adapter', () => {
  it('records use trees, trait impls, actix routes and skips test modules', async () => {
    const f = await parse(
      'src/handlers.rs',
      `use super::db::{self, Pool as DbPool};\nuse crate::models::*;\n\npub trait Store { fn save(&self); }\npub struct Pg;\nimpl Store for Pg { fn save(&self) {} }\n\n#[post("/orders")]\nasync fn create(pool: web::Data<DbPool>) -> impl Responder { db::insert(&pool); }\n\n#[cfg(test)]\nmod tests { fn t() { create(); } }\n`,
    );
    expect(imports(f)).toEqual(['super::db {*>db}', 'super::db {Pool>DbPool}', 'crate::models * {}']);
    expect(f.symbols.find((s) => s.name === 'Pg')?.implements).toEqual(['Store']);
    expect(routes(f)).toEqual(['POST /orders -> create']);
    expect(f.symbols.find((s) => s.name === 'create')?.locals).toEqual({ pool: 'DbPool' });
    expect(f.symbols.some((s) => s.name === 't')).toBe(false);
  });

  it('names sea-orm entities after their file', async () => {
    const f = await parse('src/entity/order.rs', `#[derive(Clone, Debug, DeriveEntityModel)]\n#[sea_orm(table_name = "orders")]\npub struct Model { pub id: i32 }\n`);
    expect(f.models?.map((m) => `${m.name}:${m.orm}:${m.symbol}`)).toEqual(['Order:sea-orm:Model']);
  });
});
