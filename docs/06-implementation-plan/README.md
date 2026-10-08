# 06 — Implementation Plan

| Field | Value |
| --- | --- |
| Product | Eyrie |
| Owner | Badhan Sen (sole maintainer; owner and reviewer of every phase) |
| Status | Phases 1–2 complete · 3–4 partial · 5–7 planned |
| Last updated | 2026-10-08 |
| Answers | What gets built first, and how is progress verified? |
| Related | [PRD](../01-product-requirements/README.md) · [TRD](../02-technical-requirements/README.md) · [Backend Schema](../05-backend-schema/README.md) |

**On dates:** this plan is sequenced by dependency and completion condition, not by calendar. There is one maintainer and no external commitment, so estimates would be fiction. Phases are ordered; each has a condition that decides whether it is done.

## 1. Phase sequence

| Phase | Deliverable | Completion condition | State |
| --- | --- | --- | --- |
| **1. Static architecture map** | Scanner, tree-sitter parsing, symbols, imports/exports, calls, React + Next.js detection, code graph, architecture graph, D3 map, details panel | A TS/JS repo indexes from one command and renders a readable lane-ordered map with working details | ✅ Done |
| **2. Live graph** | File watcher, incremental resolution with reverse-dependency invalidation, graph diffs, WebSocket events, animated updates, stable layout, change tape | Saving a file updates only the affected region, animates the diff, and leaves unchanged components in place | ✅ Done |
| **3. Navigation** | Search, open in editor, jump to line, category filters, data-flow and sequence lenses · **remaining:** collapse/expand groups, semantic zoom | A large repo stays readable: the user can reduce the map to the part they care about | 🟡 Partial |
| **4. Graph intelligence** | Trace (downstream) and impact (upstream) on the architecture graph · **remaining:** shortest path between two components, code-level impact | "What breaks if I change this" is answerable at both architecture and symbol level | 🟡 Partial |
| **5. AI understanding** | Optional graph-backed summaries and Q&A, local models (Ollama) first | AI answers cite graph nodes and never introduce an edge; works with AI entirely disabled | ⬜ Planned |
| **6. Git intelligence** | Working-tree overlays, branch and commit architecture diffs, timeline; `snapshots` schema filled in | "What changed architecturally on this branch" renders as a diff of the map | ⬜ Planned |
| **7. Coding-agent integration** | Attribute changes to agent sessions (e.g. Claude Code hooks); expose the graph to agents over MCP | A change can be traced to the agent session that made it; an agent can query the graph | ⬜ Planned |
| **D. Desktop app** | Tauri shell around the same UI, engine as a sidecar | Installable app, no pnpm or Node setup required of the user | ⬜ Planned |

Phases 3 and 4 can proceed in parallel — they touch different layers (UI reduction vs. graph queries). Phase 5 must not start before 4, because AI is only allowed to annotate a graph that already answers structural questions on its own.

## 2. Dependencies

| This work | Needs first | Why |
| --- | --- | --- |
| Semantic zoom / grouping (3) | Stable architecture graph + stable node ids (1, 2) | Collapsing must survive live updates without losing identity |
| Code-level impact (4) | `edges_target` index and `owner` tracking (1, 2) | Upstream traversal and invalidation share the same machinery |
| AI summaries (5) | Trace + impact (4) | The graph must be the authority the model is grounded in |
| Git diffs (6) | Stable node ids (1) and a defined `snapshots.metadata` shape (5 doc) | Comparing two commits means comparing two sets of stable ids |
| Agent attribution (7) | Change tape + batch `seq` (2) | Attribution hangs off the existing change record |
| MCP surface (7) | Graph query API (1, 4) | MCP exposes queries that must already exist internally |
| Desktop shell (D) | A stable CLI contract (1) | The sidecar is the CLI |
| Any public release | Classification-configurability decision (PRD open question) | Non-Next.js repos currently need rule tuning we cannot ask users to do |

