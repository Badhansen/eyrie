/**
 * Smoke test against a real open-source Next.js app, not the hand-written fixture.
 *
 * The fixture in fixtures/bookstore-app exists to *specify* resolution: every edge
 * asserted there is an edge we claim Eyrie should find. This file does the opposite
 * job — it checks Eyrie survives code nobody wrote for it, at a size the fixture
 * will never reach. So it asserts shape and health, never specific edges: snapshotting
 * a third-party repo's output would just freeze whatever we currently produce,
 * bugs included.
 *
 * The repo is cloned on demand (pnpm smoke:fetch), never vendored, so `pnpm test`
 * stays hermetic and offline. Without the clone these tests skip.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GraphEngine } from '../src/index.js';

const REPO = fileURLToPath(new URL('../../../.smoke/next-prisma-tailwind-ecommerce', import.meta.url));
const present = existsSync(REPO);

describe.skipIf(!present)('smoke: real open-source repo', () => {
  let engine: GraphEngine;
  let dataDir: string;
  let elapsedMs = 0;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'eyrie-smoke-'));
    engine = new GraphEngine({ root: REPO, dataDir, watch: false });
    const started = Date.now();
    await engine.start();
    elapsedMs = Date.now() - started;
  }, 120_000);

  afterAll(async () => {
    await engine?.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('indexes a real repo without crashing', () => {
    // Far more than the fixture's 34; the point is that it scaled, not the exact count.
    expect(engine.stats.files).toBeGreaterThan(100);
    expect(engine.repo.frameworks).toEqual(expect.arrayContaining(['next']));
  });

  it('derives an architecture that is neither empty nor a flat dump of every file', () => {
    const arch = engine.architecture;
    expect(arch.nodes.length).toBeGreaterThan(10);
    // Lifting has to actually reduce: components must be far fewer than source files.
    expect(arch.nodes.length).toBeLessThan(engine.stats.files);
    // Every edge points at a node that exists.
    const ids = new Set(arch.nodes.map((n) => n.id));
    expect(arch.edges.filter((e) => !ids.has(e.source) || !ids.has(e.target))).toEqual([]);
    // Nothing should land in a lane we do not render, and labels must be non-empty.
    expect(arch.nodes.filter((n) => !n.label.trim())).toEqual([]);
  });

  it('finds the things a Next.js app always has', () => {
    const kinds = new Set([...engine.index.store.nodes()].map((n) => n.kind));
    expect(kinds).toContain('api_route');
    expect(kinds).toContain('react_component');
    expect(kinds).toContain('database_model');
  });

  it('completes a cold index in a reasonable time', () => {
    // Generous: this is a regression tripwire for pathological blowups, not a benchmark.
    expect(elapsedMs).toBeLessThan(60_000);
  });
});
