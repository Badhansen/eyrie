# Eyrie desktop (`@eyrie/desktop`)

An Electron shell, built with [Electron Forge](https://www.electronforge.io/) and its Vite plugin. It runs the same engine and local server as the `eyrie` CLI and shows the web UI that server serves. Its one page of its own is **Projects**, where repositories are added, scanned and opened.

```
main process (src/main.ts)                 utility processes (src/engine-host.ts)
  window, menu, project list         ──►     start: launch() from @eyrie/server, engine + HTTP/WebSocket
  eyrie://app/projects.html                         server (loopback, random port, per-run token)
  loads http://127.0.0.1:<port>/?token       scan:  the engine alone, once, no server or watcher
```

- **Same protections as the CLI.** The server binds `127.0.0.1` on a random port with a random token, and keeps its `Host` check. The window may only navigate to that origin; other links open in the default browser.
- **Indexing never blocks the window.** The engine runs in an Electron `utilityProcess`, not the main process.
- **Projects.** The app starts on a list of the repositories added to it (unless one is passed on the command line). From there:
  - **Add project** opens a folder picker (several folders at once), or drop folders anywhere on the window. A new project is scanned straight away.
  - **Scan** indexes a project without opening it: it parses what changed since the last index, refreshes the shared cache and records what it found (files, symbols, components, links, frameworks, how long it took). **Scan all** queues every project; two scans run at a time, each in its own utility process. **Stop** ends one; the cache is written in a single transaction, so it is left as it was.
  - **Open** (or double-click) runs the engine and shows the map. The map's top bar gets a **‹ Projects** button, and File → Projects (`⇧⌘P` / `Ctrl+Shift+P`) returns too. The open project keeps running in the background, so **Return** is instant; **Close** stops it.
  - **⋯** (or right-click a row) shows a native menu: Rescan from Scratch (ignores the cache), Open in Cursor / VS Code / Windsurf / Zed (or `EYRIE_EDITOR`), Show in Finder, Copy Path, Remove from List. Removing never touches the folder or its cache.
- **One open project at a time.** File → Open Project… (`⌘O` / `Ctrl+O`) adds a folder and opens it. Closing the window stops every engine and quits.
- **Shared cache.** The parse cache is the CLI's, in `~/.eyrie/repos/<hash>/graph.db` (`EYRIE_HOME` overrides it). The project list is the app's own: `projects.json` in its user-data folder (`~/Library/Application Support/Eyrie` on macOS).
- **The Projects page is part of the web UI** (`apps/web/projects.html`), built with it and served from `resources/web` as `eyrie://app/projects.html`. A sandboxed preload (`src/preload.ts`) gives that page the project calls, and gives the engine's pages only `showProjects`; the main process also checks the sender of every project call. The contract is `src/bridge.ts`, mirrored for the page in `apps/web/src/lib/desktop.ts`.

## Commands

From the repository root:

```bash
pnpm desktop                                                    # start on the Projects page
pnpm --filter @eyrie/desktop start -- ../../fixtures/bookstore-app  # open one directly
pnpm --filter @eyrie/desktop package                            # out/Eyrie-<platform>-<arch>/
pnpm --filter @eyrie/desktop make                               # installers: zip (macOS), Squirrel (Windows), deb (Linux)
pnpm --filter @eyrie/desktop icons                              # re-render assets/icon.{icns,ico,png} after editing the SVGs
```

Each of these but `icons` first runs `pnpm resources`, which builds the web UI and copies it, with tree-sitter's WASM files and the icon, into `resources/`. The first run downloads the Electron binary.

## How it is built

| File | Role |
| --- | --- |
| `forge.config.mts` | Packaging, the icon, makers, the Vite plugin's build targets, and Electron fuses |
| `vite.main.config.mts` | Main process → `.vite/build/main.cjs` (the plugin's defaults) |
| `vite.host.config.mts` | Engine host → `.vite/build/engine-host.mjs`, an ES module: `@eyrie/storage` loads `node:sqlite` with a top-level await |
| `src/preload.ts` | The window's sandboxed preload → `.vite/build/preload.cjs` (Forge's preload target, with `vite.main.config.mts`) |
| `src/projects.ts` | The project list (`ProjectStore`): JSON in the user-data folder, written atomically; tested in Node |
| `scripts/prepare-resources.ts` | Fills `resources/web`, `resources/grammars` and `resources/icon.png`, which ship as extra resources next to `app.asar` |
| `assets/icon.svg`, `assets/icon-small.svg` | The app icon's source: the favicon's request trace on the macOS icon grid. The small one, with heavier strokes and no background graph, is drawn at 16 and 32 pt |
| `scripts/make-icons.mjs` | `pnpm icons`: draws both SVGs with Electron and writes `assets/icon.icns` (macOS), `icon.ico` (Windows, cropped to the body) and `icon.png` (Linux and the window, 512 px). It writes the ICNS and ICO containers itself, so it needs no other tools |

Everything the app runs is bundled by Vite, so every package is a dev dependency and no `node_modules` ships with the app. Two settings make this work:

- **`node:sqlite`.** Electron 44 runs Node 24, which has `node:sqlite` without a flag. Nothing else in the engine is native: tree-sitter is WASM.
- **Grammar files.** A bundle has no `node_modules` to resolve WASM grammars from, so the main process sets `EYRIE_GRAMMAR_DIR` to `resources/grammars` for the engine host. `@eyrie/parser` reads it on first use; `grammarFiles()` lists what to copy.

**pnpm.** Electron Forge refuses pnpm's default layout. The root `.npmrc` sets `public-hoist-pattern[]=*electron*`, which satisfies that check while every other package keeps pnpm's strict layout. Forge's documentation suggests `node-linker=hoisted`; it is not needed because packaging reads no `node_modules`.

## Not done yet

- No code signing or notarization. A signed binary is gated by the AGPL-3.0 / `elkjs` licensing review in [docs/06 §5](../../docs/06-implementation-plan/README.md).
- Scans report no progress while they run, only elapsed time: the engine indexes in one pass and logs once at the end.
- No auto-update, tray, background watching or notifications (see [feature-knowledge §12](../../docs/06-implementation-plan/feature-knowledge/README.md)).
- "Open in editor" relies on the login shell's `PATH`, read once when the packaged app starts; set `EYRIE_EDITOR` if your editor is not found.
- Tested on macOS (arm64): `package`, the packaged app on `fixtures/bookstore-app` with an empty cache, and `start`. Windows and Linux makers are configured but not yet run.