## 3. Blocking decisions

These are the PRD/TRD open questions, restated as things that gate work:

1. **Are classification rules user-extensible?** Blocks a wider release. Without it, repos outside Next.js/Node.js conventions produce a weak map and the user has no recourse beyond doc comments.
2. **Does Phase 5 permit any non-local model?** Blocks Phase 5 design. "No network calls" is currently a product claim in the README; an opt-in remote model would require rewording it precisely rather than quietly.
3. **Express router prefixes** (`app.use('/api', router)` not joined to the router's routes) — correctness fix in Phase 3, or documented limitation? Currently documented.
4. **Is the Tauri shell a release prerequisite,** or does the CLI remain the distribution channel?

## 4. Validation

Validation is continuous, not a phase. Three layers, each answering a different question:

| Layer | Command | Question it answers |
| --- | --- | --- |
| Unit / integration | `pnpm test` | Does resolution behave as specified? Hermetic and offline against `fixtures/bookstore-app`, where **every asserted edge is a claim about how resolution should behave**. Covers parser, graph, architecture, lens, engine (with a real file watcher) and server |
| Real-world smoke | `pnpm smoke:fetch` once, then `pnpm smoke` | Does Eyrie survive code nobody wrote for it? Scans a ~290-file third-party MIT-licensed Next.js app cloned into the git-ignored `.smoke/`, asserting graph **shape and health** rather than specific edges. No third-party code is vendored |
| Types | `pnpm typecheck` | Monorepo + web app type-clean |

**Per-phase gates, in addition to green tests:**

| Phase | Gate |
| --- | --- |
| 3 | Collapse/expand survives a live update without losing selection or layout stability |
| 4 | Impact results verified by hand against the fixture, and spot-checked on the smoke repo |
| 5 | AI disabled is a fully functional product; every AI answer cites graph nodes; no AI-derived edge ever enters the graph |
| 6 | A commit-to-commit architecture diff reproduces exactly when re-run (determinism) |
| 7 | Agent attribution does not alter the graph itself; MCP exposes read-only queries |
| D | Desktop build runs the engine as a sidecar with the same token and `Host` protections |

**Manual checks that no test covers:** reduced-motion behaviour, both colour schemes, focus visibility, and the keyboard paths listed in the [Design Brief](../04-design-brief/README.md) §9. These should be walked before any release that touches the UI.

## 5. Release preparation

Eyrie installs from source today (`pnpm install` → `pnpm start`), so "release" means a tagged, documented state of the repository.

- [ ] `pnpm test`, `pnpm smoke` and `pnpm typecheck` green.
- [ ] `README.md` roadmap, "What is detected" table and **Known limitations** match reality — limitations are a feature of the product's honesty, not a backlog to hide.
- [ ] These six documents updated for anything that changed.
- [ ] `SCHEMA_VERSION` / `facts_version` bumped if storage or facts shapes moved (see [Backend Schema](../05-backend-schema/README.md) §7) — a missed bump leaves users with a silently stale cache.
- [ ] Privacy claims re-verified by inspection: no outbound requests, fonts bundled, `127.0.0.1` bind, token required, non-local `Host` rejected, `/api/source` index-only.
- [ ] AGPL-3.0 obligations understood for any derivative or hosted variant; `LICENSE` present.
- [ ] Fresh-clone install tested on a clean machine with Node 22.13 and pnpm 9.
- [ ] First-run experience checked on a large repository (single-threaded parse is slow once, fast after).

**Before any public launch** — a landing page, a hosted demo, or distributing a signed desktop build — clear the open actions in the [Launch Readiness review](../07-launch-readiness/README.md). That review is the 20-point pre-launch checklist completed against Eyrie; its current decision is **Hold**, with eight open actions. The ones that gate a launch: publish an operator identity and contact, add `SECURITY.md`, state explicitly that no data is collected, fix the two failing contrast tokens, run one screen-reader pass, and add `THIRD-PARTY-NOTICES.md` (the bundled OFL fonts ship without their licence today). One item — whether AGPL-3.0-only combines soundly with `elkjs` under its GPL-3.0-or-later option — needs specialist review before any binary is distributed, so it gates Phase D rather than a source release.

## 6. Rollback

- **Users:** the previous tag still works; nothing is hosted, so there is nothing to roll back centrally.
- **Cache incompatibility:** `--reset`, or delete `~/.eyrie/repos/<hash>/`. This is the recovery path for every storage-shaped bug.
- **Bad release:** revert the tag. There is no migration to unwind, because the database is disposable by design.

## 7. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Heuristic classification misreads an unfamiliar repo | The map looks wrong, which costs trust faster than an empty map would | Smoke test on real third-party code; doc comments as an override; consider configurable rules (decision 1) |
| Syntactic resolution misses DI / dynamic dispatch | Missing or low-confidence edges, silently | Confidence on every edge; documented in Known limitations; a type checker is the real fix and is out of scope |
| Sequence view read as runtime truth | A user trusts an order that conditionals, loops or `await` can change | Stated plainly in Known limitations; the view names its basis (source line order) |
| Single-threaded parsing on very large repos | Slow first run; a user may quit before it finishes | Facts cache makes later runs fast; parallel parsing is the obvious future fix |
| Phase 5 erodes the determinism promise | The core differentiator is lost | Hard rule: AI annotates, never writes edges; AI-off must remain fully functional |
| Missed `SCHEMA_VERSION` bump | Users run on a stale cache and see wrong results | Contributor rule in the Backend Schema doc; include in the release checklist |
| Sole maintainer | Bus factor of one | Keep these six documents current — they are the handover |
| AGPL deters some adopters | Narrower adoption | Deliberate: it keeps derivative *network services* open. Local use carries no obligation |

## 8. Handover and operating notes

| Task | How |
| --- | --- |
| Run against a repo | `pnpm install` then `pnpm start -- /path/to/repo` |
| Develop | `pnpm dev`, then open `http://localhost:5173/?token=dev` (engine on `:4319`, fixture repo) |
| Test | `pnpm test` · `pnpm typecheck` · `pnpm smoke:fetch` + `pnpm smoke` |
| Where state lives | `~/.eyrie/repos/<hash>/graph.db` (`EYRIE_HOME` to relocate) |
| Choose an editor for jump-to-line | `EYRIE_EDITOR`, else first of `cursor`, `code`, `windsurf`, `zed` on `PATH` |
| Exclude paths from indexing | `.gitignore` and `.eyrieignore` |
| Debug a wrong edge | Find the node's readable `key` (`<path>#<kind>:<qualifiedName>`), inspect `edges.owner` and `confidence` in the database |
| Change storage shape | Bump `SCHEMA_VERSION`; parser output shape → bump `facts_version` |
| Add a language | New adapter in `@eyrie/parser` emitting the same `FileFacts`; resolution and architecture rules follow |
| Add a component category | Extend `ArchCategory` + a `.cat-*` token in **both** colour schemes (Design Brief §10) |

**Where the real documentation lives:** the repository [`README.md`](../../README.md) is the user-facing truth about what works today — what is implemented, what is detected, and what the known limitations are. The documents in [`docs/`](../README.md) sit behind it and say why. The original design document (written when the project was called "CodeGraph") is not part of the repository; `.gitignore` still carries an entry for `docs/design.md`, which can be removed once it is clear nothing will be put back there.

## Completion checklist

- [x] Phases have deliverables and completion conditions.
- [x] Dependencies and blocking decisions are explicit.
- [x] Validation is defined per layer and per phase.
- [x] Rollback, risks and handover are documented.
- [x] Launch prep points at the pre-launch legal checklist.
- [ ] Open: no dates or estimates — deliberate, one maintainer, no external commitment.
