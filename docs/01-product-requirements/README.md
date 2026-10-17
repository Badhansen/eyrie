# 01 — Product Requirements Document (PRD)

| Field | Value |
| --- | --- |
| Product | Eyrie — a live architecture map of your codebase |
| Owner | Badhan Sen |
| Status | Living document — reflects Phases 1–2 shipped, Phase 3–4 partial |
| Last updated | 2026-10-08 |
| Answers | What should Eyrie do? |
| Related | [TRD](../02-technical-requirements/README.md) · [App Flow](../03-app-flow/README.md) · [Implementation Plan](../06-implementation-plan/README.md) |

## 1. Overview

Eyrie is a local-first developer tool that parses a repository, builds a code knowledge graph, derives a small architecture graph from it, and presents it as an interactive map that stays synchronised with the source. When a file is saved — by a human or by a coding agent — only the affected region of the graph is recomputed and the change animates into the map.

It is a desktop-class developer tool delivered today as a CLI that serves a local web UI (`pnpm start -- /path/to/repo` → `http://127.0.0.1:4319`). It is not a hosted service and makes no network requests.

## 2. Business goals

| Goal | Why it matters |
| --- | --- |
| Make a codebase's architecture legible in under a minute | New contributors and agent operators currently reconstruct architecture by hand, from imports and search |
| Keep the map true as the code changes | Static diagram generators go stale the day they are produced; a stale diagram is worse than none |
| Make AI-authored change visible | Codebases are increasingly modified by agents; developers need to see what just moved |
| Earn trust through determinism | Every edge must come from static analysis, so the map can be relied on for impact decisions |
| Stay local and private by default | The target user will not point a code-understanding tool at a remote service |

Non-goal: becoming a general code-search or code-review product. Eyrie answers *structural* questions.

## 3. Target users

| User | Needs to accomplish |
| --- | --- |
| **Developer new to a repository** | See the major components and how a request travels, without reading every file |
| **Developer operating a coding agent** | See what an agent just added, changed or removed, and whether it wired it into the right place |
| **Developer about to make a risky change** | Know what calls a component and what breaks if it changes |
| **Tech lead / reviewer** | Check whether a change respects the intended layering (UI → API → logic → data) |

All four are technical, run the tool on their own machine, and already have the repository checked out. There is no non-technical persona and no multi-user surface.

## 4. Scope

### Shipped (first release)

- Index a TypeScript/JavaScript repository; cache parse results by content hash.
- Architecture map with six lanes: UI → Edge → API → Logic → Data → External.
- Four lenses: System (components grouped by app or package and layer; the first-visit view), Architecture, Data flow, Sequence.
- 2D map and a 3D "city" view where block height is lines of code.
- Live updates on file save, with diff-driven animation and a change tape.
- Details panel: purpose, source location with preview, open in editor, calls / used by, symbols.
- Trace (downstream) and Impact (upstream) over the architecture graph.
- Search, category filters, fit, keyboard navigation.

### Planned (see [Implementation Plan](../06-implementation-plan/README.md))

- Collapse/expand groups and semantic zoom (Phase 3).
- Shortest path between two components; code-level impact (Phase 4).
- Optional graph-backed AI summaries and Q&A, local models first (Phase 5).
- Git overlays, branch/commit architecture diffs, timeline (Phase 6).
- Agent-session attribution and an MCP surface for agents (Phase 7).
- Electron desktop app (Electron Forge) with the engine in a utility process; a first version is in `apps/desktop`.

### Explicitly out of scope

- Any cloud component, account system, or telemetry.
- AI as a source of truth for whether a dependency exists.
- Languages beyond TypeScript/JavaScript for now.
- Control-flow analysis (so: no branch/retry/terminal-state workflow views).
- Editing code from the map. Eyrie reads; your editor writes.

## 5. Feature requirements and acceptance criteria

