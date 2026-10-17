/** Helpers for the main process that need nothing from Electron, so they can be tested in Node. */
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The first folder passed on the command line, e.g.
 * `pnpm --filter @eyrie/desktop start -- ../../fixtures/bookstore-app`.
 * Packaged, argv is [app, ...args]; unpackaged, [electron, appPath, ...args].
 */
export function projectFromArgs(argv: readonly string[], opts: { packaged: boolean; cwd?: string }): string | undefined {
  for (const arg of argv.slice(opts.packaged ? 1 : 2)) {
    if (arg.startsWith('-')) continue;
    const dir = resolve(opts.cwd ?? process.cwd(), arg);
    if (existsSync(dir) && statSync(dir).isDirectory()) return dir;
  }
  return undefined;
}

/** A one-line page shown while the engine starts or after it fails. `text` may contain paths and error messages, so it is escaped. */
export function statusPage(text: string): string {
  const escaped = text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const html = `<!doctype html><meta charset="utf-8"><title>Eyrie</title>
<style>:root{color-scheme:light dark}body{margin:0;height:100vh;display:grid;place-items:center;font:14px system-ui,sans-serif;background:Canvas;color:CanvasText}p{max-width:60ch;padding:0 24px;opacity:.8}</style>
<p>${escaped}</p>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
