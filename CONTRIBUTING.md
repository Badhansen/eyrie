# Contributing to Eyrie

Thanks for your interest. Eyrie is early and moves quickly, so a short conversation before a large change saves everyone time.

## Before you start

- **Bugs:** [open an issue](https://github.com/eyrie-hq/eyrie/issues/new/choose) with the repository shape that triggers it (a minimal reproduction is ideal) and what the map showed versus what you expected.
- **Features, new languages or frameworks:** open an issue first to agree on scope.
- **Small fixes** (typos, docs, an obviously wrong edge): send a pull request directly.
- **Security problems:** do not open an issue. Follow [SECURITY.md](SECURITY.md).

Everyone taking part agrees to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

Requirements: Node.js 22.13 or newer and pnpm 9.

```bash
pnpm install
pnpm dev           # engine on :4319 (fixture app, token "dev") + UI with hot reload on :5173
```

Then open `http://localhost:5173/?token=dev`. To run Eyrie against another repository: `pnpm start -- /path/to/repo`.

## Checks

CI runs these on every pull request. Run them locally first:

```bash
pnpm typecheck
pnpm test          # hermetic and offline: parser, graph, architecture, lens, engine and server
pnpm build         # builds the web UI
```

Optional, when you change resolution or classification:

```bash
pnpm smoke:fetch   # clone a real MIT-licensed Next.js app into .smoke/ (once)
pnpm smoke         # scan it end to end
```

## How the code is organised

See [Development](README.md#development) in the README for the package layout and [How it works](README.md#how-it-works) for the pipeline. The product documents in [`docs/`](docs/README.md) go deeper.

A few rules that keep the map trustworthy:

- **Every edge comes from a parsed fact.** No guessing, no AI in the pipeline. If resolution is uncertain, lower the edge's confidence rather than inventing a target.
- **Facts depend only on file content.** They are cached by hash, so an extractor must not read other files or the environment.
- **Node ids must stay stable** across edits (`repository + file path + symbol kind + qualified name`). Changing what goes into an id reshuffles every user's layout.
- **Tests assert intent.** `fixtures/bookstore-app` is hand-written; each asserted edge is a claim about how resolution *should* behave. Add a case there, or to `packages/*/test/languages.test.ts` for other languages, with every behaviour change.
- **No third-party code is vendored.** Fixtures are written for this project; real repositories are cloned into the git-ignored `.smoke/` only.

### Adding a language

Add its tree-sitter grammar to `packages/parser`, register the extension in `languages.ts`, and write an extractor on top of `BaseExtractor` (`packages/parser/src/base.ts`) that emits the same facts as the others. Then teach `ModuleResolver` (`packages/graph/src/resolver.ts`) how its imports map to files, and add a small in-memory app to the `languages.test.ts` files. Nothing else needs to know about the language.

## Pull requests

- Keep each pull request to one change, and explain the *why* in the description.
- Update `README.md` (and the affected document in `docs/`) in the same pull request when behaviour, supported frameworks or known limitations change.
- Add a dependency only when it is needed, pin its exact version like the others, and check its licence is compatible with AGPL-3.0. Anything that ends up in the built UI needs an entry in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
- Eyrie makes no network requests. A change that adds one (telemetry, update checks, a CDN, a remote model) needs discussion in an issue first.

## Licence

Eyrie is licensed under [AGPL-3.0-only](LICENSE). By submitting a contribution you agree that it is licensed under the same terms.
