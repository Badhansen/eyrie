/**
 * Eyrie's desktop shell. It adds no UI of its own: it runs the engine in a
 * utility process (src/engine-host.ts) and shows the web UI that engine serves
 * on 127.0.0.1, exactly as `pnpm start -- <repo>` does in a browser.
 *
 * One window, one repository at a time. File → Open Repository… switches to
 * another one; closing the window stops the engine and quits.
 */
import { execFileSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { BrowserWindow, Menu, app, dialog, shell, utilityProcess, type MenuItemConstructorOptions, type UtilityProcess } from 'electron';
import started from 'electron-squirrel-startup';
import type { FromHost, ToHost } from './protocol.js';
import { projectFromArgs, statusPage } from './util.js';

// Squirrel.Windows runs the app while installing and uninstalling, to create and remove shortcuts.
if (started) app.quit();
if (!app.requestSingleInstanceLock()) app.quit();

let window: BrowserWindow | null = null;
let host: UtilityProcess | null = null;
/** Origin of the running engine's server: the only place the window may navigate to. */
let engineOrigin: string | null = null;

/** Packaged: the app's Resources folder. `electron-forge start`: `resources/`, filled by scripts/prepare-resources.ts. */
function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
}

let loginPath: string | undefined;
/**
 * Apps started from the Dock or a launcher get a minimal PATH, so "Open in editor"
 * would not find `code`, `cursor` or `zed`. Read the login shell's PATH once.
 */
function shellPath(): string | undefined {
  if (!app.isPackaged || process.platform === 'win32') return process.env.PATH;
  if (loginPath !== undefined) return loginPath;
  loginPath = process.env.PATH ?? '';
  try {
    const out = execFileSync(process.env.SHELL || '/bin/sh', ['-ilc', 'printf "__EYRIE_PATH__%s__EYRIE_PATH__" "$PATH"'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    loginPath = /__EYRIE_PATH__(.*)__EYRIE_PATH__/s.exec(out)?.[1] || loginPath;
  } catch {
    /* keep the inherited PATH */
  }
  return loginPath;
}

function openExternal(url: string): void {
  if (/^https?:\/\//.test(url)) void shell.openExternal(url);
}

function ensureWindow(): BrowserWindow {
  if (window) return window;
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Eyrie',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  // The UI only ever talks to its own engine; everything else opens in the user's browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (engineOrigin && new URL(url).origin === engineOrigin) return;
    event.preventDefault();
    openExternal(url);
  });
  win.on('page-title-updated', (event) => event.preventDefault());
  win.on('closed', () => {
    window = null;
    app.quit();
  });
  window = win;
  return win;
}

/** Asks the running engine to stop, and kills it if it does not exit in time. */
function stopHost(): Promise<void> {
  const current = host;
  host = null;
  engineOrigin = null;
  if (!current) return Promise.resolve();
  return new Promise((done) => {
    const timer = setTimeout(() => current.kill(), 5000);
    current.once('exit', () => {
      clearTimeout(timer);
      done();
    });
    current.postMessage({ type: 'stop' } satisfies ToHost);
  });
}

async function openProject(root: string): Promise<void> {
  const win = ensureWindow();
  win.setTitle(`Eyrie — ${basename(root)}`);
  void win.loadURL(statusPage(`Indexing ${root}…`));
  await stopHost();

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env.PATH = shellPath() ?? env.PATH ?? '';
  env.EYRIE_GRAMMAR_DIR = join(resourcesDir(), 'grammars');

  const next = utilityProcess.fork(join(__dirname, 'engine-host.mjs'), [], { serviceName: 'Eyrie engine', env });
  host = next;
  next.on('message', (message: FromHost) => {
    if (host !== next) return;
    if (message.type === 'log') console.log(`[eyrie] ${message.message}`);
    else if (message.type === 'ready') {
      engineOrigin = new URL(message.url).origin;
      void win.loadURL(message.url);
    } else void win.loadURL(statusPage(`Could not open ${root}: ${message.message}`));
  });
  next.on('exit', (code) => {
    if (host !== next) return;
    host = null;
    engineOrigin = null;
    void win.loadURL(statusPage(`The engine stopped unexpectedly (exit code ${code}). Use File → Open Repository… to start it again.`));
  });
  next.postMessage({ type: 'start', root, webDir: join(resourcesDir(), 'web') } satisfies ToHost);
}

async function chooseProject(): Promise<string | undefined> {
  const { canceled, filePaths } = await dialog.showOpenDialog({ title: 'Open a repository', buttonLabel: 'Open', properties: ['openDirectory'] });
  return canceled ? undefined : filePaths[0];
}

function buildMenu(): Menu {
  const mac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Repository…',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const root = await chooseProject();
            if (root) await openProject(root);
          },
        },
        { type: 'separator' },
        mac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  return Menu.buildFromTemplate(template);
}

app.on('second-instance', (_event, argv, cwd) => {
  const root = projectFromArgs(argv, { packaged: app.isPackaged, cwd });
  if (root) void openProject(root);
  else window?.focus();
});

app.on('will-quit', (event) => {
  if (!host) return;
  event.preventDefault();
  void stopHost().then(() => app.quit());
});

void app.whenReady().then(async () => {
  Menu.setApplicationMenu(buildMenu());
  const root = projectFromArgs(process.argv, { packaged: app.isPackaged }) ?? (await chooseProject());
  if (!root) {
    app.quit();
    return;
  }
  await openProject(root);
});
