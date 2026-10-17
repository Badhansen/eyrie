#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { launch } from './launch.js';

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
  const port = values.port === undefined ? undefined : Number(values.port);
  const eyrie = await launch({ root, host: values.host, port, token: values.token, watch: !values['no-watch'], reset: values.reset, log }).catch((err: unknown) => {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') throw new Error(`Port ${values.port} is already in use. Choose another with --port, or use --port 0 for any free port.`);
    throw err;
  });
  log(`Open ${eyrie.url}`);
  if (!values['no-open']) openBrowser(eyrie.url);

  const shutdown = async () => {
    await eyrie.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
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
