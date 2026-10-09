# Eyrie

**A live architecture map of your codebase that updates as you (or your coding agent) change the code.**

Eyrie parses a repository locally, builds a code knowledge graph, derives a small architecture graph from it (pages → API routes → services → data → external services), and shows it as an interactive map. When a file is saved, only the affected part of the graph is recomputed and the change animates into the map: new components appear, edited ones pulse, and every save is recorded on a change tape at the bottom of the screen.

> Status: early. Phase 1 (static architecture map) and Phase 2 (live graph) work end to end for TypeScript/JavaScript, Next.js and Node.js projects. See [Roadmap](#roadmap).

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

## What you see

- **Three lenses** (`1`, `2`, `3`). *Architecture* is the map of what the system is made of. *Data flow* keeps only the components that touch data — stores, and anything that reads, writes or ships it — and colours every link by what it carries: orange writes, cyan reads, dashed for a call that leaves the process, faint for an in-process hand-off. Reads are drawn pointing **out of the store**, so the arrows follow the data rather than the dependency. *Sequence* picks one entry point and lays its calls out as a sequence diagram: lifelines across the top, messages down the page, each with the file and line that makes the call (click it to open your editor). All three are derived from the same static analysis; see [Known limitations](#known-limitations) for what sequence order can and cannot tell you.
- **2D and 3D views** (press `V`). Both use custom React Flow components for navigation and inspection. The 3D view adds a full-canvas Three.js city: components become lit blocks whose **height shows lines of code**, dependencies run along the ground, and upright labels remain readable as the camera rotates. Drag to pan, right-drag or `⌥`-drag to orbit, scroll or pinch to zoom, `Q`/`E` to rotate, `T` for a top-down plan, `R` to reset. The minimap navigates the projected city. If WebGL is unavailable, the view offers a switch back to 2D.
- **Lanes.** Components are arranged left to right in the order a request travels: UI → Edge (middleware) → API → Logic → Data → External. A ruler at the top names the lanes and points to lanes that are off-screen.
- **Colors carry meaning.** Blue frontend, green API, orange services, purple AI, cyan data, yellow external services, grey utilities. A missing API route (frontend calls `/api/x` and nothing serves it) is drawn in red.
- **Links.** Solid lines are calls, dashed lines are HTTP requests (they cross a network boundary), cyan lines read or write data.
- **Live changes.** New components get a green `+` badge, edited ones a yellow `~`, removed ones a red `−`. In 3D, new blocks rise into place and removed blocks briefly fade and sink. Selecting a component sends a bounded sweep along its dependencies; trace modes animate continuous request flow. The 2D lane ruler marks off-screen changes. Layout is stable: existing components keep their order when the map updates.
- **Change tape.** Every save becomes a tick: height is the size of the change, color its type. Hover a tick to light up what it touched; click to jump there.
- **Details panel.** Click a component to see its purpose (from its doc comment, or generated from the code), source location with a code preview, **Open in editor**, what it calls, what uses it, and the symbols inside.
- **Trace and impact.** In the panel, *Depends on* follows the request through everything a component calls (with animated flow); *Impact* shows everything that could break if it changes, grouped into API, UI, services, data and external.
- **Search** (`⌘K` or `/`), category filters, `F` to fit, `Esc` to clear.

## How it works

```
files ──► parser (tree-sitter) ──► facts per file ──► code graph ──► architecture graph ──► UI
             cached by content hash      (Graphology + SQLite)    (deterministic rules)    (ELK layout; React Flow 2D,
                                                                                            Three.js city; anime.js motion)
                                              ▲
file watcher ── changed files only ───────────┘   diffs ──► WebSocket events ──► animations
```

**Code graph first. Visualization second. AI third.** Every relationship comes from static analysis. There is no AI in the pipeline today; when it arrives it will annotate the graph (summaries, grouping suggestions, Q&A), never invent dependencies.

1. **Facts.** Each file is parsed once with tree-sitter (WASM) into *facts*: imports, exports, symbols, call/`new`/JSX references with their enclosing symbol, literal arguments (for `fetch('/api/...')`), Express route registrations, Prisma models. Facts depend only on the file's content, so they are cached in SQLite by hash; restarts reuse them.
2. **Code graph.** Facts become nodes (files, functions, classes, methods, components, hooks, API routes, middleware, data models, external services) and edges (`CONTAINS`, `IMPORTS`, `EXPORTS`, `CALLS`, `USES`, `EXTENDS`, `IMPLEMENTS`, `HTTP_CALL`, `READS_FROM`, `WRITES_TO`, `DEPENDS_ON`). Resolution follows relative imports, tsconfig/jsconfig `paths` and `baseUrl`, workspace packages, barrels and re-exports, class instances, `this.field` types, typed parameters and object-literal services. Every edge carries a confidence.
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
| External services | 50+ SDKs (OpenAI, Anthropic, Gemini, Stripe, Resend, Clerk, Supabase, Redis, S3, …) via imports or API hosts |
| Project setup | `tsconfig`/`jsconfig` paths (including `extends`), monorepo workspace packages, `.gitignore` and `.eyrieignore` |

## Privacy and security

- Everything runs locally. Eyrie makes no network requests; fonts are bundled.
- The server binds to `127.0.0.1`, requires a random per-run access token, and rejects requests whose `Host` header is not local (DNS-rebinding protection).
- The source endpoint only serves files that are in the index. `.env` files, keys and anything ignored by git are never readable through it.
- The cache lives in `~/.eyrie/repos/<hash>/graph.db` (override with `EYRIE_HOME`).

## Development

```text
packages/
  core/          shared types: facts, graph, stable ids, diffs, events
  parser/        tree-sitter (WASM) language adapters → facts; Prisma schema reader
  graph/         module resolution, relationship resolution, incremental code graph, queries
  architecture/  code graph → architecture graph (classification, lifting, pass-through)
  lens/          views over the architecture graph: data flow, sequence
  storage/       SQLite (node:sqlite) facts cache, nodes and edges
  engine/        scanning, ignore rules, config loading, watching, update pipeline
  server/        CLI, HTTP API and WebSocket
apps/
  web/           React UI: ELK layout, React Flow navigation, Three.js 3D city, anime.js animation
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
- Architecture classification is heuristic. It is tuned for Next.js and Node.js apps; other layouts may need rules. Add a doc comment to a component's main export to set its description.
- Express router prefixes (`app.use('/api', router)`) are not joined to the routes registered on the router yet.
- Parsing is single-threaded; very large repositories take a while on first run (later runs use the cache).
- TypeScript and JavaScript only.

## Related projects

This space moves fast. [GitNexus](https://github.com/abhigyanpatwari/GitNexus), [Understand-Anything](https://github.com/Egonex-AI/Understand-Anything), [Depwire](https://depwire.dev) and [CodeViz](https://www.codeviz.ai/) build code graphs for agents and humans. Eyrie focuses on a small, deterministic architecture view that stays live while code changes.

## License

[GNU AGPL-3.0-only](LICENSE). You can read, run, modify and redistribute Eyrie freely. The one condition that matters: if you modify Eyrie and let other people use it over a network, you have to offer them your modified source too. Running it locally on your own code carries no obligation at all, and Eyrie never sends your code anywhere.
