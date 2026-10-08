# 02 — Technical Requirements Document (TRD)

| Field | Value |
| --- | --- |
| Product | Eyrie |
| Owner | Badhan Sen |
| Status | Describes the implemented system; planned items are marked |
| Last updated | 2026-10-08 |
| Answers | How is Eyrie built and operated? |
| Related | [PRD](../01-product-requirements/README.md) · [Backend Schema](../05-backend-schema/README.md) · [App Flow](../03-app-flow/README.md) |

## 1. Architecture

Eyrie is a pnpm monorepo. One long-running local process (the engine + server) owns analysis and state; a browser UI is a pure view over it.

```text
files ──► parser (tree-sitter WASM) ──► facts per file ──► code graph ──► architecture graph ──► UI
             cached by content hash         (Graphology + SQLite)   (deterministic rules)   (ELK layout; D3 2D;
                                                                                             CSS 3D city; anime.js)
                                              ▲
file watcher ── changed files only ───────────┘   diffs ──► WebSocket events ──► animations
```

**Core principle: code graph first, visualisation second, AI third.** Static analysis establishes facts. The map is a view of the graph, never the source of truth. AI, when it arrives, annotates the graph and must not invent dependencies.

### Package boundaries

| Package | Responsibility | Key deps |
| --- | --- | --- |
| `@eyrie/core` | Shared types only: facts, graph nodes/edges, stable ids, diffs, events, paths | none |
| `@eyrie/parser` | tree-sitter language adapters → facts; Prisma schema reader | `web-tree-sitter`, `tree-sitter-typescript`, `tree-sitter-javascript` |
| `@eyrie/graph` | Module resolution, relationship resolution, incremental code graph, queries | `graphology` |
| `@eyrie/architecture` | Code graph → architecture graph: classification, lifting, pass-through edges | core, graph |
| `@eyrie/lens` | Pure views over the architecture graph: data flow, sequence | core |
| `@eyrie/storage` | SQLite persistence: facts cache, nodes, edges, meta | `node:sqlite` (built-in) |
| `@eyrie/engine` | Scanning, ignore rules, project config, watching, update pipeline | `chokidar`, `ignore`, `json5` |
| `@eyrie/server` | CLI, HTTP API, WebSocket, static hosting, editor launch | `ws` |
| `@eyrie/web` | React UI: layout, 2D renderer, 3D city, animation, state | `react` 19, `elkjs`, `d3-*`, `animejs`, `lucide-react` |

Dependencies point one way: `core ← parser/graph/storage ← architecture ← lens ← engine ← server`. The web app depends only on `core` and `lens`, which is what lets both lenses run in the browser and stay live while editing.

## 2. Frontend

- **Framework:** React 19, built with Vite 8 (Tailwind v4 via `@tailwindcss/vite`), served as static assets by the engine's own HTTP server.
- **Layout:** `elkjs` computes the lane-ordered architecture layout. Layout is *stable*: existing components keep their order when the graph updates.
- **2D renderer:** hand-written D3 (`d3-selection`, `d3-zoom`, `d3-transition`, `d3-ease`, `d3-interpolate`) over SVG — no general-purpose graph library, so node rendering and interaction stay under our control.
- **3D view:** CSS 3D transforms (no WebGL dependency). Lanes become districts on a perspective floor; block height encodes lines of code.
- **Animation:** `animejs` for diff-driven motion (halos, pulses, block rise/sink, trace flow).
- **State:** a small hand-rolled store (`apps/web/src/state/store.ts`). Lens and 2D/3D preference persist in `localStorage` (`eyrie-lens`, `eyrie-view`).
- **Icons:** `lucide-react`.
- **Fonts:** bundled via `@fontsource-variable/archivo` and `@fontsource/fragment-mono` — never fetched from a CDN (see [Design Brief](../04-design-brief/README.md)).

## 3. Backend (engine + server)

Single Node.js process, no separate API tier.

**Responsibilities:** scan the repo, honour ignore rules, load project config, parse changed files, resolve relationships, maintain the code graph, derive the architecture graph, diff on every update, broadcast events, serve the UI and the read-only source endpoint, launch the user's editor.

### HTTP API

