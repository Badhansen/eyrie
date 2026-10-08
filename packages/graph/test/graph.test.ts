import { beforeEach, describe, expect, it } from 'vitest';
import { FixtureRepo } from './fixture.js';

const R = 'src/services/resume.service.ts';

describe('code graph: full build', () => {
  let repo: FixtureRepo;
  beforeEach(async () => {
    repo = await FixtureRepo.load();
  });

  it('resolves calls through imports, instances, aliases and this-fields', () => {
    const edges = repo.edgeStrings();
    expect(edges).toContain('CALLS src/app/api/resume/generate/route.ts#POST -> src/services/resume.service.ts#ResumeService.generate');
    expect(edges).toContain('CALLS src/services/resume.service.ts#ResumeService.generate -> src/services/ai.service.ts#AIService.complete');
    expect(edges).toContain('CALLS src/services/resume.service.ts#ResumeService.generate -> src/repositories/resume.repository.ts#ResumeRepository.save');
    expect(edges).toContain('CALLS src/app/api/resume/[id]/route.ts#GET -> src/repositories/resume.repository.ts#ResumeRepository.findById');
    expect(edges).toContain('CALLS src/services/auth.service.ts#requireUser -> src/services/auth.service.ts#getSession');
  });

  it('links route nodes to handlers and frontend fetches to routes', () => {
    const edges = repo.edgeStrings();
    expect(edges).toContain('CALLS api_route:POST /api/resume/generate -> src/app/api/resume/generate/route.ts#POST');
    expect(edges).toContain('HTTP_CALL src/components/resume/ResumeEditor.tsx#ResumeEditor -> api_route:POST /api/resume/generate');
    expect(edges).toContain('HTTP_CALL src/components/resume/ResumeViewer.tsx#ResumeViewer -> api_route:GET /api/resume/:id');
    expect(edges).toContain('HTTP_CALL src/hooks/useResumes.ts#useResumes -> api_route:GET /api/resume');
  });

  it('detects database reads/writes and external services', () => {
    const edges = repo.edgeStrings();
    expect(edges).toContain('WRITES_TO src/repositories/resume.repository.ts#ResumeRepository.save -> database_model:Resume');
    expect(edges).toContain('WRITES_TO src/repositories/resume.repository.ts#ResumeRepository.save -> database_model:ResumeVersion');
    expect(edges).toContain('READS_FROM src/services/auth.service.ts#getSession -> database_model:User');
    expect(edges).toContain('USES src/services/ai.service.ts#AIService.complete -> external_service:OpenAI');
    expect(edges).toContain('USES src/services/payment.service.ts#paymentService.handleWebhook -> external_service:Stripe');
  });

  it('marks Next.js middleware and resolves next/dynamic imports', () => {
    const mw = [...repo.index.store.nodes()].find((n) => n.file === 'src/middleware.ts' && n.name === 'middleware');
    expect(mw?.kind).toBe('middleware');
    expect(repo.edgeStrings()).toContain('USES src/app/resume/[id]/page.tsx#ResumePage -> src/components/resume/ResumeViewer.tsx#ResumeViewer');
  });
});

