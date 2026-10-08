import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SourceParser } from '@eyrie/parser';
import type { CodeNode } from '@eyrie/core';
import { GraphIndex, type ProjectConfig } from '../src/index.js';

export const FIXTURE_ROOT = fileURLToPath(new URL('../../../fixtures/next-resume-app', import.meta.url));

export const FIXTURE_CONFIG: ProjectConfig = {
  aliases: [{ scope: '', baseUrl: '', paths: [{ pattern: '@/*', targets: ['src/*'] }] }],
  workspaces: [],
  frameworks: ['next'],
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** An in-memory copy of the fixture repo that tests can edit. */
export class FixtureRepo {
  readonly files = new Map<string, string>();
  readonly parser = new SourceParser();
  readonly index = new GraphIndex({ repoName: 'next-resume-app', config: FIXTURE_CONFIG });

  static async load(): Promise<FixtureRepo> {
    const repo = new FixtureRepo();
    for (const abs of walk(FIXTURE_ROOT)) {
      const rel = relative(FIXTURE_ROOT, abs);
      if (repo.parser.supports(rel)) repo.files.set(rel, readFileSync(abs, 'utf8'));
    }
    await repo.apply([...repo.files.keys()]);
    return repo;
  }

  async write(path: string, content: string) {
    this.files.set(path, content);
    return this.apply([path]);
  }

  async remove(path: string) {
    this.files.delete(path);
    return this.apply([path]);
  }

  async apply(paths: string[]) {
    const updates = [];
    for (const path of paths) {
      const content = this.files.get(path);
      updates.push({ path, facts: content === undefined ? null : await this.parser.parse(path, content) });
    }
    return this.index.update(updates);
  }

  /** Human-readable name for a code node: `file#qualifiedName` or route/model name. */
  name(id: string): string {
    const n = this.index.store.getNode(id);
    if (!n) return `?${id}`;
    return describeNode(n);
  }

  /** All non-structural edges as readable strings, e.g. `CALLS a.ts#f -> b.ts#g`. */
  edgeStrings(): string[] {
    const out: string[] = [];
    for (const e of this.index.store.edges()) {
      if (e.kind === 'CONTAINS' || e.kind === 'EXPORTS') continue;
      out.push(`${e.kind} ${this.name(e.source)} -> ${this.name(e.target)}`);
    }
    return out.sort();
  }
}

/** Builds an index from an in-memory set of files. */
export async function memoryIndex(files: Record<string, string>, config: ProjectConfig = FIXTURE_CONFIG): Promise<GraphIndex> {
  const parser = new SourceParser();
  const index = new GraphIndex({ repoName: 'memory', config });
  const updates = [];
  for (const [path, content] of Object.entries(files)) updates.push({ path, facts: await parser.parse(path, content) });
  index.update(updates);
  return index;
}

export function describeNode(n: CodeNode): string {
  if (n.kind === 'file') return n.qualifiedName;
  if (n.kind === 'api_route' || n.kind === 'database_model' || n.kind === 'external_service') return `${n.kind}:${n.name}`;
  return `${n.file}#${n.qualifiedName}`;
}