All `/api/*` requests require the per-run token (query `?token=` or header `x-eyrie-token`) and a local `Host`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/state` | Full snapshot: `{ repo, stats, seq, architecture }` |
| GET | `/api/arch/:id` | Architecture node details |
| GET | `/api/code/:id` | Code-graph node details |
| GET | `/api/source?file=&start=&end=` | Source lines — **only for indexed files** |
| POST | `/api/open` | `{ file, line }` → launch editor; `501` if no editor found |

Error contract: `401` missing/invalid token, `403` non-local `Host`, `404` unknown endpoint or non-indexed file, `500` with `{ error }`. Request bodies are capped at 64 KB.

### WebSocket

Server → client messages (`@eyrie/core/events`):

| Message | Payload |
| --- | --- |
| `hello` | `seq`, `repo`, `stats`, full `architecture` |
| `status` | `indexing` \| `ready` \| `error`, optional `message` |
| `batch` | `seq`, `at`, `ms`, changed `files`, `events[]`, `truncated`, `stats` |

`events[]` is the exact diff: `file.changed`, `node.created/updated/deleted`, `edge.created/updated/deleted`, `architecture.updated` (carrying an `ArchDiff`). Code-level events are omitted and `truncated` set when a batch is very large; the architecture diff is always included, so the UI can always reconcile. `seq` lets a reconnecting client detect that it missed batches and refetch `/api/state`.

## 4. Parsing and resolution

- **Parser:** tree-sitter compiled to WASM, so there is no native build step. Each file is parsed once into *facts*: imports, exports, symbols, call/`new`/JSX references with their enclosing symbol, literal arguments (for `fetch('/api/...')`), route registrations, Prisma models.
- **Facts are content-addressed.** They depend only on file content, so they are cached in SQLite by hash and reused across restarts. A `facts_version` bump invalidates the whole file cache.
- **Resolution** follows relative imports, `tsconfig`/`jsconfig` `paths` and `baseUrl` (including `extends` chains, parsed with JSON5), workspace packages, barrels and re-exports, class instances, `this.field` types, typed parameters and object-literal services. **Every edge carries a confidence** (1 = syntactically certain, lower = heuristic).
- **Limitation, accepted:** resolution is syntactic. Without a type checker, calls through untyped values, DI or dynamic dispatch can be missed or fall back to the class with lower confidence.

### Incremental updates

The graph records, per file, which other files it consulted during resolution. On change: re-resolve that file only; additionally re-resolve its consumers **only if its exported surface changed**. Node ids are stable hashes of `repository + file path + symbol kind + qualified name`, so unchanged code keeps its identity across edits and the UI can animate rather than re-render.

## 5. Storage

SQLite via Node's built-in `node:sqlite` — no native module, no server. `PRAGMA journal_mode = WAL`, `synchronous = NORMAL`. Writes are batched in an explicit transaction per update.

Location: `~/.eyrie/repos/<hash>/graph.db`, overridable with `EYRIE_HOME`. Full schema in the [Backend Schema document](../05-backend-schema/README.md).

## 6. Runtime, hosting and environments

Eyrie is **not hosted**. There is no production environment in the web sense; the user's machine is the only environment.

| Environment | How it runs |
| --- | --- |
| Development | `pnpm dev` — engine on `:4319` against `fixtures/bookstore-app` with token `dev`, plus Vite UI with HMR on `:5173`. Open `http://localhost:5173/?token=dev` |
| Local use | `pnpm start -- /path/to/repo` — builds the UI, indexes, serves and opens the browser |
| Test | `pnpm test` (vitest, hermetic and offline, against the fixture) |
| Smoke | `pnpm smoke:fetch` then `pnpm smoke` — scans a real third-party repo cloned into the git-ignored `.smoke/` |

**Requirements:** Node.js ≥ 22.13 (for `node:sqlite`), pnpm 9.15.0. ES modules throughout, TypeScript ~5.9.

**CLI options:** `--port <n>` (default 4319, or next free; `0` = any), `--host <h>` (default `127.0.0.1`), `--token <t>` (default random per run), `--no-open`, `--no-watch`, `--reset`, `-h`.

## 7. Integrations

| Integration | Direction | Notes |
| --- | --- | --- |
| Editor launch | Outbound process spawn | `cursor`, `code`, `windsurf`, `zed` discovered on `PATH`; `EYRIE_EDITOR` overrides |
| File watcher | OS | `chokidar` |
| Git | Read-only (planned, Phase 6) | Overlays, branch/commit diffs, timeline |
| Local LLM (planned, Phase 5) | Outbound to `localhost` | Ollama first; strictly optional and graph-backed |
| MCP (planned, Phase 7) | Inbound from coding agents | Expose the graph to agents |

