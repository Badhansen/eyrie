# 06·M — MCP in the desktop app

| Field | Value |
| --- | --- |
| Product | Eyrie |
| Owner | Badhan Sen |
| Status | **Proposed.** Deferred until after the first desktop release (v0.1.0). Nothing here is built |
| Last updated | 2026-10-23 |
| Answers | How does someone who installed the desktop app connect a coding agent to Eyrie, without a source checkout? |
| Related | [Implementation Plan](../README.md) · [Knowledge Loop §16, the agent guardrail](../feature-knowledge/README.md) · [`apps/desktop`](../../../apps/desktop/README.md) · [README: MCP](../../../README.md#use-it-from-a-coding-agent-mcp) |

## 1. Decision

Ship a **separate `eyrie` command** with the desktop app, and have each MCP server run its own engine, as `eyrie mcp` does from a checkout today. The desktop app itself does not become an MCP server.

A first version of this record (2026-10-21) reached the same decision, with transport spikes and a Windows CI workflow. None of it was committed and it is gone. This version keeps the decision, and re-measures what can be measured on the current code.

## 2. Why the app cannot be the server today

- **An agent starts an MCP server as a command** and talks to it over stdin and stdout (`claude mcp add eyrie -- <command>`, `mcpServers.<name>.command`). The installed app is a GUI program, not a command on `PATH`: on macOS it is inside `Eyrie.app`, on Windows Squirrel puts it under `%LOCALAPPDATA%\eyrie`, and only Linux puts one on `PATH` (`/usr/bin/eyrie-desktop`).
- **The app cannot run as Node.** Its Electron fuses switch off `RunAsNode` (see `apps/desktop/forge.config.mts`), deliberately: otherwise anything that can start the app could run arbitrary JavaScript as it. `eyrie mcp` is a Node program.
- **Starting Electron per agent session is slow**, and on Windows the app is a GUI-subsystem executable, whose stdio as a child of an agent is unverified.

## 3. Options

| Option | What it is | Verdict |
| --- | --- | --- |
| **A. Separate `eyrie` command** | A standalone executable built from `packages/server` (for example a Node single-executable application), installed with the app and put on `PATH`. Each MCP server runs its own engine, like `eyrie mcp` today | **Chosen** |
| B. The app's executable as the server | `Eyrie eyrie-mcp …` handled by the app's main process | Rejected: needs `RunAsNode` or an in-app stdio bridge, pays Electron's start-up per session, and puts an agent-facing protocol inside the GUI app |
| C. A thin proxy to the running app's engine | `eyrie mcp` connects over a per-user socket or pipe to the engine the app already runs | Deferred: shares one index, but needs authentication between processes, and the app must be running |

## 4. The shared cache must cope with several engines first

Option A means several engines on one project at once: the app's, and one per agent. They share the cache in `~/.eyrie/repos/<hash>/`.

**Measured 2026-10-23:** six engines started together on `fixtures/bookstore-app`, all on one cache folder. All six indexed it correctly (36 components each), but one ran with its cache switched off (`Cache disabled: database is locked`) and another could not save it (`Could not write cache: database is locked`). The cause is visible in the code: `packages/storage` opens SQLite with no `busy_timeout`, so a writer that meets another writer fails at once instead of waiting. The 2026-10-21 investigation also saw a server lose its whole index once, probably through the unguarded `loadFiles` read in `GraphEngine.start`; that was not reproduced this time.

**Fix, before any packaging work:** a busy timeout on the cache like `knowledge.db` already has, a guarded cache read that falls back to a full parse, and a test that runs several engines on one cache.

## 5. Where the command goes

| System | App | `eyrie` command (to decide) |
| --- | --- | --- |
| Linux | `/usr/bin/eyrie-desktop` | `/usr/bin/eyrie`, in the same package. The package was named `eyrie-desktop` so that this name stays free |
| macOS | `/Applications/Eyrie.app` | Inside the bundle, with a link the user creates from the app (a menu item), since `/usr/local/bin` needs administrator rights |
| Windows | `%LOCALAPPDATA%\eyrie\app-<version>\` (Squirrel) | A folder Squirrel's updates do not replace, added to the user's `PATH` |

The command must be signed with the app once the app is, or Gatekeeper and SmartScreen will stop agents from starting it.

## 6. Build order

1. The shared-cache fix (§4), with its test. Independent of distribution, and useful now: the app and `eyrie mcp` from a checkout already share the cache.
2. Build `packages/server`'s CLI as a standalone executable on each platform in the release workflow, and smoke-test `eyrie mcp` on the fixture the way `pnpm smoke` tests the app.
3. Install it with each package (§5), and replace the app's *Copy MCP Command* items, today shown only when running from a checkout, with ones that name the installed command.
4. Document the setup per agent in the README, and test it end to end with Claude Code and Codex on each platform.

## 7. Open questions

- Which standalone format works for `node:sqlite` and the WASM grammars on all five builds, and how large it is.
- How agents on Windows start a command: an `.exe` works everywhere, a `.cmd` only through a shell (see `@eyrie/core/commands`), so the command should be an `.exe`.
- Whether Squirrel keeps a folder of the app's own across updates and uninstalls, or the command needs a location outside it.
