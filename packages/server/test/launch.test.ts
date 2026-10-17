import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launch } from '../src/index.js';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/bookstore-app', import.meta.url));

describe('launch', () => {
  let dir: string;
  let webDir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'eyrie-launch-'));
    webDir = join(dir, 'web');
    mkdirSync(webDir);
    writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>Eyrie test UI</title>');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('indexes the repository and serves the given UI on a free port behind a random token', async () => {
    const eyrie = await launch({ root: FIXTURE, port: 0, dataDir: join(dir, 'data'), webDir, watch: false });
    try {
      expect(eyrie.token.length).toBeGreaterThanOrEqual(16);
      expect(eyrie.url).toBe(`${eyrie.server.url}/?token=${encodeURIComponent(eyrie.token)}`);
      expect(eyrie.server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(await (await fetch(eyrie.url)).text()).toContain('Eyrie test UI');
      const state = await fetch(`${eyrie.server.url}/api/state`, { headers: { 'x-eyrie-token': eyrie.token } });
      expect(state.status).toBe(200);
      expect(((await state.json()) as { architecture: { nodes: unknown[] } }).architecture.nodes.length).toBeGreaterThan(0);
    } finally {
      await eyrie.close();
    }
    await expect(fetch(eyrie.server.url)).rejects.toThrow();
  });

  it('rejects a requested port that is in use', async () => {
    const blocker = createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', () => r()));
    const port = (blocker.address() as { port: number }).port;
    try {
      await expect(launch({ root: FIXTURE, port, dataDir: join(dir, 'data'), webDir, watch: false })).rejects.toMatchObject({ code: 'EADDRINUSE' });
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()));
    }
  });
});
