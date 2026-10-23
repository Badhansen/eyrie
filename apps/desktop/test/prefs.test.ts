import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PrefStore } from '../src/prefs.js';

const dir = mkdtempSync(join(tmpdir(), 'eyrie-prefs-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
const prefsFile = () => join(dir, `${n++}`, 'prefs.json');

describe('PrefStore', () => {
  it('keeps choices across restarts', () => {
    const file = prefsFile();
    const prefs = new PrefStore(file);
    expect(prefs.all()).toEqual({});
    expect(prefs.set('eyrie-view', '3d')).toBe(true);
    expect(prefs.set('eyrie-theme', 'light')).toBe(true);
    expect(new PrefStore(file).all()).toEqual({ 'eyrie-view': '3d', 'eyrie-theme': 'light' });
  });

  it('forgets a choice set to null', () => {
    const file = prefsFile();
    const prefs = new PrefStore(file);
    prefs.set('eyrie-theme', 'dark');
    expect(prefs.set('eyrie-theme', null)).toBe(true);
    expect(new PrefStore(file).all()).toEqual({});
  });

  it('ignores keys the UI does not use, and values that are not short strings', () => {
    const prefs = new PrefStore(prefsFile());
    expect(prefs.set('anything', 'x')).toBe(false);
    expect(prefs.set('eyrie-lens', 42)).toBe(false);
    expect(prefs.set('eyrie-lens', 'x'.repeat(65))).toBe(false);
    expect(prefs.set(null, null)).toBe(false);
    expect(prefs.all()).toEqual({});
  });

  it('drops what it does not recognise in the file, and starts empty when the file is unreadable', () => {
    const file = prefsFile();
    new PrefStore(file).set('eyrie-lens', 'sequence');
    const stored = JSON.parse(readFileSync(file, 'utf8'));
    stored.values.other = 'x';
    writeFileSync(file, JSON.stringify(stored));
    expect(new PrefStore(file).all()).toEqual({ 'eyrie-lens': 'sequence' });

    writeFileSync(file, '{ not json');
    const fresh = new PrefStore(file);
    expect(fresh.all()).toEqual({});
    fresh.set('eyrie-view', '2d');
    expect(new PrefStore(file).all()).toEqual({ 'eyrie-view': '2d' });
  });
});
