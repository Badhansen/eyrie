import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { findEditor, projectFromArgs, statusPage, tildify } from '../src/util.js';

describe('projectFromArgs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eyrie-desktop-'));
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  writeFileSync(join(dir, 'file.txt'), '');
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('skips the executable (and the app path when unpackaged) and flags', () => {
    expect(projectFromArgs(['/Applications/Eyrie.app/eyrie', '--inspect', repo], { packaged: true })).toBe(repo);
    expect(projectFromArgs(['electron', '.', repo], { packaged: false })).toBe(repo);
    // Unpackaged, the second argument is the app itself, never the project.
    expect(projectFromArgs(['electron', repo], { packaged: false })).toBeUndefined();
  });

  it('resolves relative paths against the given working directory', () => {
    expect(projectFromArgs(['eyrie', 'repo'], { packaged: true, cwd: dir })).toBe(repo);
  });

  it('ignores files and paths that do not exist', () => {
    expect(projectFromArgs(['eyrie', join(dir, 'file.txt'), join(dir, 'missing')], { packaged: true })).toBeUndefined();
    expect(projectFromArgs(['eyrie', join(dir, 'missing'), repo], { packaged: true })).toBe(repo);
  });
});

describe('statusPage', () => {
  const html = (url: string) => decodeURIComponent(url.slice(url.indexOf(',') + 1));

  it('is a self-contained HTML data URL', () => {
    const url = statusPage('Indexing /repo…');
    expect(url.startsWith('data:text/html;charset=utf-8,')).toBe(true);
    expect(html(url)).toContain('<p>Indexing /repo…</p>');
  });

  it('escapes markup in paths and error messages', () => {
    const page = html(statusPage(`Could not open /tmp/<img src=x onerror="alert('x')">`));
    expect(page).not.toContain('<img');
    expect(page).toContain('&#60;img src=x onerror=&#34;alert(&#39;x&#39;)&#34;&#62;');
  });
});

describe('findEditor', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eyrie-editors-'));
  const bin = (name: string, ...tools: string[]) => {
    const path = join(dir, name);
    mkdirSync(path);
    for (const tool of tools) {
      writeFileSync(join(path, tool), '');
      chmodSync(join(path, tool), 0o755);
    }
    return path;
  };
  const first = bin('first', 'zed');
  const second = bin('second', 'code', 'cursor');
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('prefers editors in the CLI\'s order, wherever they are on PATH', () => {
    expect(findEditor([first, second].join(delimiter))).toEqual({ cmd: 'cursor', name: 'Cursor' });
    expect(findEditor(first)).toEqual({ cmd: 'zed', name: 'Zed' });
    expect(findEditor(join(dir, 'missing'))).toBeUndefined();
  });

  it('uses EYRIE_EDITOR alone when it is set, by name or absolute path', () => {
    expect(findEditor(second, 'code')).toEqual({ cmd: 'code', name: 'code' });
    expect(findEditor('', join(first, 'zed'))).toEqual({ cmd: join(first, 'zed'), name: 'zed' });
    expect(findEditor(second, 'nvim')).toBeUndefined();
  });
});

describe('tildify', () => {
  it('writes paths inside home as ~', () => {
    expect(tildify('/Users/ada/code/shop', '/Users/ada')).toBe('~/code/shop');
    expect(tildify('/Users/ada', '/Users/ada')).toBe('~');
  });

  it('leaves other paths, and look-alike prefixes, as they are', () => {
    expect(tildify('/Users/adam/shop', '/Users/ada')).toBe('/Users/adam/shop');
    expect(tildify('/srv/shop', '/Users/ada')).toBe('/srv/shop');
    expect(tildify('/srv/shop', '')).toBe('/srv/shop');
  });
});
