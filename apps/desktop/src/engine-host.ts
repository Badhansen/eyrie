/**
 * Runs the Eyrie engine and its local server in an Electron utility process,
 * so indexing and parsing never block the window. It is the same `launch()`
 * the `eyrie` CLI runs: loopback only, random port, random per-run token.
 */
import { launch, type RunningEyrie } from '@eyrie/server';
import type { FromHost, ToHost } from './protocol.js';

const port = process.parentPort;
const send = (message: FromHost) => port.postMessage(message);

let running: RunningEyrie | null = null;

port.on('message', ({ data }: { data: ToHost }) => {
  if (data.type === 'start') void start(data.root, data.webDir);
  else void stop();
});

async function start(root: string, webDir: string): Promise<void> {
  if (running) return;
  try {
    running = await launch({ root, webDir, host: '127.0.0.1', port: 0, watch: true, log: (message) => send({ type: 'log', message }) });
    send({ type: 'ready', url: running.url });
  } catch (err) {
    send({ type: 'failed', message: (err as Error).message });
  }
}

/** Stops watching, closes the server and the cache, then exits; the main process waits for the exit. */
async function stop(): Promise<void> {
  try {
    await running?.close();
  } finally {
    process.exit(0);
  }
}
