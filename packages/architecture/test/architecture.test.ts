import { beforeEach, describe, expect, it } from 'vitest';
import type { ArchGraph } from '@eyrie/core';
import { FixtureRepo, memoryIndex } from '../../graph/test/fixture.js';
import { deriveArchitecture } from '../src/index.js';

function readable(graph: ArchGraph) {
  const label = new Map(graph.nodes.map((n) => [n.id, n.label]));
  return {
    nodes: graph.nodes.map((n) => `${n.lane}:${n.label}`).sort(),
    edges: graph.edges.map((e) => `${label.get(e.source)} -> ${label.get(e.target)}`).sort(),
  };
}

describe('architecture derivation', () => {
  let repo: FixtureRepo;
  beforeEach(async () => {
    repo = await FixtureRepo.load();
  });

  it('reduces the code graph to meaningful components', () => {
    const arch = deriveArchitecture(repo.index);
    const { nodes, edges } = readable(arch);
    expect(nodes).toEqual([
      'api:Auth Session API',
      'api:Resume API',
      'api:Resume Detail API',
      'api:Resume Generate API',
      'api:Stripe Webhook API',
      'data:Resume',
      'data:ResumeRepository',
      'data:ResumeVersion',
      'data:Subscription',
      'data:User',
      'edge:Middleware',
      'external:OpenAI',
      'external:Stripe',
      'logic:AIService',
      'logic:Auth Service',
      'logic:Payment Service',
      'logic:ResumeService',
      'ui:Dashboard Page',
      'ui:Home Page',
      'ui:Resume Detail Page',
      'ui:ResumeEditor',
      'ui:ResumeList',
      'ui:ResumeViewer',
    ]);
    // Presentational components, hooks, utilities and SDK client wrappers are folded away.
    expect(nodes.some((n) => /Button|useResumes|Format|Prompt|Prisma/.test(n))).toBe(false);
    expect(edges).toEqual(
      expect.arrayContaining([
        'Dashboard Page -> ResumeEditor',
        'ResumeEditor -> Resume Generate API',
        'ResumeList -> Resume API',
        'Resume Generate API -> ResumeService',
        'Resume Generate API -> Auth Service',
        'ResumeService -> AIService',
        'ResumeService -> ResumeRepository',
        'AIService -> OpenAI',
        'ResumeRepository -> Resume',
        'ResumeRepository -> ResumeVersion',
        'Stripe Webhook API -> Payment Service',
        'Payment Service -> Stripe',
        'Payment Service -> Subscription',
      ]),
    );
  });

  it('colors AI services and records pass-through hops', () => {
    const arch = deriveArchitecture(repo.index);
    expect(arch.nodes.find((n) => n.label === 'AIService')?.category).toBe('ai');
    const list = arch.nodes.find((n) => n.label === 'ResumeList')!;
    const api = arch.nodes.find((n) => n.label === 'Resume API')!;
    const edge = arch.edges.find((e) => e.source === list.id && e.target === api.id)!;
    expect(edge.kinds).toEqual(['HTTP_CALL']);
    expect(edge.via).toEqual(['useResumes']);
  });

  it('uses doc comments as component summaries', () => {
    const arch = deriveArchitecture(repo.index);
    expect(arch.nodes.find((n) => n.label === 'Resume Generate API')?.summary).toBe('Generates a tailored resume from the current CV and a job description.');
    expect(arch.nodes.find((n) => n.label === 'OpenAI')?.summary).toBe('AI provider (OpenAI). Used by AIService.');
  });

  it('keeps architecture ids stable and shows a new service after an edit', async () => {
    const before = deriveArchitecture(repo.index);
    await repo.write(
      'src/services/job-matcher.service.ts',
      `import { AIService } from './ai.service';\nexport class JobMatcher {\n  private ai = new AIService();\n  match(a: string) { return this.ai.complete(a); }\n}\n`,
    );
    const r = 'src/services/resume.service.ts';
    await repo.write(
      r,
      repo.files
        .get(r)!
        .replace("import { AIService } from './ai.service';", "import { AIService } from './ai.service';\nimport { JobMatcher } from './job-matcher.service';")
        .replace('const tailored', 'new JobMatcher().match(cv);\n    const tailored'),
    );
    const after = deriveArchitecture(repo.index);
    const beforeIds = new Set(before.nodes.map((n) => n.id));
    const added = after.nodes.filter((n) => !beforeIds.has(n.id)).map((n) => n.label);
    expect(added).toEqual(['JobMatcher']);
    expect(readable(after).edges).toEqual(expect.arrayContaining(['ResumeService -> JobMatcher', 'JobMatcher -> AIService']));
  });
});

