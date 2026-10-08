# 05 — Backend Schema Document

| Field | Value |
| --- | --- |
| Product | Eyrie |
| Owner | Badhan Sen |
| Status | Matches `packages/storage/src/index.ts` at `SCHEMA_VERSION = '1'` |
| Last updated | 2026-10-08 |
| Answers | How is data stored, related and accessed? |
| Related | [TRD](../02-technical-requirements/README.md) · [Implementation Plan](../06-implementation-plan/README.md) |

## 1. What data exists — and what deliberately does not

Eyrie stores **no personal data, no accounts, no content of its own**. The only persistent store is a local, disposable cache of analysis derived from the user's own repository.

| Not stored | Why |
| --- | --- |
| Users, sessions, credentials | There is no account system; the trust boundary is the OS user (see TRD §8) |
| Anything on a server we operate | Nothing leaves the machine |
| Telemetry or usage data | No network calls at all |

**Durable truth lives in the repository, which Eyrie never writes to.** Everything in the database can be deleted and rebuilt from source. That is the governing property of this schema.

## 2. Storage engine and location

| Property | Value |
| --- | --- |
| Engine | SQLite via Node's built-in `node:sqlite` (`DatabaseSync`) — no native module |
| File | `~/.eyrie/repos/<hash>/graph.db`, where `<hash>` identifies the repository root |
| Override | `EYRIE_HOME` relocates the whole store |
| Pragmas | `journal_mode = WAL`, `synchronous = NORMAL` |
| Tests | Opened as `:memory:` |
| Access | One engine process per database; single writer, no concurrency protocol needed |

Row shapes are "columns for querying, JSON for fidelity": indexed scalars are promoted to real columns, and the full typed object is kept in a `data` / `facts` TEXT column so nothing is lost to a lossy projection.

## 3. Tables

### `meta` — compatibility knobs

| Column | Type | Notes |
| --- | --- | --- |
| `key` | TEXT | **PK** |
| `value` | TEXT | NOT NULL |

Two keys matter: `schema_version` (table shape) and `facts_version` (parser output shape). See §7.

### `repositories` — the indexed repository

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT | **PK** — stable repository id |
| `name` | TEXT | NOT NULL — from root `package.json` `name`, else directory basename |
| `root_path` | TEXT | NOT NULL — absolute path on this machine |
| `created_at` | INTEGER | NOT NULL — epoch ms |
| `updated_at` | INTEGER | NOT NULL — epoch ms |

Upserted on every run (`ON CONFLICT(id)` refreshes `name`, `root_path`, `updated_at`). The schema permits several repositories per database; in practice each repository gets its own file.

### `files` — the facts cache

| Column | Type | Notes |
| --- | --- | --- |
| `repo_id` | TEXT | NOT NULL — **PK** part |
| `path` | TEXT | NOT NULL — **PK** part, repo-relative POSIX path |
| `language` | TEXT | From the parsed facts |
| `hash` | TEXT | NOT NULL — content hash; **the cache key** |
| `size` | INTEGER | Bytes |
| `mtime` | INTEGER | Rounded epoch ms |
| `last_parsed` | INTEGER | Epoch ms of the parse that produced `facts` |
| `facts` | TEXT | NOT NULL — JSON `FileFacts` |

**PK `(repo_id, path)`.** This table is why restarts are fast: facts depend only on file content, so a matching `hash` means the parse can be skipped entirely.

### `nodes` — code-graph nodes

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT | NOT NULL — **PK** part; stable hash (see §5) |
| `repo_id` | TEXT | NOT NULL — **PK** part |
| `file` | TEXT | Nullable — defining file; null for repository/external nodes |
| `kind` | TEXT | NOT NULL — `CodeNodeKind` (§4) |
| `name` | TEXT | NOT NULL |
| `qualified_name` | TEXT | NOT NULL |
| `start_line` | INTEGER | Nullable |
| `end_line` | INTEGER | Nullable |
| `data` | TEXT | NOT NULL — JSON `CodeNode` (includes `key`, `exported`, `meta`) |

**PK `(repo_id, id)`** · **INDEX `nodes_file (repo_id, file)`** — the index that makes "re-resolve one file" cheap.

