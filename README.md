# Eyrie

**A live architecture map of your codebase that updates as you (or your coding agent) change the code.**

Eyrie parses a repository locally, builds a code knowledge graph, derives a small architecture graph from it (pages → API routes → services → data → external services), and shows it as an interactive map. When a file is saved, only the affected part of the graph is recomputed and the change animates into the map: new components appear, edited ones pulse, and every save is recorded on a change tape at the bottom of the screen.

> Status: early. Phase 1 (static architecture map) and Phase 2 (live graph) work end to end for TypeScript/JavaScript, Python, Go, Java, C#, PHP, Ruby and Rust projects. JavaScript (Next.js, Node.js) has the deepest support. See [Roadmap](#roadmap).

An *eyrie* is a bird of prey's nest, built high on a crag — the vantage point you watch the whole territory from.

## Quick start

Requirements: Node.js 22.13 or newer, pnpm 9.

```bash
pnpm install
```

```bash
pnpm start -- /path/to/your/repo
```

This builds the UI, indexes the repository, and opens `http://127.0.0.1:4319/?token=…` in your browser. Leave it running and edit code in the repository; the map follows.

Options: `--port <n>`, `--no-open`, `--no-watch` (index once), `--reset` (ignore the cache), `--host <h>`.

## Supported languages

| Language | Files | Imports resolved through |
| --- | --- | --- |
| TypeScript / JavaScript | `.ts` `.tsx` `.js` `.jsx` `.mjs` `.cjs` | relative paths, `tsconfig` / `jsconfig` paths, workspace packages, barrels |
| Python | `.py` | dotted modules, packages and `__init__.py` re-exports, relative imports |
| Go | `.go` | `go.mod` module paths; a package is its whole directory |
| Java | `.java` | packages, single-type, wildcard and static imports |
| C# | `.cs` | namespaces, `using` directives and aliases |
| PHP | `.php` | namespaces, `use` (including groups), `require` / `include` |
| Ruby | `.rb` `.rake` | `require` / `require_relative`, autoloaded constants (Rails) |
| Rust | `.rs` | `mod` files, `use` trees, `crate::` / `self::` / `super::` paths |

