import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GraphEngine, type EngineBatch } from '../src/index.js';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/next-resume-app', import.meta.url));

function nextBatch(engine: GraphEngine, timeoutMs = 5000): Promise<EngineBatch> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timed out waiting for a graph update')), timeoutMs);
    engine.once('batch', (b) => {
      clearTimeout(t);
      resolve(b);
    });
  });
}

describe('GraphEngine', () => {
  let dir: string;
  let dataDir: string;
  let engine: GraphEngine | null = null;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eyrie-repo-'));
    dataDir = mkdtempSync(join(tmpdir(), 'eyrie-data-'));
    cpSync(FIXTURE, dir, { recursive: true });
  });

  afterEach(async () => {
    await engine?.stop();
    engine = null;
    rmSync(dir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('indexes the repo and reads tsconfig path aliases', async () => {
    engine = new GraphEngine({ root: dir, dataDir, watch: false });
    await engine.start();
    expect(engine.repo.frameworks).toEqual(expect.arrayContaining(['next', 'prisma', 'react']));
    expect(engine.stats.files).toBe(26);
    expect(engine.architecture.nodes.map((n) => n.label)).toEqual(expect.arrayContaining(['ResumeService', 'Resume Generate API', 'OpenAI']));
  });

  it('updates the architecture live when a file is created and edited', async () => {
    engine = new GraphEngine({ root: dir, dataDir, watch: true, debounceMs: 30 });
    await engine.start();

    let batch = nextBatch(engine);
    writeFileSync(
      join(dir, 'src/services/job-matcher.service.ts'),
      `import { AIService } from './ai.service';\nexport class JobMatcher {\n  private ai = new AIService();\n  match(a: string) { return this.ai.complete(a); }\n}\n`,
    );
    let b = await batch;
    expect(b.files).toEqual([{ file: 'src/services/job-matcher.service.ts', change: 'add' }]);
    expect(b.architecture.addedNodes.map((n) => n.label)).toEqual(['JobMatcher']);

    const servicePath = join(dir, 'src/services/resume.service.ts');
    batch = nextBatch(engine);
    writeFileSync(
      servicePath,
      readFileSync(servicePath, 'utf8')
        .replace("import { AIService } from './ai.service';", "import { AIService } from './ai.service';\nimport { JobMatcher } from './job-matcher.service';")
        .replace('const tailored', 'new JobMatcher().match(cv);\n    const tailored'),
    );
    b = await batch;
    const label = new Map(engine.architecture.nodes.map((n) => [n.id, n.label]));
    expect(b.architecture.addedEdges.map((e) => `${label.get(e.source)} -> ${label.get(e.target)}`)).toContain('ResumeService -> JobMatcher');
    expect(b.reresolved).toBeLessThan(5);

    batch = nextBatch(engine);
    unlinkSync(join(dir, 'src/services/job-matcher.service.ts'));
    b = await batch;
    expect(b.files).toEqual([{ file: 'src/services/job-matcher.service.ts', change: 'unlink' }]);
    expect(b.architecture.removedNodes).toHaveLength(1);
  });

  it('reuses cached facts on restart', async () => {
    const logs: string[] = [];
    engine = new GraphEngine({ root: dir, dataDir, watch: false });
    await engine.start();
    await engine.stop();
    engine = new GraphEngine({ root: dir, dataDir, watch: false, log: (m) => logs.push(m) });
    await engine.start();
    expect(logs[0]).toMatch(/0 parsed, 26 from cache/);
  });

  it('never serves files outside the index', async () => {
    writeFileSync(join(dir, '.env'), 'SECRET=1');
    engine = new GraphEngine({ root: dir, dataDir, watch: false });
    await engine.start();
    expect(engine.readSource('.env')).toBeNull();
    expect(engine.readSource('../etc/passwd')).toBeNull();
    expect(engine.readSource('src/lib/prisma.ts')?.lines[0]).toContain('PrismaClient');
  });
});