### `edges` — code-graph edges

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT | NOT NULL — **PK** part |
| `repo_id` | TEXT | NOT NULL — **PK** part |
| `source_id` | TEXT | NOT NULL |
| `target_id` | TEXT | NOT NULL |
| `kind` | TEXT | NOT NULL — `CodeEdgeKind` (§4) |
| `confidence` | REAL | NOT NULL — `1` = syntactically certain, lower = heuristic |
| `owner` | TEXT | Nullable — the file whose facts produced this edge; drives invalidation |
| `data` | TEXT | NOT NULL — JSON `CodeEdge` (includes `line`, `meta`) |

**PK `(repo_id, id)`** · **INDEX `edges_source (repo_id, source_id)`** · **INDEX `edges_target (repo_id, target_id)`** — downstream traversal uses the first, upstream (impact) the second.

### `snapshots` — point-in-time markers

| Column | Type | Notes |
| --- | --- | --- |
| `id` | INTEGER | **PK AUTOINCREMENT** |
| `repo_id` | TEXT | NOT NULL |
| `commit_hash` | TEXT | Nullable |
| `created_at` | INTEGER | NOT NULL — epoch ms |
| `metadata` | TEXT | Nullable — JSON |

Written by `recordSnapshot()`. This is the forward hook for **Phase 6 (Git intelligence)**: architecture diffs between commits and the timeline view will read from here. It is intentionally thin until that phase defines what a snapshot must contain.

## 4. Vocabulary (enumerations)

These are string enums in `@eyrie/core`, enforced in TypeScript rather than by SQL constraints.

**`CodeNodeKind`** — `repository`, `folder`, `file`, `class`, `interface`, `type`, `enum`, `function`, `method`, `variable`, `react_component`, `hook`, `api_route`, `middleware`, `database_model`, `queue`, `event`, `background_job`, `external_service`

**`CodeEdgeKind`** — `CONTAINS`, `IMPORTS`, `EXPORTS`, `CALLS`, `USES`, `IMPLEMENTS`, `EXTENDS`, `DEPENDS_ON`, `HTTP_CALL`, `READS_FROM`, `WRITES_TO`, `PUBLISHES`, `SUBSCRIBES`, `TRIGGERS`

**Architecture layer (derived, not persisted):** `ArchKind` (`page`, `component`, `hook`, `middleware`, `api_route`, `server_action`, `service`, `repository`, `module`, `database_model`, `external_service`, `queue`, `background_job`), `ArchCategory` (`frontend`, `api`, `service`, `ai`, `data`, `external`, `infra`, `utility`), `ArchLane` (`ui`, `edge`, `api`, `logic`, `data`, `external`).

**The architecture graph is not stored.** It is derived deterministically from the code graph on every build, so it can never disagree with its source. The two lenses (data flow, sequence) are pure functions computed in the browser.

## 5. Keys and relationships

```text
repositories 1 ──┬─< files      (repo_id, path)
                 ├─< nodes      (repo_id, id) ── file ─► files.path  (soft)
                 ├─< edges      (repo_id, id) ── source_id/target_id ─► nodes.id  (soft)
                 │                            └─ owner ─► files.path (soft)
                 └─< snapshots  (repo_id)
```

- **Node ids are stable content-free hashes** of `repository + file path + symbol kind + qualified name`. Unchanged code keeps its identity across edits, which is what lets the UI animate a diff instead of re-rendering, and what makes layout stable.
- Nodes also carry a readable `key` (`<path>#<kind>:<qualifiedName>`, or a namespaced key for non-file nodes) for debugging and for cross-referencing by other tools.
- **Relationships are not declared as SQL foreign keys.** This is deliberate: an update is applied as a diff within one transaction, and ordering constraints (delete edges before nodes, write nodes before edges) are enforced in `applyDiff()`. Referential integrity is a property of the graph builder, not of the cache.
- `edges.owner` is the invalidation lever: when a file changes, the edges it produced can be found and replaced without touching anyone else's.

## 6. Write paths and consistency

Every mutation runs inside an explicit `BEGIN` / `COMMIT` with `ROLLBACK` on error.

