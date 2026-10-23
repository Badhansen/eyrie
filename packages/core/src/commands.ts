/**
 * Finding and starting programs the user installed (editors, the Claude Code CLI), the same
 * way on every OS. Node only, so it is a subpath of its own (`@eyrie/core/commands`): the
 * browser imports `@eyrie/core` and never this.
 *
 * Windows differs twice. A program is a file with one of PATHEXT's extensions (`code` is
 * `code.cmd`), and Node refuses to start a `.cmd` or `.bat` file without a shell, so those
 * run through cmd.exe with every argument quoted and escaped for it.
 */
import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, isAbsolute, join, win32 } from 'node:path';

export interface CommandOptions {
  /** `process.platform` by default. Changes only which names are tried, not how paths are joined. */
  platform?: NodeJS.Platform;
  /** Windows only: the extensions a program may have; PATHEXT by default. */
  extensions?: readonly string[];
}

export interface Editor {
  /** The name it is looked up by, or EYRIE_EDITOR as given. */
  cmd: string;
  name: string;
}

/** The editors "Open in editor" tries when EYRIE_EDITOR is not set, in this order. */
export const EDITORS: readonly Editor[] = [
  { cmd: 'cursor', name: 'Cursor' },
  { cmd: 'code', name: 'VS Code' },
  { cmd: 'windsurf', name: 'Windsurf' },
  { cmd: 'zed', name: 'Zed' },
];

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

/** The file names `cmd` may have: on Windows, `cmd` with each extension, unless it has one of them already. */
export function commandNames(cmd: string, opts: CommandOptions = {}): string[] {
  if ((opts.platform ?? process.platform) !== 'win32') return [cmd];
  const extensions = (opts.extensions ?? (process.env.PATHEXT || DEFAULT_PATHEXT).split(';')).filter(Boolean).map((ext) => ext.toLowerCase());
  const lower = cmd.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext)) ? [cmd] : extensions.map((ext) => cmd + ext);
}

function isProgram(file: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    if (platform !== 'win32') accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The program `cmd` names: `cmd` itself when it is an absolute path, else the first match in `path`'s folders (a PATH value). */
export function findCommand(cmd: string, path: string, opts: CommandOptions = {}): string | undefined {
  const platform = opts.platform ?? process.platform;
  const names = commandNames(cmd, opts);
  // Windows lets a PATH entry be quoted.
  const dirs = isAbsolute(cmd) ? [''] : path.split(delimiter).map((dir) => dir.replace(/^"(.*)"$/, '$1')).filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      const file = dir ? join(dir, name) : name;
      if (isProgram(file, platform)) return file;
    }
  }
  return undefined;
}

/** The editor to open things with: `configured` (EYRIE_EDITOR) when set, else the first of EDITORS on `path`. */
export function findEditor(path: string, configured?: string, opts: CommandOptions = {}): (Editor & { file: string }) | undefined {
  const candidates = configured ? [{ cmd: configured, name: win32.basename(configured) }] : EDITORS;
  for (const editor of candidates) {
    const file = findCommand(editor.cmd, path, opts);
    if (file) return { ...editor, file };
  }
  return undefined;
}

/** How to start a program that `findCommand` found. */
export interface Invocation {
  command: string;
  args: string[];
  /** Set for cmd.exe, whose command line is quoted here already. */
  windowsVerbatimArguments?: boolean;
}

/** Escapes cmd.exe's special characters, double quotes included, so it reads the whole line as plain text. */
const caret = (text: string) => text.replace(/[()[\]%!^"`<>&|;, *?]/g, '^$&');

/**
 * The command and arguments that run `file` with `args`. On Windows a `.cmd` or `.bat` file
 * runs through cmd.exe, which cannot carry a double quote or a line break in an argument, so
 * those are refused rather than mangled.
 */
export function invocation(file: string, args: readonly string[], opts: { platform?: NodeJS.Platform; comspec?: string } = {}): Invocation {
  if ((opts.platform ?? process.platform) !== 'win32' || !/\.(cmd|bat)$/i.test(file)) return { command: file, args: [...args] };
  const refused = args.find((arg) => /["\r\n\0]/.test(arg));
  if (refused !== undefined) throw new Error(`cmd.exe cannot pass ${JSON.stringify(refused)} to ${win32.basename(file)}`);
  // Backslashes before the closing quote are doubled, or the program would read an escaped quote.
  const line = [caret(file), ...args.map((arg) => caret(`"${arg.replace(/(\\+)$/, '$1$1')}"`))].join(' ');
  return { command: opts.comspec ?? process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], windowsVerbatimArguments: true };
}

/**
 * Starts a program that outlives Eyrie, such as an editor, ignoring its output. False when it
 * could not be started; a failure after that (the file removed since it was found) is ignored.
 */
export function startDetached(file: string, args: readonly string[], env?: NodeJS.ProcessEnv): boolean {
  try {
    const run = invocation(file, args);
    const child = spawn(run.command, run.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: run.windowsVerbatimArguments,
      ...(env ? { env } : {}),
    });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
