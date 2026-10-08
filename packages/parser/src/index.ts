import { createHash } from 'node:crypto';
import type { FileFacts, SourceLanguage } from '@eyrie/core';
import { ParserPool, SOURCE_EXTENSIONS, detectLanguage, type GrammarLanguage } from './languages.js';
import { extractPrisma } from './prisma.js';
import { TypeScriptExtractor } from './typescript.js';

export { SOURCE_EXTENSIONS, detectLanguage } from './languages.js';

/** Bump whenever extraction output changes so cached facts are re-parsed. */
export const FACTS_VERSION = '2';

/**
 * A language adapter turns one file into facts. Adding a language means
 * adding an adapter; nothing downstream depends on tree-sitter.
 */
export interface LanguageAdapter {
  readonly id: string;
  readonly languages: readonly SourceLanguage[];
  extract(path: string, source: string, language: GrammarLanguage): Promise<FileFacts | null>;
  dispose(): void;
}

export function contentHash(source: string): string {
  return createHash('sha1').update(source).digest('hex').slice(0, 16);
}

export class TypeScriptAdapter implements LanguageAdapter {
  readonly id = 'typescript';
  readonly languages = ['typescript', 'tsx', 'javascript', 'jsx'] as const;
  private pool = new ParserPool();

  async extract(path: string, source: string, language: GrammarLanguage): Promise<FileFacts | null> {
    const parser = await this.pool.get(language);
    const tree = parser.parse(source);
    if (!tree) return null;
    try {
      return new TypeScriptExtractor(path, language, contentHash(source), source).run(tree.rootNode);
    } finally {
      tree.delete();
    }
  }

  dispose(): void {
    this.pool.dispose();
  }
}

/** Files that are too large or look minified are skipped. */
export function shouldSkipSource(source: string): boolean {
  if (source.length > 1_000_000) return true;
  const lines = source.split('\n', 50);
  const longest = Math.max(...lines.map((l) => l.length));
  return longest > 2_000 && lines.length < 5;
}

export class SourceParser {
  private adapter = new TypeScriptAdapter();

  supports(path: string): boolean {
    return detectLanguage(path) !== null;
  }

  async parse(path: string, source: string): Promise<FileFacts | null> {
    const language = detectLanguage(path);
    if (!language || shouldSkipSource(source)) return null;
    if (language === 'prisma') return extractPrisma(path, source, contentHash(source));
    return this.adapter.extract(path, source, language);
  }

  dispose(): void {
    this.adapter.dispose();
  }
}

export const supportedExtensions = SOURCE_EXTENSIONS;
