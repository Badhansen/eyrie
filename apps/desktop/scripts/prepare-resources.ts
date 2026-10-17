/**
 * Fills resources/ with what the app reads from disk at run time: the built web
 * UI (it carries LICENSE and THIRD-PARTY-NOTICES.md) and tree-sitter's WASM
 * files. forge.config.mts ships both folders as extra resources; during
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
console.log(`Prepared resources/: the web UI and ${wasm.length} WASM files.`);
