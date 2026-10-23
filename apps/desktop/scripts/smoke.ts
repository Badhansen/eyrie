/**
 * `pnpm smoke <executable>`: checks a packaged build. The app opens
 * fixtures/bookstore-app with an empty cache, so its bundled grammars parse
 * every file, and with a user-data folder of its own, where it records what it
 * indexed in projects.json. The engine is deterministic, so that must match
 * what the engine finds here, run from source on the same machine.
 *
 * It reads projects.json rather than the app's output because a Windows GUI
 * app's stdout is not dependable.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GraphEngine } from '@eyrie/engine';

const executable = process.argv[2];
if (!executable || !existsSync(executable)) {
  console.error(`usage: pnpm smoke <the packaged app's executable>${executable ? ` (not found: ${executable})` : ''}`);
  process.exit(2);
}

const TIMEOUT_MS = 180_000;
const fixture = fileURLToPath(new URL('../../../fixtures/bookstore-app', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'eyrie-smoke-'));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Counts {
  files: number;
  symbols: number;
  components: number;
  links: number;
}

const engine = new GraphEngine({ root: fixture, watch: false, dataDir: join(dir, 'source') });
await engine.start();
const expected: Counts = { files: engine.stats.files, symbols: engine.stats.symbols, components: engine.stats.archNodes, links: engine.stats.archEdges };
await engine.stop();

const userData = join(dir, 'user-data');
const app = spawn(executable, [`--user-data-dir=${userData}`, fixture], { env: { ...process.env, EYRIE_HOME: join(dir, 'home') }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
app.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
app.stderr.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
let exit: string | undefined;
app.on('exit', (code, signal) => (exit = `exit code ${code}, signal ${signal}`));
app.on('error', (err) => (exit = err.message));

/** The project as the app recorded it, once it has an index or an error. */
function recorded(): { scan?: Counts; error?: string } | undefined {
  try {
    const list = JSON.parse(readFileSync(join(userData, 'projects.json'), 'utf8')) as { projects?: { scan?: Counts; error?: string }[] };
    return list.projects?.find((p) => p.scan || p.error);
  } catch {
    return undefined;
  }
}

const started = Date.now();
let project = recorded();
while (!project && exit === undefined && Date.now() - started < TIMEOUT_MS) {
  await wait(500);
  project = recorded();
}
const seconds = ((Date.now() - started) / 1000).toFixed(1);

if (exit === undefined) {
  const exited = new Promise((r) => app.once('exit', r));
  app.kill();
  await Promise.race([exited, wait(10_000)]);
}

const actual = project?.scan && { files: project.scan.files, symbols: project.scan.symbols, components: project.scan.components, links: project.scan.links };
const ok = !!actual && (Object.keys(expected) as (keyof Counts)[]).every((k) => actual[k] === expected[k]);
console.log(`engine from source: ${JSON.stringify(expected)}`);
console.log(`packaged app:       ${actual ? JSON.stringify(actual) : project?.error ? `failed: ${project.error}` : exit ? `exited before indexing (${exit})` : `nothing recorded after ${seconds} s`}`);
if (ok) console.log(`PASS: the packaged app indexed the fixture as the engine does (${seconds} s)`);
else console.log(`FAIL\n--- app output ---\n${output.slice(-4000)}`);

try {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
} catch {
  /* Windows may still hold a file of the engine host's; it is a temp folder */
}
process.exit(ok ? 0 : 1);
