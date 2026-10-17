# Eyrie desktop (`@eyrie/desktop`)

An Electron shell, built with [Electron Forge](https://www.electronforge.io/) and its Vite plugin. It adds no UI of its own: it runs the same engine and local server as the `eyrie` CLI and shows the web UI that server serves.

```
main process (src/main.ts)            utility process (src/engine-host.ts)
  window, menu, folder picker   ──►     launch() from @eyrie/server:
  loads http://127.0.0.1:<port>/?token  engine + HTTP/WebSocket server
                                        (loopback, random port, per-run token)
```

- **Same protections as the CLI.** The server binds `127.0.0.1` on a random port with a random token, and keeps its `Host` check. The window may only navigate to that origin; other links open in the default browser.
- **Indexing never blocks the window.** The engine runs in an Electron `utilityProcess`, not the main process.
- **One repository at a time.** Choose it at start, or with File → Open Repository… (`⌘O` / `Ctrl+O`). Closing the window stops the engine and quits.
- **Shared cache.** The parse cache is the CLI's, in `~/.eyrie/repos/<hash>/graph.db` (`EYRIE_HOME` overrides it).

## Commands

From the repository root:

```bash
pnpm desktop                                                    # pick a repository in a dialog
pnpm --filter @eyrie/desktop start -- ../../fixtures/bookstore-app  # open one directly
pnpm --filter @eyrie/desktop package                            # out/Eyrie-<platform>-<arch>/
pnpm --filter @eyrie/desktop make                               # installers: zip (macOS), Squirrel (Windows), deb (Linux)
```

Each of these first runs `pnpm resources`, which builds the web UI and copies it, with tree-sitter's WASM files, into `resources/`. The first run downloads the Electron binary.

## How it is built

| File | Role |
| --- | --- |
| `forge.config.mts` | Packaging, makers, the Vite plugin's two build targets, and Electron fuses |
| `vite.main.config.mts` | Main process → `.vite/build/main.cjs` (the plugin's defaults) |
| `vite.host.config.mts` | Engine host → `.vite/build/engine-host.mjs`, an ES module: `@eyrie/storage` loads `node:sqlite` with a top-level await |
| `scripts/prepare-resources.ts` | Fills `resources/web` and `resources/grammars`, which ship as extra resources next to `app.asar` |

Everything the app runs is bundled by Vite, so every package is a dev dependency and no `node_modules` ships with the app. Two settings make this work:

- **`node:sqlite`.** Electron 44 runs Node 24, which has `node:sqlite` without a flag. Nothing else in the engine is native: tree-sitter is WASM.
- **Grammar files.** A bundle has no `node_modules` to resolve WASM grammars from, so the main process sets `EYRIE_GRAMMAR_DIR` to `resources/grammars` for the engine host. `@eyrie/parser` reads it on first use; `grammarFiles()` lists what to copy.

**pnpm.** Electron Forge refuses pnpm's default layout. The root `.npmrc` sets `public-hoist-pattern[]=*electron*`, which satisfies that check while every other package keeps pnpm's strict layout. Forge's documentation suggests `node-linker=hoisted`; it is not needed because packaging reads no `node_modules`.

## Not done yet

- No app icon, code signing or notarization. A signed binary is gated by the AGPL-3.0 / `elkjs` licensing review in [docs/06 §5](../../docs/06-implementation-plan/README.md).
- No auto-update, tray, background watching or notifications (see [feature-knowledge §12](../../docs/06-implementation-plan/feature-knowledge/README.md)).
- "Open in editor" relies on the login shell's `PATH`, read once when the packaged app starts; set `EYRIE_EDITOR` if your editor is not found.
- Tested on macOS (arm64): `package`, the packaged app on `fixtures/bookstore-app` with an empty cache, and `start`. Windows and Linux makers are configured but not yet run.
