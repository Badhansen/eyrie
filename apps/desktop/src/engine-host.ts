/**
 * Runs the Eyrie engine in an Electron utility process, so indexing and
 * parsing never block the window. `start` runs the same `launch()` the `eyrie`
 * CLI runs: loopback only, random port, random per-run token. `scan` indexes
 * once without a server or a watcher, which refreshes the parse cache.
 * Both record the git commits the project's knowledge.db has not seen, and
 * note them with the project's AI backend when it has one: in the background
 * for `start`, before reporting for `scan`.
 * Either way the host runs until the main process sends `stop`.
 */
import { GraphEngine } from '@eyrie/engine';
import { createAiBackend, type ProjectKnowledge } from '@eyrie/knowledge';
import { launch, openKnowledge } from '@eyrie/server';
import type { FromHost, ToHost } from './protocol.js';

const port = process.parentPort;
const send = (message: FromHost) => port.postMessage(message);
const log = (message: string) => send({ type: 'log', message });

let started = false;
/** Releases what `start` or `scan` opened: the server, the watcher, the knowledge store and the cache. */
let close: (() => Promise<void>) | null = null;

port.on('message', ({ data }: { data: ToHost }) => {
  if (data.type === 'start') void start(data.root, data.webDir, data.ai);
  else if (data.type === 'scan') void scan(data.root, data.reset, data.ai);
  else void stop();
});

async function start(root: string, webDir: string, ai: string | null): Promise<void> {
  if (started) return;
  started = true;
  const t0 = performance.now();
  try {
    const running = await launch({ root, webDir, host: '127.0.0.1', port: 0, watch: true, ai: createAiBackend(ai), log });
    close = () => running.close();
    const { repo, stats } = running.engine;
    send({ type: 'ready', url: running.url, repo, stats, ms: Math.round(performance.now() - t0), knowledge: running.knowledge.summary() });
  } catch (err) {
    send({ type: 'failed', message: (err as Error).message });
  }
}

async function scan(root: string, reset: boolean, ai: string | null): Promise<void> {
  if (started) return;
  started = true;
  const t0 = performance.now();
  const engine = new GraphEngine({ root, watch: false, reset, log });
  let knowledge: ProjectKnowledge | null = null;
  close = async () => {
    await knowledge?.close();
    await engine.stop();
  };
  try {
    await engine.start();
    const ms = Math.round(performance.now() - t0);
    knowledge = await openKnowledge(engine, { ai: createAiBackend(ai), waitForAnalysis: true, log });
    send({ type: 'scanned', repo: engine.repo, stats: engine.stats, ms, knowledge: knowledge.summary() });
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