| Feature | Requirement | Acceptance criteria |
| --- | --- | --- |
| Index a repository | Scan, parse and graph a TS/JS repo from a single command | `pnpm start -- <repo>` reaches `status: ready` and opens the UI with a non-empty architecture graph; a second run reuses the cache |
| Architecture map | Show 20–50 components for a typical app, arranged in request order | Components appear in correct lanes; presentational components, hooks and SDK wrappers are lifted out and edges pass through them |
| Semantic colour | Category is readable at a glance | Each node renders its category colour; a frontend `fetch('/api/x')` with no matching route renders as `broken` (red) |
| Data flow lens | Keep only components that touch data; colour edges by what they carry | Pressing `2` yields a graph where every edge is classified `read`, `write`, `readwrite`, `transfer` or `carry`; reads point out of the store |
| Sequence lens | Lay one entry point's calls out as a sequence diagram | Pressing `3` renders lifelines and ordered messages, each with file and line; clicking a message opens the editor at that line |
| 3D city view | Same graph as perspective city, height = LOC | `V` toggles; lanes become districts; blocks rise lane by lane; `T` gives a top-down plan, `R` resets |
| Live updates | Re-index only what changed and animate the diff | Saving a file produces a `batch` message within a few seconds; new nodes get a green halo and `+`, edited `~`, removed `−`; existing components keep their layout position |
| Incremental correctness | A change must invalidate exactly its dependents | Editing a file re-resolves that file, plus the files that consulted it only when its exported surface changed |
| Change tape | Every save is recorded and navigable | Each save adds a tick sized by change magnitude; hover highlights what it touched; click jumps there |
| Details panel | Explain one component without leaving the map | Clicking a node shows purpose (doc comment or derived), source ref, code preview, callers, callees and contained symbols |
| Trace and impact | Answer "what does this reach" and "what breaks" | *Depends on* animates the downstream path; *Impact* lists upstream components grouped into API, UI, services, data, external |
| Search | Find a component by name or path | `⌘K` or `/` opens search; `Enter` selects the first result; `Esc` closes |
| Open in editor | Jump from the map to the code | `POST /api/open` launches the first of `cursor`, `code`, `windsurf`, `zed` found on `PATH`, or the editor named by `EYRIE_EDITOR`, at the right line |
| Privacy | No code leaves the machine | No outbound requests at runtime; fonts bundled; server bound to `127.0.0.1`; non-local `Host` rejected with 403; API requires the per-run token |
| Source safety | Only indexed files are readable | `GET /api/source` serves a file only if it is in the index; `.env`, keys and git-ignored paths are unreachable |

## 6. Content requirements

Eyrie has no editorial content. The text users read is derived from their own repository:

- **Component purpose** — the doc comment on a component's main export, or a description derived from the code. Documented behaviour: adding a doc comment to the main export sets the description.
- **Lane and category names** — fixed vocabulary owned by this project (`ui`/`edge`/`api`/`logic`/`data`/`external`; `frontend`/`api`/`service`/`ai`/`data`/`external`/`infra`/`utility`).
- **Product-facing prose** — `README.md` and these six documents, owned by the maintainer.

## 7. Success measures

| Measure | Target |
| --- | --- |
| Time to first useful map on an unfamiliar repo | Under a minute on a ~300-file project |
| Architecture graph size for a typical app | 20–50 components (small enough to read on one screen) |
| Live update latency after save | Change visible in the map within a couple of seconds |
| Survives code nobody wrote for it | `pnpm smoke` scans a ~290-file third-party Next.js repo without errors and with a healthy graph shape |
| Determinism | Same commit ⇒ same graph; node ids stable across unrelated edits |
| Trust | Zero fabricated edges: every edge traces to a parsed fact with a confidence score |

## 8. Assumptions

- The repository is a git checkout on the user's machine, written in TS/JS, and uses conventions Eyrie can recognise (Next.js App/Pages Router, Express-style routers, `*Service`/`*Repository`, Prisma/Drizzle/Mongoose/Supabase).
- Node.js 22.13+ and pnpm 9 are available.
- One repository per running engine; one user per engine.
- Heuristic classification is acceptable so long as it is inspectable and overridable by a doc comment.

## 9. Open questions

- Should classification rules be user-extensible (a config file of lane/category rules) before Phase 5, given that non-Next.js layouts need tuning?
- Does Phase 5 AI stay strictly local (Ollama), or is an opt-in remote model acceptable given the privacy promise?
- Express router prefixes (`app.use('/api', router)`) are not joined to their routes yet — is that a Phase 3 correctness fix or a known limitation we document and defer?
- Is the desktop (Electron) app a prerequisite for a wider release, or does the CLI remain the primary distribution?

## Completion checklist

- [x] Goals and intended users are clear.
- [x] First-release scope is agreed and separated from planned work.
- [x] Each required feature has acceptance criteria.
- [x] Content ownership and unresolved decisions are recorded.