describe('architecture heuristics beyond Next.js apps', () => {
  const labels = (g: ArchGraph) => g.nodes.map((n) => n.label).sort();

  it('hides tests, fixtures and barrels', async () => {
    const index = await memoryIndex({
      'src/services/billing.service.ts': `import { prisma } from '../db';\nexport class BillingService { charge() { return prisma.invoice.create({ data: {} }); } }\n`,
      'src/db.ts': `import { PrismaClient } from '@prisma/client';\nexport const prisma = new PrismaClient();\n`,
      'src/index.ts': `export * from './services/billing.service';\n`,
      'src/services/billing.service.test.ts': `import { BillingService } from './billing.service';\nnew BillingService().charge();\n`,
      'test/fixtures/fake.service.ts': `export class FakeService { run() {} }\n`,
    });
    expect(labels(deriveArchitecture(index))).toEqual(['BillingService', 'Invoice']);
  });

  it('shows shared helpers used by many components instead of fanning out edges', async () => {
    const index = await memoryIndex({
      'src/api/client.ts': `export function request(path: string) { return fetch('https://api.github.com' + path); }\n`,
      'src/components/A.tsx': `import { request } from '../api/client';\nexport function A() { request('/a'); return <div/>; }\n`,
      'src/components/B.tsx': `import { request } from '../api/client';\nexport function B() { request('/b'); return <div/>; }\n`,
      'src/components/C.tsx': `import { request } from '../api/client';\nexport function C() { request('/c'); return <div/>; }\n`,
    });
    const arch = deriveArchitecture(index);
    expect(labels(arch)).toEqual(['A', 'B', 'C', 'Client', 'GitHub API']);
    const client = arch.nodes.find((n) => n.label === 'Client')!;
    expect(arch.edges.filter((e) => e.target === client.id)).toHaveLength(3);
  });

  it('falls back to modules on dependency paths for libraries', async () => {
    const index = await memoryIndex({
      'src/cli.ts': `import { run } from './runner';\nrun();\n`,
      'src/runner.ts': `import { parse } from './parser';\nimport { emit } from './emitter';\nexport function run() { emit(parse('x')); }\n`,
      'src/parser.ts': `import { tokenize } from './lexer';\nexport function parse(s: string) { return tokenize(s); }\n`,
      'src/lexer.ts': `export function tokenize(s: string) { return s.split(''); }\n`,
      'src/emitter.ts': `import { format } from './format';\nexport function emit(x: unknown) { return format(x); }\n`,
      'src/format.ts': `export function format(x: unknown) { return String(x); }\n`,
      'src/types.ts': `export interface Token { value: string }\n`,
    });
    const arch = deriveArchitecture(index);
    expect(labels(arch)).toEqual(['Emitter', 'Parser', 'Runner']);
  });

  it('does not invent missing routes in apps without detectable routing', async () => {
    const index = await memoryIndex({
      'web/src/App.tsx': `export function App() { fetch('/api/state'); return <div/>; }\n`,
    });
    expect([...index.store.nodes()].some((n) => n.kind === 'api_route')).toBe(false);
  });
});
