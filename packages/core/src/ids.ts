/**
 * Stable identifiers.
 *
 * A node's identity is a readable key built from
 *   repository-relative file path + symbol kind + fully-qualified name,
 * hashed into a compact id. Ids never depend on display names or layout,
 * so they survive re-layouts and most edits.
 */

/** 53-bit string hash (cyrb53). Browser-safe and deterministic. */
export function hash53(input: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(36).padStart(11, '0');
}

export function idFor(key: string): string {
  return hash53(key);
}

export const keys = {
  repository: (name: string) => `repo:${name}`,
  folder: (path: string) => `dir:${path}`,
  file: (path: string) => `file:${path}`,
  symbol: (path: string, kind: string, qualifiedName: string) => `${path}#${kind}:${qualifiedName}`,
  route: (method: string, path: string) => `route:${method.toUpperCase()} ${path}`,
  model: (name: string) => `model:${name}`,
  external: (provider: string) => `external:${provider}`,
  queue: (name: string) => `queue:${name}`,
  edge: (kind: string, source: string, target: string) => `${kind}|${source}|${target}`,
};
