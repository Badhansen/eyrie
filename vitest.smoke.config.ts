import { defineConfig } from 'vitest/config';

/**
 * Separate config so the smoke test never joins the default `pnpm test` run:
 * it needs a repo cloned by `pnpm smoke:fetch`, and the default suite must stay
 * hermetic and offline. Hence `.spec.ts`, which the root config's include misses.
 */
export default defineConfig({
  test: {
    include: ['packages/engine/test/smoke.spec.ts'],
    testTimeout: 120_000,
  },
});
