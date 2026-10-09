import { createRequire } from 'node:module';
import { Language, Parser } from 'web-tree-sitter';
import type { SourceLanguage } from '@eyrie/core';

const require = createRequire(import.meta.url);

type GrammarLanguage = Exclude<SourceLanguage, 'prisma'>;

const GRAMMARS: Record<GrammarLanguage, string> = {
  typescript: 'tree-sitter-typescript/tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-typescript/tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-javascript/tree-sitter-javascript.wasm',
  jsx: 'tree-sitter-javascript/tree-sitter-javascript.wasm',
  python: 'tree-sitter-python/tree-sitter-python.wasm',
  go: 'tree-sitter-go/tree-sitter-go.wasm',
  java: 'tree-sitter-java/tree-sitter-java.wasm',
  rust: 'tree-sitter-rust/tree-sitter-rust.wasm',
  csharp: 'tree-sitter-c-sharp/tree-sitter-c_sharp.wasm',
  php: 'tree-sitter-php/tree-sitter-php.wasm',
  ruby: 'tree-sitter-ruby/tree-sitter-ruby.wasm',
};

const EXTENSIONS: Record<string, SourceLanguage> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'jsx',
  '.py': 'python',
  '.go': 'go',
  '.java': 'java',
  '.rs': 'rust',
  '.cs': 'csharp',
  '.php': 'php',
  '.rb': 'ruby',
  '.rake': 'ruby',
  '.prisma': 'prisma',
};

export type { GrammarLanguage };

export const SOURCE_EXTENSIONS = Object.keys(EXTENSIONS);

/** Generated code that would only add noise to the graph. */
const GENERATED = /(\.d\.[mc]?ts|\.pb\.go|_pb2(_grpc)?\.py|\.g\.cs|\.designer\.cs|\.generated\.cs|AssemblyInfo\.cs)$/i;

export function detectLanguage(path: string): SourceLanguage | null {
  if (GENERATED.test(path)) return null;
  const dot = path.lastIndexOf('.');
  if (dot === -1) return null;
  return EXTENSIONS[path.slice(dot).toLowerCase()] ?? null;
}

let initPromise: Promise<void> | null = null;
const languages = new Map<GrammarLanguage, Promise<Language>>();

export async function loadLanguage(lang: GrammarLanguage): Promise<Language> {
  initPromise ??= Parser.init();
  await initPromise;
  let pending = languages.get(lang);
  if (!pending) {
    pending = Language.load(require.resolve(GRAMMARS[lang]));
    languages.set(lang, pending);
  }
  return pending;
}

/** One parser per language; tree-sitter parsers are cheap to reuse. */
export class ParserPool {
  private parsers = new Map<GrammarLanguage, Parser>();

  async get(lang: GrammarLanguage): Promise<Parser> {
    let parser = this.parsers.get(lang);
    if (!parser) {
      const language = await loadLanguage(lang);
      parser = new Parser();
      parser.setLanguage(language);
      this.parsers.set(lang, parser);
    }
    return parser;
  }

  dispose(): void {
    for (const p of this.parsers.values()) p.delete();
    this.parsers.clear();
  }
}
