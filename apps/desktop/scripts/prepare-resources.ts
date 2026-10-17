/**
 * Fills resources/ with what the app reads from disk at run time: the built web
 * UI (it carries LICENSE and THIRD-PARTY-NOTICES.md), tree-sitter's WASM
 * files and the window icon. forge.config.mts ships them as extra resources; during
 * `electron-forge start` the app reads them from here.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { grammarFiles } from '@eyrie/parser';

const out = fileURLToPath(new URL('../resources', import.meta.url));
const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));

if (!existsSync(join(webDist, 'index.html'))) {
  console.error('apps/web/dist is missing. Build the UI first: pnpm --filter @eyrie/web build');
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
cpSync(webDist, join(out, 'web'), { recursive: true });
mkdirSync(join(out, 'grammars'), { recursive: true });
const wasm = grammarFiles();
for (const file of wasm) copyFileSync(file, join(out, 'grammars', basename(file)));
// The window's icon on Linux, and the Dock's while the app runs unpackaged on macOS.
copyFileSync(fileURLToPath(new URL('../assets/icon.png', import.meta.url)), join(out, 'icon.png'));
console.log(`Prepared resources/: the web UI, ${wasm.length} WASM files and the icon.`);
