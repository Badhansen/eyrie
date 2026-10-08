#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { GraphEngine } from '@eyrie/engine';
import { startServer } from './server.js';

const DEFAULT_PORT = 4319;

const HELP = `eyrie — live architecture graph for a codebase

Usage
  eyrie [path] [options]

Options
  --port <n>     Port for the local UI (default: 4319 or the next free one; 0 = any)
  --host <h>     Interface to bind (default 127.0.0.1)
  --token <t>    Access token (default: random per run)
  --no-open      Do not open the browser
  --no-watch     Index once without watching for changes
  --reset        Ignore the cache and re-parse every file
  -h, --help     Show this help
`;

async function main(): Promise<void> {
  // `pnpm start -- <path>` forwards a literal `--`; drop it so options still parse.
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      port: { type: 'string' },
      host: { type: 'string', default: '127.0.0.1' },
      token: { type: 'string' },
      'no-open': { type: 'boolean', default: false },
      'no-watch': { type: 'boolean', default: false },
      reset: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    process.stdout.write(HELP);
    return;
  }

  const root = resolve(positionals[0] ?? process.cwd());
  const log = (m: string) => process.stdout.write(`[eyrie] ${m}\n`);
  log(`Indexing ${root}`);
  const engine = new GraphEngine({ root, watch: !values['no-watch'], reset: values.reset, log });
  engine.on('error', (err) => log(`error: ${err.message}`));
  await engine.start();

  const token = values.token ?? randomBytes(12).toString('base64url');
  const webDir = fileURLToPath(new URL('../../../apps/web/dist', import.meta.url));
  const server = await listen(values.port, (port) => startServer({ engine, host: values.host, port, token, webDir, log }));
  const url = `${server.url}/?token=${encodeURIComponent(token)}`;
  log(`Open ${url}`);
  if (!values['no-open']) openBrowser(url);

  const shutdown = async () => {
    await server.close();
    await engine.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/** Uses the requested port, or the first free port from 4319 when none was given. */
async function listen<T>(requested: string | undefined, start: (port: number) => Promise<T>): Promise<T> {
  if (requested !== undefined) {
    try {
      return await start(Number(requested));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') throw new Error(`Port ${requested} is already in use. Choose another with --port, or use --port 0 for any free port.`);
      throw err;
    }
  }
  for (let port = DEFAULT_PORT; port < DEFAULT_PORT + 20; port++) {
    try {
      return await start(port);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
    }
  }
  return start(0);
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
  try {
    spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* the URL is printed above */
  }
}

main().catch((err: unknown) => {
  const e = err as Error;
  process.stderr.write(`[eyrie] ${process.env.EYRIE_DEBUG ? (e.stack ?? String(err)) : e.message}\n`);
  process.exit(1);
});