| Operation | Behaviour |
| --- | --- |
| `upsertRepository` | Insert or refresh the repository row |
| `loadFiles` | Load the whole facts cache for a repo into memory as a `Map` |
| `saveFiles(files, removed)` | Upsert parsed files and delete removed paths, in one transaction; no-op when both are empty |
| `replaceGraph` | After a full build: delete all nodes and edges for the repo, then rewrite |
| `applyDiff` | Incremental: delete removed **edges first**, then removed nodes, then upsert added + updated nodes, then edges — so no edge ever references a node that has not been written |
| `recordSnapshot` | Append a snapshot row |
| `counts` | `files` / `nodes` / `edges` counts, surfaced as `stats` on `/api/state`, `hello` and every `batch` |

A crash mid-update leaves the previous committed state intact; the next run re-parses from the facts cache and rebuilds.

## 7. Schema changes and migration

There is no migration ladder, by design — **nothing here is durable truth, so rebuilding is always correct and always cheap relative to writing a migration.**

| Knob | Trigger | Effect |
| --- | --- | --- |
| `SCHEMA_VERSION` (`'1'`) | Table shape changes | `DROP` `repositories`, `files`, `nodes`, `edges`, `snapshots`, then recreate. Full re-index on next run |
| `facts_version` | Parser output shape changes | `DELETE FROM files` only — graph tables survive but every file is re-parsed |

`meta` is created before the version check and is never dropped, so the versions themselves always survive. All DDL is `CREATE TABLE IF NOT EXISTS`, making open-and-migrate idempotent.

**Rule for contributors:** changing any column, table or id-derivation requires bumping `SCHEMA_VERSION`; changing what the parser emits into `FileFacts` requires bumping `facts_version`. Forgetting either leaves users with a silently stale cache — the one genuinely user-visible failure mode this schema has.

## 8. Access control

There is no row-level security, because there is no multi-user surface. Access is controlled at two layers instead:

| Layer | Control |
| --- | --- |
| Filesystem | The database lives under the user's home directory with OS permissions. Only that user's processes can read it |
| Process | One engine owns the file; it is the only writer |
| Network | The API binds `127.0.0.1`, requires the random per-run token, and rejects non-local `Host` headers |
| Read surface | API exposes only derived graph data plus `GET /api/source` for files **already in the index** |
| Write surface | `POST /api/open` is the only mutating endpoint, and it only launches an editor on an indexed path |

**What is *not* in the index is not reachable.** Scanning honours `.gitignore` and `.eyrieignore`, so `.env` files, keys and build output are never parsed, never stored and never servable. This is enforced in the engine, not in the UI — hiding a control would not be access control.

## 9. Data lifecycle

| Concern | Policy |
| --- | --- |
| Retention | Indefinite but disposable; the cache is an optimisation, never a record |
| Deletion | Delete `~/.eyrie/repos/<hash>/` (or the whole `~/.eyrie/`). No orphaned state remains elsewhere |
| Reset without deleting | `--reset` ignores the cache and re-parses every file |
| Removed files | Dropped from `files` on the next scan; their nodes and edges are removed by the diff |
| Backups | **None needed and none taken.** Everything is derivable from the repository. The repository's own backups are the only ones that matter |
| Recovery | Delete the database and re-run. Expect a slower first index (parsing is single-threaded), then cached speed |
| Portability | The database contains absolute paths (`repositories.root_path`), so it is machine-local and not meant to be copied between machines |
| Growth | Roughly proportional to parsed file count; `facts` JSON dominates the file size |

## 10. If this ever gains real user data

It does not today, and this section exists so that the decision is deliberate rather than accidental. Any future feature that stores user-identifying data, a shared/remote graph, or AI prompt history would need: an explicit entity and field list here, retention and deletion rules, a privacy notice, and a fresh pass through [07 — Launch Readiness](../07-launch-readiness/README.md) items 5–8 (data mapping, privacy notice, retention, privacy requests), all four of which currently rest on there being no personal data at all. Until then, "no personal data" is the claim — and it must stay accurate in the README and in any marketing copy.

## Completion checklist

- [x] Stored data, fields and relationships are documented against the implementation.
- [x] Consistency rules (transactions, diff ordering, confidence) are defined.
- [x] Access control is described at every layer, and enforced in the backend.
- [x] Retention, deletion, backup and recovery are addressed.
- [x] Schema-change procedure is explicit (`SCHEMA_VERSION` / `facts_version`).
- [ ] Open: `snapshots.metadata` contents are undefined until Phase 6 specifies them.