**There are no network integrations today.** No analytics, no error reporting, no update check, no CDN.

## 8. Authentication and authorisation

There are no user accounts. The trust boundary is "a process on this machine, started by this user":

- Random per-run access token required on every `/api/*` request and on the WebSocket upgrade.
- Bind to `127.0.0.1` by default.
- `Host` header must be `localhost`, `127.0.0.1`, `::1` or the configured host — this is DNS-rebinding protection, which a token alone does not provide.
- Read-only surface: the only mutating endpoint is `/api/open`, and it can only open a path that is already in the index.

## 9. Quality requirements

| Area | Target |
| --- | --- |
| Correctness | Every asserted edge in `fixtures/bookstore-app` is a claim about how resolution *should* behave; `pnpm test` must stay green and offline |
| Robustness | `pnpm smoke` on a ~290-file third-party repo must complete and produce a healthy graph (shape and health assertions, not specific edges) |
| Types | `pnpm typecheck` clean across the monorepo and the web app |
| Determinism | Identical input ⇒ identical graph and identical node ids |
| Responsiveness | Incremental update visible within a couple of seconds of save; cached restart far faster than first run |
| Accessibility | Visible focus ring on every interactive element; every mouse action reachable by keyboard; both colour schemes meet contrast targets (see Design Brief) |
| Browser support | Current Chrome, Safari and Firefox. Requires CSS `color-mix()`, CSS 3D transforms and `prefers-color-scheme` |
| Known cost | Parsing is single-threaded; very large repos are slow on first run and fast afterwards |

## 10. Security and operations

- **Secrets:** Eyrie holds none. The only secret in play is the run token, which lives in memory and in the opened URL.
- **Source exposure:** `/api/source` and `/api/open` resolve only against the index. `.env` files, keys and anything git-ignored are never readable through the server. Static file serving normalises paths and refuses anything outside the built web directory.
- **Input validation:** JSON bodies capped at 64 KB; ids matched against `^[\w-]+$` before lookup; `start`/`end` coerced to numbers.
- **Ignore rules:** `.gitignore` and `.eyrieignore` are honoured during scanning, so secrets and build output are not even parsed.
- **Logging:** stdout only, for the operator who started the process. No log shipping.
- **Backups and recovery:** the cache is disposable. `--reset` ignores it; deleting `~/.eyrie/repos/<hash>/` forces a clean re-index. The repository is the only durable state and Eyrie never writes to it.
- **Incidents:** there is no shared service to page anyone about. Failure mode is a local process that stops; the user restarts it.

## 11. Deployment and maintenance

- **Distribution today:** clone the repo, `pnpm install`, `pnpm start`. `pnpm start` builds the UI first, so a user always serves a current bundle.
- **Versioning:** `SCHEMA_VERSION` and `facts_version` are the two compatibility knobs; bumping either triggers an automatic local rebuild (see Backend Schema).
- **Planned:** Tauri desktop shell wrapping the same UI with the engine as a sidecar.
- **Licence:** GNU AGPL-3.0-only. Modifying Eyrie and offering it to others *over a network* obliges you to offer your source. Running it locally carries no obligation. This constrains any future hosted offering — a deliberate choice.

## 12. Constraints and rationale

| Constraint | Rationale |
| --- | --- |
| Local-first, zero network | The product is "point this at your proprietary code". A network call would undermine it |
| Node ≥ 22.13 | Lets us use built-in `node:sqlite` instead of a native module, keeping install friction near zero |
| tree-sitter via WASM | No compiler toolchain needed on the user's machine |
| No general graph library in the UI | Rendering, lanes, lifting and animation are the product; a generic library would fight all four |
| CSS 3D instead of WebGL | One rendering model, smaller bundle, works alongside the DOM-based 2D view |
| Static analysis only | Determinism and trust. An LLM-derived edge cannot be relied on for impact analysis |
| TS/JS only | Depth over breadth while resolution rules are still being tuned |
| AGPL-3.0-only | Keeps derivative *network services* open |

## Completion checklist

- [x] Technical choices support the PRD.
- [x] Integrations and environment requirements are defined.
- [x] Quality targets are measurable.
- [x] Deployment, maintenance and recovery responsibilities are assigned.
- [ ] Open: whether classification rules become user-configurable, and whether Phase 5 permits any non-local model.