describe('code graph: incremental updates', () => {
  let repo: FixtureRepo;
  beforeEach(async () => {
    repo = await FixtureRepo.load();
  });

  it('keeps ids stable and only re-resolves the edited file for body-only edits', async () => {
    const before = new Set([...repo.index.store.nodes()].map((n) => n.id));
    const src = repo.files.get(R)!;
    const result = await repo.write(R, `// a new leading comment\n\n${src.replace('return this.repo.findByUser(userId);', 'const all = await this.repo.findByUser(userId);\n    return all;')}`);
    expect(result.reresolved).toEqual([R]);
    expect(result.diff.addedNodes).toHaveLength(0);
    expect(result.diff.removedNodes).toHaveLength(0);
    expect(result.diff.updatedNodes.length).toBeGreaterThan(0);
    expect(new Set([...repo.index.store.nodes()].map((n) => n.id))).toEqual(before);
  });

  it('adds a new service and its dependency edges (the JobMatcher demo)', async () => {
    await repo.write(
      'src/services/job-matcher.service.ts',
      `import { AIService } from './ai.service';\n\n/** Scores how well a resume matches a job. */\nexport class JobMatcher {\n  private ai = new AIService();\n  async match(resume: string, job: string) {\n    return this.ai.complete(resume + job);\n  }\n}\n`,
    );
    const src = repo.files.get(R)!;
    const result = await repo.write(
      R,
      src
        .replace("import { buildResumePrompt } from '@/lib/prompt';", "import { buildResumePrompt } from '@/lib/prompt';\nimport { JobMatcher } from './job-matcher.service';")
        .replace('const tailored = await this.ai.complete(prompt);', 'await new JobMatcher().match(cv, jobDescription);\n    const tailored = await this.ai.complete(prompt);'),
    );
    const edges = repo.edgeStrings();
    expect(edges).toContain('CALLS src/services/job-matcher.service.ts#JobMatcher.match -> src/services/ai.service.ts#AIService.complete');
    expect(edges).toContain('CALLS src/services/resume.service.ts#ResumeService.generate -> src/services/job-matcher.service.ts#JobMatcher');
    expect(result.diff.addedEdges.some((e) => repo.name(e.target) === 'src/services/job-matcher.service.ts#JobMatcher')).toBe(true);
  });

  it('invalidates dependents when an export changes and restores them when it comes back', async () => {
    const path = 'src/repositories/resume.repository.ts';
    const original = repo.files.get(path)!;
    const result = await repo.write(path, original.replace('async save(', 'async persist('));
    expect(result.reresolved).toContain(R);
    expect(repo.edgeStrings()).not.toContain('CALLS src/services/resume.service.ts#ResumeService.generate -> src/repositories/resume.repository.ts#ResumeRepository.save');
    // Falls back to the class with lower confidence.
    expect(repo.edgeStrings()).toContain('CALLS src/services/resume.service.ts#ResumeService.generate -> src/repositories/resume.repository.ts#ResumeRepository');

    await repo.write(path, original);
    expect(repo.edgeStrings()).toContain('CALLS src/services/resume.service.ts#ResumeService.generate -> src/repositories/resume.repository.ts#ResumeRepository.save');
  });

  it('handles deleting and re-adding a file', async () => {
    const path = 'src/services/ai.service.ts';
    const content = repo.files.get(path)!;
    const removed = await repo.remove(path);
    expect(removed.diff.removedNodes.length).toBeGreaterThan(0);
    expect(repo.edgeStrings().some((e) => e.includes('ai.service.ts'))).toBe(false);
    // OpenAI is no longer used by anything except the client wrapper.
    expect(repo.edgeStrings()).not.toContain('USES src/services/ai.service.ts#AIService.complete -> external_service:OpenAI');

    await repo.write(path, content);
    expect(repo.edgeStrings()).toContain('CALLS src/services/resume.service.ts#ResumeService.generate -> src/services/ai.service.ts#AIService.complete');
  });

  it('flags calls to missing API routes and re-links them when the route appears', async () => {
    const editor = 'src/components/resume/ResumeEditor.tsx';
    await repo.write(editor, repo.files.get(editor)!.replace("'/api/resume/generate'", "'/api/jobs/match'"));
    expect(repo.edgeStrings()).toContain('HTTP_CALL src/components/resume/ResumeEditor.tsx#ResumeEditor -> api_route:POST /api/jobs/match');
    const missing = [...repo.index.store.nodes()].find((n) => n.kind === 'api_route' && n.meta?.missing);
    expect(missing).toBeDefined();

    await repo.write('src/app/api/jobs/match/route.ts', 'export async function POST() {\n  return Response.json({ ok: true });\n}\n');
    expect(repo.index.store.getNode(missing!.id)).toBeUndefined();
    const route = [...repo.index.store.nodes()].find((n) => n.kind === 'api_route' && n.name === 'POST /api/jobs/match' && n.file);
    expect(route).toBeDefined();
    expect(repo.edgeStrings()).toContain('HTTP_CALL src/components/resume/ResumeEditor.tsx#ResumeEditor -> api_route:POST /api/jobs/match');
  });
});

describe('external services by URL', () => {
  it('maps API hosts in fetch calls to known providers', async () => {
    const { providerForUrl } = await import('../src/index.js');
    expect(providerForUrl('https://api.stripe.com:param')?.label).toBe('Stripe');
    expect(providerForUrl('https://api.github.com/repos/:param')?.label).toBe('GitHub API');
    expect(providerForUrl('https://:param/v1')).toBeNull();
  });
});