Every language gets the same treatment: classes and functions, calls between them (including through fields such as `self.repo`, `$this->repo`, `@repo` and injected services), HTTP routes, database models with reads and writes, external SDKs and outbound HTTP calls. Mixed repositories (a Python or Go backend with a React frontend) are indexed into one map. See [What is detected](#what-is-detected) for the frameworks each language understands. JavaScript (Next.js, Node.js) has the deepest support.

Generated code is skipped (`*.pb.go`, `*_pb2.py`, `*.Designer.cs`, `*.d.ts`), and test files in each language's convention (`test_*.py`, `*_test.go`, `*Test.java`, `*_spec.rb`, …) are kept out of the architecture view.

## What you see

- **Three lenses** (`1`, `2`, `3`). *Architecture* is the map of what the system is made of. *Data flow* keeps only the components that touch data — stores, and anything that reads, writes or ships it — and colours every link by what it carries: orange writes, cyan reads, dashed for a call that leaves the process, faint for an in-process hand-off. Reads are drawn pointing **out of the store**, so the arrows follow the data rather than the dependency. *Sequence* picks one entry point and lays its calls out as a sequence diagram: lifelines across the top, messages down the page, each with the file and line that makes the call (click it to open your editor). All three are derived from the same static analysis; see [Known limitations](#known-limitations) for what sequence order can and cannot tell you.
- **2D and 3D views** (press `V`). The 3D view turns the map into a city: lanes become districts on a perspective floor, components become blocks whose **height shows lines of code**, and dependencies run along the ground as tracks. Drag to pan, right-drag or `⌥`-drag to orbit, scroll or pinch to zoom, `Q`/`E` to rotate, `T` for a top-down plan, `R` to reset. Entering 3D tilts the flat map into perspective, raises the blocks lane by lane and draws the tracks in.
- **Lanes.** Components are arranged left to right in the order a request travels: UI → Edge (middleware) → API → Logic → Data → External. A ruler at the top names the lanes and points to lanes that are off-screen.
- **Colors carry meaning.** Blue frontend, green API, orange services, purple AI, cyan data, yellow external services, grey utilities. A missing API route (frontend calls `/api/x` and nothing serves it) is drawn in red.
- **Links.** Solid lines are calls, dashed lines are HTTP requests (they cross a network boundary), cyan lines read or write data.
- **Live changes.** New components get a green halo and a `+` badge, edited ones a yellow `~`, removed ones a red `−`. In 3D, new blocks drop in and bounce off the floor, edited blocks bounce in height, and removed blocks sink into the ground. Changes that happen off-screen show a colored dot on the lane ruler. Layout is stable: existing components keep their order when the map updates.
- **Change tape.** Every save becomes a tick: height is the size of the change, color its type. Hover a tick to light up what it touched; click to jump there.
- **Details panel.** Click a component to see its purpose (from its doc comment, or generated from the code), source location with a code preview, **Open in editor**, what it calls, what uses it, and the symbols inside.
- **Trace and impact.** In the panel, *Depends on* follows the request through everything a component calls (with animated flow); *Impact* shows everything that could break if it changes, grouped into API, UI, services, data and external.
- **Search** (`⌘K` or `/`), category filters, `F` to fit, `Esc` to clear.

## How it works

```
files ──► parser (tree-sitter) ──► facts per file ──► code graph ──► architecture graph ──► UI
             cached by content hash      (Graphology + SQLite)    (deterministic rules)    (ELK layout; D3 2D view,
                                                                                            CSS 3D city; anime.js motion)
                                              ▲
file watcher ── changed files only ───────────┘   diffs ──► WebSocket events ──► animations
```

**Code graph first. Visualization second. AI third.** Every relationship comes from static analysis. There is no AI in the pipeline today; when it arrives it will annotate the graph (summaries, grouping suggestions, Q&A), never invent dependencies.

1. **Facts.** Each file is parsed once with tree-sitter (WASM) into *facts*: imports, exports, symbols, call/`new`/JSX references with their enclosing symbol, literal arguments (for `fetch('/api/...')`), route registrations, ORM models. Every language has its own adapter, but they all produce the same facts, so everything downstream is language-neutral. Facts depend only on the file's content, so they are cached in SQLite by hash; restarts reuse them.
2. **Code graph.** Facts become nodes (files, functions, classes, methods, components, hooks, API routes, middleware, data models, external services) and edges (`CONTAINS`, `IMPORTS`, `EXPORTS`, `CALLS`, `USES`, `EXTENDS`, `IMPLEMENTS`, `HTTP_CALL`, `READS_FROM`, `WRITES_TO`, `DEPENDS_ON`). Resolution follows relative imports, tsconfig/jsconfig `paths` and `baseUrl`, workspace packages, barrels and re-exports, class instances, `this.field` types, typed parameters and object-literal services. Outside JavaScript it also follows Python dotted modules and packages, Go packages (directories, via `go.mod`), Java / C# / PHP namespaces and wildcard imports, Rust `mod` trees and `use` paths, and Ruby autoloaded constants, plus names visible without an import (same Go package, same Java or C# namespace). `self`, receivers, `$this`, `@ivar` and injected fields all resolve like `this.field`. Every edge carries a confidence.
3. **Lenses.** Data flow and sequence are pure functions of the architecture graph, computed in the browser, so they stay live as you edit. Data flow keeps a component when it stores data, reads, writes or ships it, or when it sits on a path from an entry point to one that does; each edge is classified `read`, `write`, `readwrite`, `transfer` (it crosses a process boundary) or `carry`. Sequence walks the graph from one entry point, ordering each component's calls by the source line the graph recorded for them, and expanding a component's own calls only the first time it is reached.
4. **Incremental updates.** While resolving a file, the graph records which other files it consulted. When a file changes, only it is re-resolved, plus, if its exported surface changed, the files that consulted it. Node ids are stable hashes of `repository + file path + symbol kind + qualified name`, so unchanged code keeps its identity across edits. Each update produces an exact diff (`node.created`, `edge.deleted`, …).
5. **Architecture graph.** Files are classified by framework conventions and names (Next.js `page`/`route`/`layout`/`middleware`, `'use server'`, Express routers, `*Service`, `*Repository`, `services/`, React components, hooks). Presentational components, hooks, helpers and SDK client wrappers are hidden and edges pass through them, so the map stays small and connected. Shared helpers used by many components, and modules on dependency paths in library-style repos, are shown. A typical app reduces to 20–50 components.

### What is detected

| Area | Detected |
| --- | --- |
| Next.js | App Router `page`, `route` (per HTTP method), `layout`, `middleware`/`proxy`, Pages Router pages and `pages/api`, `next/dynamic` imports, server actions |
| HTTP | `fetch`, `axios` and `axios.create()` instances, `ky`, `ofetch`, `useSWR`, template and concatenated URLs, matched to routes including dynamic segments; external hosts mapped to providers |
| Node.js | Express/Hono/Fastify-style `app.get('/path', handler)` routes, CommonJS `require`/`module.exports` |
| Data | Prisma schema models with reads/writes per operation, Drizzle tables, Mongoose models, Supabase tables |
| Python | Flask / FastAPI decorator routes (with blueprint and router prefixes), Django `urlpatterns`; Django, SQLAlchemy and SQLModel models; `requests` / `httpx` calls |
| Go | `net/http` (including Go 1.22 `"POST /x"` patterns), gin, echo, chi, fiber and gorilla/mux routes; gorm models; `http.Get` calls |
| Java | Spring MVC (`@RequestMapping` + `@GetMapping`…), JAX-RS and Micronaut routes; JPA entities and Spring Data repositories |
| C# | ASP.NET controllers (`[Route]`, `[HttpGet]`, `[controller]` tokens) and minimal APIs (`MapGet`, `MapGroup`); EF Core `DbSet` models; `HttpClient` calls |
| PHP | Laravel routes (groups, prefixes, `match`, `resource`) and Symfony `#[Route]`; Eloquent models and relations |
| Ruby | Rails `routes.rb` (`resources`, `namespace`, `to:`) and Sinatra; ActiveRecord models and associations |
| Rust | axum `.route()`, actix-web / rocket attribute routes; diesel, sea-orm and sqlx models |
| External services | 50+ SDKs (OpenAI, Anthropic, Gemini, Stripe, Resend, Clerk, Supabase, Redis, S3, …) via imports or API hosts, recognised under each ecosystem's package names (pip, Go modules, Maven, NuGet, Composer, gems, crates) |
| Project setup | `tsconfig`/`jsconfig` paths (including `extends`), monorepo workspace packages, `go.mod` modules, frameworks from `pyproject.toml` / `requirements.txt`, `pom.xml` / `build.gradle`, `*.csproj`, `composer.json`, `Gemfile` and `Cargo.toml`, `.gitignore` and `.eyrieignore` |

## Privacy and security

- Everything runs locally. Eyrie makes no network requests; fonts are bundled.
- The server binds to `127.0.0.1`, requires a random per-run access token, and rejects requests whose `Host` header is not local (DNS-rebinding protection).
- The source endpoint only serves files that are in the index. `.env` files, keys and anything ignored by git are never readable through it.
- The cache lives in `~/.eyrie/repos/<hash>/graph.db` (override with `EYRIE_HOME`).

## Development

```text
packages/
  core/          shared types: facts, graph, stable ids, diffs, events
  parser/        tree-sitter (WASM) language adapters → facts (TS/JS, Python, Go, Java, C#, PHP, Ruby, Rust); Prisma schema reader
  graph/         module resolution, relationship resolution, incremental code graph, queries
  architecture/  code graph → architecture graph (classification, lifting, pass-through)
  lens/          views over the architecture graph: data flow, sequence
  storage/       SQLite (node:sqlite) facts cache, nodes and edges
  engine/        scanning, ignore rules, config loading, watching, update pipeline
  server/        CLI, HTTP API and WebSocket
apps/
  web/           React UI: ELK layout, D3 2D view, CSS 3D city view, anime.js animation
fixtures/
  bookstore-app/ sample Next.js app used by tests and demos
scripts/
  fetch-smoke-repo.sh  clones a real OSS app into .smoke/ for the smoke test
LICENSE          GNU AGPL-3.0
```

```bash
pnpm test          # parser, graph, architecture, lens, engine (real file watcher) and server tests
pnpm typecheck
pnpm dev           # engine on :4319 (fixture app, token "dev") + UI with hot reload on :5173

pnpm smoke:fetch   # clone a real MIT-licensed Next.js app into .smoke/ (once)
pnpm smoke         # scan that real repo end to end; skips if it was never fetched
```

`pnpm test` is hermetic and offline: it runs against `fixtures/bookstore-app`, a small
hand-written Next.js app whose every asserted edge is a claim about how resolution
*should* behave. `pnpm smoke` is the opposite check — it scans a ~290-file third-party
repo to confirm Eyrie survives code nobody wrote for it, asserting shape and health
rather than specific edges. That repo is cloned into the gitignored `.smoke/`, never
vendored, so this project carries no third-party code.

The other languages are tested the same way, with small in-memory apps per language (`packages/*/test/languages.test.ts`). They were also checked by hand against real open-source apps: the FastAPI full-stack template, Spring petclinic, and the Go, C#, Laravel, Rails and Rust RealWorld implementations.

**Adding a language.** Add its tree-sitter grammar to `packages/parser`, register the extension in `languages.ts`, and write an extractor on top of `BaseExtractor` (`packages/parser/src/base.ts`) that emits the same facts as the others. Then teach `ModuleResolver` (`packages/graph/src/resolver.ts`) how its imports map to files. Nothing else needs to know about the language.

During `pnpm dev`, open `http://localhost:5173/?token=dev`.

To open files from the UI, Eyrie looks for `cursor`, `code`, `windsurf` or `zed` on your `PATH`; set `EYRIE_EDITOR` to choose one.

## Roadmap

- [x] **Phase 1: static architecture map.** Scanner, tree-sitter parsing, symbols, imports/exports, calls, React and Next.js detection, code graph, architecture graph, D3 map, details panel.
- [x] **Phase 2: live graph.** File watcher, incremental resolution with reverse-dependency invalidation, graph diffs, WebSocket events, animated updates, stable layout, change tape.
- [ ] **Phase 3: navigation.** Done: search, open in editor, jump to line, category filters, data-flow and sequence lenses. Next: collapse/expand groups, semantic zoom.
- [ ] **Phase 4: graph intelligence.** Done: trace (downstream) and impact (upstream) on the architecture graph. Next: shortest path between two components, code-level impact.
- [ ] **Phase 5: AI understanding.** Optional, graph-backed summaries and Q&A (local models via Ollama first).
- [ ] **Phase 6: Git intelligence.** Working-tree overlays, branch and commit architecture diffs, timeline.
- [ ] **Phase 7: coding-agent integration.** Attribute changes to agent sessions (for example via Claude Code hooks), and expose the graph to agents over MCP.
- [ ] **Desktop app.** A Tauri shell around the same UI, running the engine as a sidecar.

## Known limitations

- Resolution is syntactic. Without a type checker, calls through untyped values, dependency injection or dynamic dispatch can be missed or fall back to the class (with lower confidence).
- The sequence view orders calls by where they are written in the source. That is all static analysis can give: conditionals, loops and `await` can make the running order differ, and returns are not modelled. Workflow and lifecycle views (branches, retries, terminal states) would need control-flow analysis, which Eyrie does not do.
- Architecture classification is heuristic. It is tuned most for Next.js and Node.js apps, then for the frameworks listed above; other layouts may need rules. Add a doc comment (or a Python docstring) to a component's main export to set its description.
- Express router prefixes (`app.use('/api', router)`) are not joined to the routes registered on the router yet.
- Parsing is single-threaded; very large repositories take a while on first run (later runs use the cache).
- Supported languages: TypeScript, JavaScript, Python, Go, Java, C#, PHP, Ruby and Rust. Kotlin, Swift and C/C++ are not parsed yet.
- Outside JavaScript, what a dynamic language decides at run time is not followed: Ruby metaprogramming, PHP magic methods, Python `getattr`, DI containers configured outside the code, and Rust macro bodies (such as `sqlx::query!`).
- A frontend that calls the backend through a generated API client (OpenAPI SDKs) shows no HTTP links to the backend's routes; only direct `fetch` / `axios` calls are matched.

## Related projects

This space moves fast. [GitNexus](https://github.com/abhigyanpatwari/GitNexus), [Understand-Anything](https://github.com/Egonex-AI/Understand-Anything), [Depwire](https://depwire.dev) and [CodeViz](https://www.codeviz.ai/) build code graphs for agents and humans. Eyrie focuses on a small, deterministic architecture view that stays live while code changes.

## License

[GNU AGPL-3.0-only](LICENSE). You can read, run, modify and redistribute Eyrie freely. The one condition that matters: if you modify Eyrie and let other people use it over a network, you have to offer them your modified source too. Running it locally on your own code carries no obligation at all, and Eyrie never sends your code anywhere.
