import { describe, expect, it } from 'vitest';
import { applyDiff, basename, diffCollections, diffGraphs, dirname, emptyDiff, hash53, idFor, isEmptyDiff, join, keys, normalize, stripExtension } from '../src/index.js';

describe('stable ids', () => {
  it('hashes the same key to the same id, and different keys to different ids', () => {
    const a = idFor(keys.symbol('src/a.ts', 'function', 'run'));
    expect(idFor(keys.symbol('src/a.ts', 'function', 'run'))).toBe(a);
    expect(idFor(keys.symbol('src/b.ts', 'function', 'run'))).not.toBe(a);
    expect(idFor(keys.symbol('src/a.ts', 'class', 'run'))).not.toBe(a);
  });

  it('produces fixed-width ids and honours the seed', () => {
    expect(hash53('x')).toHaveLength(11);
    expect(hash53('')).toHaveLength(11);
    expect(hash53('x', 1)).not.toBe(hash53('x'));
  });

  it('keeps edge keys distinct by kind and direction', () => {
    expect(keys.edge('CALLS', 'a', 'b')).not.toBe(keys.edge('IMPORTS', 'a', 'b'));
    expect(keys.edge('CALLS', 'a', 'b')).not.toBe(keys.edge('CALLS', 'b', 'a'));
  });
});

describe('diffs', () => {
  const before = [
    { id: 'a', v: 1 },
    { id: 'b', v: 1 },
    { id: 'c', v: 1 },
  ];
  const after = [
    { id: 'a', v: 1 },
    { id: 'b', v: 2 },
    { id: 'd', v: 1 },
  ];

  it('classifies added, updated and removed items by id', () => {
    const d = diffCollections(before, after);
    expect(d.added.map((x) => x.id)).toEqual(['d']);
    expect(d.updated.map((x) => x.id)).toEqual(['b']);
    expect(d.removed).toEqual(['c']);
  });

  it('reports nothing for identical collections', () => {
    const d = diffGraphs({ nodes: before, edges: [] }, { nodes: before.map((x) => ({ ...x })), edges: [] });
    expect(isEmptyDiff(d)).toBe(true);
    expect(isEmptyDiff(emptyDiff())).toBe(true);
  });

  it('applying a diff turns the old maps into the new ones', () => {
    const nodes = new Map(before.map((x) => [x.id, x]));
    const edges = new Map([['e1', { id: 'e1', from: 'a', to: 'c' }]]);
    const nextEdges = [{ id: 'e2', from: 'a', to: 'd' }];
    const d = diffGraphs({ nodes: before, edges: [...edges.values()] }, { nodes: after, edges: nextEdges });
    expect(isEmptyDiff(d)).toBe(false);
    applyDiff(nodes, edges, d);
    expect([...nodes.values()]).toEqual(expect.arrayContaining(after));
    expect(nodes.size).toBe(after.length);
    expect([...edges.values()]).toEqual(nextEdges);
  });
});

describe('POSIX paths', () => {
  it('normalizes separators, dots and parent segments', () => {
    expect(normalize('src\\app\\./page.tsx')).toBe('src/app/page.tsx');
    expect(normalize('src/app/../lib//db.ts')).toBe('src/lib/db.ts');
    expect(normalize('./')).toBe('');
  });

  it('splits and joins', () => {
    expect(dirname('src/app/page.tsx')).toBe('src/app');
    expect(dirname('page.tsx')).toBe('');
    expect(basename('src/app/page.tsx')).toBe('page.tsx');
    expect(join('src', '', 'app/../lib', 'db.ts')).toBe('src/lib/db.ts');
  });

  it('strips JS and TS extensions, including declaration files', () => {
    expect(stripExtension('src/a.tsx')).toBe('src/a');
    expect(stripExtension('src/a.d.ts')).toBe('src/a');
    expect(stripExtension('src/a.mjs')).toBe('src/a');
    expect(stripExtension('src/a.py')).toBe('src/a.py');
  });
});
