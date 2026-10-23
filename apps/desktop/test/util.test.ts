import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { projectFromArgs, statusPage, tildify } from '../src/util.js';

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

describe('tildify', () => {
  it('writes paths inside home as ~', () => {
    expect(tildify('/Users/ada/code/shop', '/Users/ada', 'darwin')).toBe('~/code/shop');
    expect(tildify('/Users/ada', '/Users/ada', 'darwin')).toBe('~');
    expect(tildify('/home/ada/shop', '/home/ada', 'linux')).toBe('~/shop');
  });

  it('leaves other paths, and look-alike prefixes, as they are', () => {
    expect(tildify('/Users/adam/shop', '/Users/ada', 'darwin')).toBe('/Users/adam/shop');
    expect(tildify('/srv/shop', '/Users/ada', 'darwin')).toBe('/srv/shop');
    expect(tildify('/srv/shop', '', 'darwin')).toBe('/srv/shop');
  });

  it('leaves Windows paths whole, since Windows writes no ~', () => {
    expect(tildify('C:\\Users\\ada\\shop', 'C:\\Users\\ada', 'win32')).toBe('C:\\Users\\ada\\shop');
  });
});
