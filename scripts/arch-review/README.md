# Architecture review (`pnpm arch`)

A repeatable architecture review for this repository, with a shared record that people and AI agents add to over time.

- **Deterministic checks** find structural problems that need no design document: package cycles, Node built-ins reachable from the browser bundle, undeclared or unused dependencies, relative imports across packages, untested packages, file cycles, unreferenced files, unused or duplicated exports, unusually large files. They run on Eyrie's own code graph.
- **A durable database** (`.eyrie/knowledge.db`, SQLite, git-ignored) keeps every finding's history across scans, plus the issues, proposals, reviews and decisions people and agents add.
- **A report** (`pnpm arch report`) renders all of it as Markdown.

It is a dogfooding prototype of the knowledge store described in [docs/06-implementation-plan/feature-knowledge](../../docs/06-implementation-plan/feature-knowledge/README.md), kept outside the product packages until that design is settled.

## Commands

```bash
pnpm arch scan                 # index, run every check, record results
pnpm arch report --out .eyrie/architecture-report.md
pnpm arch list                 # present findings; also: list issues | list proposals | list findings --all
pnpm arch show <fingerprint>   # evidence and history; also: show issue:<id> | show proposal:<id>
pnpm arch help
```

Add `--root <repo>` to review another repository; its database then lives in that repository's `.eyrie/` folder, which should be git-ignored there too.

## How findings change over time

Each finding has a fingerprint built from its check and its subjects, never from line numbers, so it keeps its identity across edits and restarts. On every scan a finding is one of:

| State | Meaning |
| --- | --- |
| `present` | The check produced it in the latest scan |
| `absent`, event `resolved` | The same check logic stopped producing it: the code changed |
| `absent`, event `retired` | It disappeared because the check logic changed (`CHECKS_VERSION`). This is not evidence of a repair |
| `unknown` | Its check failed in the latest scan; nothing is known either way |

Triage verdict (`confirmed`, `intended`, `mapping-wrong`, `detector-wrong`) and baseline membership are separate fields. A triaged finding stays in the record; it only leaves `present` when the code or the check changes.

## Protocol for AI agents

Any coding agent (Claude Code, Codex, Antigravity, or others) can take part. Follow these rules:

1. **Start from the record.** Run `pnpm arch scan`, then read `pnpm arch report` or `pnpm arch list issues` and `pnpm arch list proposals`. If a problem is already recorded, review the existing proposal instead of adding a duplicate.
2. **Identify yourself** with `--by <tool>:<model>`, for example `--by codex:<model-name>`. The name is stored with everything you add.
3. **Cite evidence for every claim.** Pass `--evidence path:line` or `path:start-end`, once per location. The CLI rejects files and lines that do not exist and fingerprints the cited lines, so later readers can see if they changed. Cite the lines that prove the claim, not just the file.
4. **Findings come only from `scan`.** Record a suspected problem the checks do not cover as an issue (`pnpm arch issue …`). Never edit the database directly.
5. **Separate structure from behaviour.** Static analysis shows what depends on what. A claim about runtime behaviour (performance, ordering, error handling) needs a test or measurement as evidence, or must be written as a hypothesis.
6. **Proposals say what would change and how you'd know.** Target a finding (`finding:<fingerprint>`), an issue (`issue:<id>`) or `architecture`. An architecture proposal states the target structure, the rules that keep it true, migration steps in order, and which findings and issues it resolves. Include the command that would verify the change.
7. **Review other agents' proposals:** `pnpm arch review <id> --verdict agree|disagree|needs-evidence --note …`. You cannot review your own.
8. **People decide.** Triage, issue status and accepting or rejecting proposals require `--by human:<name>`.

Example:

```bash
pnpm arch issue --by codex:<model> --severity warning \
  --title "Server imports engine internals" \
  --description "…what is wrong and why it matters…" \
  --evidence packages/server/src/server.ts:7
```

## For people

```bash
pnpm arch triage <fingerprint> --verdict intended --note "Deliberate: …" --by human:<name>
pnpm arch decide <proposal-id> --status accepted --note "Do it before K0" --by human:<name>
pnpm arch issue-status <id> --status fixed --note "Fixed in <commit>" --by human:<name>
```

Accepting a proposal also records it as a decision, so the reasoning outlives the change.

## Limits

- Checks cover `packages/` and `apps/`; `fixtures/` (a separate test application) and `docs/` are out of scope.
- Resolution is Eyrie's, so the checks inherit its limits (see the repository README's Known limitations). Imports are resolved per statement here, because the code graph merges all imports between two files into one edge.
- `symbol.*` checks look at exported functions, classes and values, not types.
- `file.large` is a review prompt, not a defect.
