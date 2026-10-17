/**
 * Runs the Eyrie engine in an Electron utility process, so indexing and
 * parsing never block the window. `start` runs the same `launch()` the `eyrie`
 * CLI runs: loopback only, random port, random per-run token. `scan` indexes
 * once without a server or a watcher, which refreshes the parse cache.
 * Either way the host runs until the main process sends `stop`.
 */
import { GraphEngine } from '@eyrie/engine';
import { launch } from '@eyrie/server';
import type { FromHost, ToHost } from './protocol.js';

const port = process.parentPort;
const send = (message: FromHost) => port.postMessage(message);
const log = (message: string) => send({ type: 'log', message });

let started = false;
/** Releases what `start` or `scan` opened: the server, the watcher and the cache. */
let close: (() => Promise<void>) | null = null;

port.on('message', ({ data }: { data: ToHost }) => {
  if (data.type === 'start') void start(data.root, data.webDir);
  else if (data.type === 'scan') void scan(data.root, data.reset);
  else void stop();
});

async function start(root: string, webDir: string): Promise<void> {
  if (started) return;
  started = true;
  const t0 = performance.now();
  try {
    const running = await launch({ root, webDir, host: '127.0.0.1', port: 0, watch: true, log });
    close = () => running.close();
    const { repo, stats } = running.engine;
    send({ type: 'ready', url: running.url, repo, stats, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    send({ type: 'failed', message: (err as Error).message });
  }
}

async function scan(root: string, reset: boolean): Promise<void> {
  if (started) return;
  started = true;
  const t0 = performance.now();
  const engine = new GraphEngine({ root, watch: false, reset, log });
  close = () => engine.stop();
  try {
    await engine.start();
    send({ type: 'scanned', repo: engine.repo, stats: engine.stats, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    send({ type: 'failed', message: (err as Error).message });
  }
}

/** Closes whatever is running, then exits; the main process waits for the exit. */
async function stop(): Promise<void> {
  try {
    await close?.();
  } finally {
    process.exit(0);
  }
}
