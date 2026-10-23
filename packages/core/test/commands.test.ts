import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { commandNames, findCommand, findEditor, invocation } from '../src/commands.js';

const windows = process.platform === 'win32';
const dir = mkdtempSync(join(tmpdir(), 'eyrie commands '));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A folder of programs, named the way this OS names them: `tool.cmd` on Windows, an executable `tool` elsewhere. */
function bin(name: string, ...tools: string[]): string {
  const path = join(dir, name);
  mkdirSync(path);
  for (const tool of tools) program(join(path, windows ? `${tool}.cmd` : tool));
  return path;
}

function program(file: string, body = ''): string {
  writeFileSync(file, body);
  chmodSync(file, 0o755);
  return file;
}

describe('commandNames', () => {
  it('is the name alone outside Windows', () => {
    expect(commandNames('code', { platform: 'linux' })).toEqual(['code']);
    expect(commandNames('code', { platform: 'darwin' })).toEqual(['code']);
  });

  it('tries each PATHEXT extension on Windows, unless the name has one already', () => {
    const extensions = ['.COM', '.EXE', '.BAT', '.CMD'];
    expect(commandNames('code', { platform: 'win32', extensions })).toEqual(['code.com', 'code.exe', 'code.bat', 'code.cmd']);
    expect(commandNames('Code.EXE', { platform: 'win32', extensions })).toEqual(['Code.EXE']);
    expect(commandNames('claude', { platform: 'win32', extensions: ['.exe'] })).toEqual(['claude.exe']);
  });
});

describe('findCommand', () => {
  const first = bin('first', 'zed');
  const second = bin('second', 'code', 'cursor');

  it('finds a program in the first folder of PATH that has it', () => {
    expect(findCommand('code', [first, second].join(delimiter))).toBe(join(second, windows ? 'code.cmd' : 'code'));
    expect(findCommand('zed', [first, second].join(delimiter))).toBe(join(first, windows ? 'zed.cmd' : 'zed'));
    expect(findCommand('nvim', [first, second].join(delimiter))).toBeUndefined();
    expect(findCommand('code', '')).toBeUndefined();
  });

  it('reads quoted PATH entries, which Windows allows', () => {
    expect(findCommand('code', `"${second}"`)).toBe(join(second, windows ? 'code.cmd' : 'code'));
  });

  it('takes an absolute path as it is, if it exists', () => {
    const file = join(first, windows ? 'zed.cmd' : 'zed');
    expect(findCommand(file, '')).toBe(file);
    expect(findCommand(join(first, 'missing'), '')).toBeUndefined();
  });

  it('skips folders that merely have the name', () => {
    const path = join(dir, 'folders');
    mkdirSync(join(path, windows ? 'code.cmd' : 'code'), { recursive: true });
    expect(findCommand('code', path)).toBeUndefined();
  });

  it.skipIf(windows)('skips files that are not executable', () => {
    const path = join(dir, 'plain');
    mkdirSync(path);
    writeFileSync(join(path, 'code'), '');
    expect(findCommand('code', path)).toBeUndefined();
  });

  it.runIf(windows)('can be limited to some extensions, as AI notes are to claude.exe', () => {
    const path = bin('npm', 'claude');
    expect(findCommand('claude', path)).toBe(join(path, 'claude.cmd'));
    expect(findCommand('claude', path, { extensions: ['.exe', '.com'] })).toBeUndefined();
  });
});

describe('findEditor', () => {
  const first = bin('editors-first', 'zed');
  const second = bin('editors-second', 'code', 'cursor');

  it("prefers editors in the CLI's order, wherever they are on PATH", () => {
    expect(findEditor([first, second].join(delimiter))).toMatchObject({ cmd: 'cursor', name: 'Cursor', file: join(second, windows ? 'cursor.cmd' : 'cursor') });
    expect(findEditor(first)).toMatchObject({ cmd: 'zed', name: 'Zed' });
    expect(findEditor(join(dir, 'missing'))).toBeUndefined();
  });

  it('uses EYRIE_EDITOR alone when it is set, by name or absolute path', () => {
    expect(findEditor(second, 'code')).toMatchObject({ cmd: 'code', name: 'code' });
    const zed = join(first, windows ? 'zed.cmd' : 'zed');
    expect(findEditor('', zed)).toMatchObject({ cmd: zed, file: zed });
    expect(findEditor(second, 'nvim')).toBeUndefined();
  });
});

describe('invocation', () => {
  it('runs a program directly outside Windows, and an .exe directly on Windows', () => {
    expect(invocation('/usr/bin/code', ['-g', '/a b/c.ts:3'], { platform: 'linux' })).toEqual({ command: '/usr/bin/code', args: ['-g', '/a b/c.ts:3'] });
    expect(invocation('C:\\Zed\\zed.exe', ['C:\\a b\\c.ts:3'], { platform: 'win32' })).toEqual({ command: 'C:\\Zed\\zed.exe', args: ['C:\\a b\\c.ts:3'] });
  });

  it('runs a Windows .cmd through cmd.exe with every special character escaped', () => {
    const run = invocation('C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd', ['C:\\Users\\ada\\shop & co (1)\\'], { platform: 'win32', comspec: 'cmd.exe' });
    expect(run).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', '"C:\\Program^ Files\\Microsoft^ VS^ Code\\bin\\code.cmd ^"C:\\Users\\ada\\shop^ ^&^ co^ ^(1^)\\\\^""'],
      windowsVerbatimArguments: true,
    });
  });

  it('refuses arguments cmd.exe cannot carry', () => {
    expect(() => invocation('C:\\x\\code.cmd', ['say "hi"'], { platform: 'win32' })).toThrow(/cmd\.exe cannot pass/);
    expect(() => invocation('C:\\x\\code.cmd', ['two\nlines'], { platform: 'win32' })).toThrow(/cmd\.exe cannot pass/);
  });

  // What an editor's .cmd launcher (VS Code's, Cursor's) does: hand %* to the real program.
  it.runIf(windows)('passes arguments through a .cmd launcher unchanged', () => {
    const script = join(dir, 'print args.cjs');
    writeFileSync(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
    const launcher = program(join(dir, 'launch me.cmd'), `@"${process.execPath}" "${script}" %*\r\n`);
    const args = ['C:\\a b\\', 'x&y|z', '100% done', '%PATH%', '(p) [q]', '!bang', 'a^b', "it's", 'semi;colon,comma', '-g', 'C:\\shop\\page.tsx:12'];
    const run = invocation(launcher, args);
    const result = spawnSync(run.command, run.args, { encoding: 'utf8', windowsVerbatimArguments: run.windowsVerbatimArguments, windowsHide: true });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(args);
  });
});
