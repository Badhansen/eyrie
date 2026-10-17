import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SourceParser, grammarFiles } from '../src/index.js';

// Each test file runs in its own module scope, so the parser here has not been initialised yet.
describe('EYRIE_GRAMMAR_DIR', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eyrie-grammars-'));
  afterAll(() => {
    delete process.env.EYRIE_GRAMMAR_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists every WASM file the parser loads, once, by absolute path', () => {
    const files = grammarFiles();
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      expect(isAbsolute(f)).toBe(true);
      expect(f.endsWith('.wasm')).toBe(true);
      expect(existsSync(f)).toBe(true);
    }
    expect(new Set(files.map((f) => basename(f))).size).toBe(files.length);
    expect(files.map((f) => basename(f))).toContain('web-tree-sitter.wasm');
  });

  it('loads the runtime and grammars from that folder instead of node_modules', async () => {
    // Leave Python out of the folder: if the parser still finds it, it is not using the folder.
    for (const f of grammarFiles()) if (basename(f) !== 'tree-sitter-python.wasm') copyFileSync(f, join(dir, basename(f)));
    process.env.EYRIE_GRAMMAR_DIR = dir;
    const parser = new SourceParser();
    const ts = await parser.parse('src/a.ts', 'export function run() { return 1; }\n');
    expect(ts?.symbols.map((s) => s.name)).toContain('run');
    await expect(parser.parse('app/main.py', 'def run():\n    return 1\n')).rejects.toThrow();
    parser.dispose();
  });
});
