import { dirname, join, normalize } from '@eyrie/core';

/** Path aliases from one tsconfig/jsconfig. All paths are repo-relative. */
export interface AliasConfig {
  /** Directory the config applies to ('' = repo root). */
  scope: string;
  baseUrl?: string;
  paths: { pattern: string; targets: string[] }[];
}

export interface WorkspacePackage {
  name: string;
  dir: string;
  /** Entry file relative to `dir`, from package.json. */
  entry?: string;
}

export interface ProjectConfig {
  aliases: AliasConfig[];
  workspaces: WorkspacePackage[];
  frameworks: string[];
}

export const emptyProjectConfig = (): ProjectConfig => ({ aliases: [], workspaces: [], frameworks: [] });

export type Resolution =
  | { kind: 'file'; path: string }
  | { kind: 'package'; name: string }
  | { kind: 'asset' }
  /** `local` = relative or aliased; it may resolve once the file exists. */
  | { kind: 'unresolved'; local: boolean };

const CODE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const ASSET = /\.(json|css|scss|sass|less|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|md|mdx|txt|html|wasm|graphql|gql|yaml|yml)$/i;

export class ModuleResolver {
  private cache = new Map<string, Resolution>();
  private aliases: AliasConfig[] = [];

  constructor(
    private readonly files: ReadonlySet<string>,
    private config: ProjectConfig,
  ) {
    this.setConfig(config);
  }

  setConfig(config: ProjectConfig): void {
    this.config = config;
    this.aliases = [...config.aliases].sort((a, b) => b.scope.length - a.scope.length);
    this.cache.clear();
  }

  /** Call when files are added or removed. */
  invalidate(): void {
    this.cache.clear();
  }

  resolve(importer: string, specifier: string): Resolution {
    const fromDir = dirname(importer);
    const cacheKey = `${fromDir}\0${specifier}`;
    let hit = this.cache.get(cacheKey);
    if (!hit) {
      hit = this.compute(importer, fromDir, specifier);
      this.cache.set(cacheKey, hit);
    }
    return hit;
  }

  private compute(importer: string, fromDir: string, specifier: string): Resolution {
    const clean = specifier.split('?')[0]!;
    if (clean.startsWith('.')) {
      const found = this.probe(join(fromDir, clean));
      if (found) return { kind: 'file', path: found };
      return ASSET.test(clean) ? { kind: 'asset' } : { kind: 'unresolved', local: true };
    }
    if (clean.startsWith('/')) return { kind: 'unresolved', local: false };

    const scope = this.aliases.find((a) => a.scope === '' || importer.startsWith(`${a.scope}/`));
    if (scope) {
      let matchedAlias = false;
      for (const { pattern, targets } of scope.paths) {
        const captured = matchPattern(pattern, clean);
        if (captured === null) continue;
        matchedAlias = true;
        for (const target of targets) {
          const found = this.probe(normalize(target.replace('*', captured)));
          if (found) return { kind: 'file', path: found };
        }
      }
      if (scope.baseUrl !== undefined) {
        const found = this.probe(join(scope.baseUrl, clean));
        if (found) return { kind: 'file', path: found };
      }
      if (matchedAlias) return ASSET.test(clean) ? { kind: 'asset' } : { kind: 'unresolved', local: true };
    }

    for (const ws of this.config.workspaces) {
      if (clean !== ws.name && !clean.startsWith(`${ws.name}/`)) continue;
      const sub = clean.slice(ws.name.length + 1);
      const tries = sub
        ? [join(ws.dir, sub), join(ws.dir, 'src', sub)]
        : [
            ...(ws.entry ? [join(ws.dir, ws.entry), join(ws.dir, ws.entry.replace(/^(\.\/)?(dist|build|lib)\//, 'src/'))] : []),
            join(ws.dir, 'src/index'),
            join(ws.dir, 'index'),
          ];
      for (const t of tries) {
        const found = this.probe(t);
        if (found) return { kind: 'file', path: found };
      }
      return { kind: 'unresolved', local: true };
    }

    if (ASSET.test(clean)) return { kind: 'asset' };
    return { kind: 'package', name: clean };
  }

  private probe(base: string): string | null {
    if (this.files.has(base) && !base.endsWith('.d.ts')) return base;
    for (const ext of CODE_EXTENSIONS) if (this.files.has(base + ext)) return base + ext;
    const js = /\.[mc]?jsx?$/.exec(base);
    if (js) {
      const stem = base.slice(0, -js[0].length);
      for (const ext of ['.ts', '.tsx', '.mts', '.cts']) if (this.files.has(stem + ext)) return stem + ext;
    }
    for (const ext of CODE_EXTENSIONS) if (this.files.has(`${base}/index${ext}`)) return `${base}/index${ext}`;
    return null;
  }
}

/** Returns the text captured by `*`, '' for an exact match, or null. */
function matchPattern(pattern: string, specifier: string): string | null {
  const star = pattern.indexOf('*');
  if (star === -1) return pattern === specifier ? '' : null;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) return null;
  if (specifier.length < prefix.length + suffix.length) return null;
  return specifier.slice(prefix.length, specifier.length - suffix.length);
}
