/**
 * Eyrie's desktop shell. It runs the engine in a utility process
 * (src/engine-host.ts) and shows the web UI that engine serves on 127.0.0.1,
 * exactly as `pnpm start -- <repo>` does in a browser. Its own page is the
 * Projects list (apps/web/projects.html, served as eyrie://app/): projects
 * are added, scanned and opened there, and File → Projects returns to it.
 *
 * One window and one open project at a time; other projects can be scanned
 * meanwhile, each in a utility process of its own. Closing the window stops
 * everything and quits.
 */
import { execFileSync, spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BrowserWindow,
  Menu,
  app,
  clipboard,
  dialog,
  ipcMain,
  net,
  protocol,
  shell,
  utilityProcess,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type OpenDialogOptions,
  type UtilityProcess,
} from 'electron';
import started from 'electron-squirrel-startup';
import { Channel, type AddResult, type ProjectView } from './bridge.js';
import { ProjectStore, isDirectory } from './projects.js';
import type { FromHost, ToHost } from './protocol.js';
import { findEditor, projectFromArgs, statusPage, tildify } from './util.js';

// Squirrel.Windows runs the app while installing and uninstalling, to create and remove shortcuts.
if (started) app.quit();
if (!app.requestSingleInstanceLock()) app.quit();

// The Projects page and its assets come from resources/web, next to the engine's UI.
protocol.registerSchemesAsPrivileged([{ scheme: 'eyrie', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const PROJECTS_URL = 'eyrie://app/projects.html';

/** Scans that run at once; the rest wait their turn. */
const MAX_SCANS = 2;

let window: BrowserWindow | null = null;
let store: ProjectStore;

/** The open project. Its engine serves the UI at `url` once it has indexed. */
let live: { id: string; host: UtilityProcess; since: number; url?: string } | null = null;
/** Origin of the open project's server: the only place the window may navigate to. */
let engineOrigin: string | null = null;
/** Scans waiting (no `host` yet) or running, by project id. */
const scans = new Map<string, { reset: boolean; host?: UtilityProcess; since?: number }>();

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

/**
 * Serves eyrie://app/<path> from resources/web; nothing outside it. Caching
 * follows the engine's server: hashed assets are immutable, and pages are
 * revalidated, so an updated app never loads a page that names old assets.
 */
async function serveApp(request: Request): Promise<Response> {
  const webDir = join(resourcesDir(), 'web');
  const notFound = () => new Response('Not found', { status: 404 });
  try {
    const url = new URL(request.url);
    const file = normalize(join(webDir, decodeURIComponent(url.pathname)));
    if (url.host !== 'app' || !file.startsWith(webDir + sep) || !statSync(file, { throwIfNoEntry: false })?.isFile()) return notFound();
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    headers.set('cache-control', file.startsWith(join(webDir, 'assets') + sep) ? 'public, max-age=31536000, immutable' : 'no-cache');
    return new Response(res.body, { status: res.status, headers });
  } catch {
    return notFound();
  }
}

function ensureWindow(): BrowserWindow {
  if (window) return window;
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Eyrie',
    // macOS and Windows take the icon from the app bundle and the executable; Linux takes it from the window.
    ...(process.platform === 'linux' ? { icon: join(resourcesDir(), 'icon.png') } : {}),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: join(__dirname, 'preload.cjs') },
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

function onProjectsPage(): boolean {
  return !!window && !window.isDestroyed() && window.webContents.getURL().startsWith('eyrie://app/');
}

// ── projects ─────────────────────────────────────────────────────────────

function views(): ProjectView[] {
  return store.list().map((project) => {
    const view: ProjectView = { ...project, status: 'idle', displayRoot: tildify(project.root, homedir()), missing: !isDirectory(project.root) };
    const scan = scans.get(project.id);
    if (live?.id === project.id) {
      view.status = live.url ? 'live' : 'opening';
      view.since = live.since;
    } else if (scan) {
      view.status = scan.host ? 'scanning' : 'queued';
      if (scan.since) view.since = scan.since;
    }
    return view;
  });
}

/** Sends the list to the Projects page, if it is showing. */
function notify(): void {
  if (onProjectsPage()) window!.webContents.send(Channel.changed, views());
}

function showProjects(): void {
  const win = ensureWindow();
  win.setTitle('Eyrie');
  if (!onProjectsPage()) void win.loadURL(PROJECTS_URL);
  win.focus();
}

async function chooseFolders(multiple: boolean): Promise<string[]> {
  const options: OpenDialogOptions = {
    title: multiple ? 'Add projects' : 'Open a project',
    buttonLabel: multiple ? 'Add' : 'Open',
    properties: multiple ? ['openDirectory', 'multiSelections'] : ['openDirectory'],
  };
  const { canceled, filePaths } = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  return canceled ? [] : filePaths;
}

/** Adds folders to the list and scans each new one, so its summary is ready to read. */
function addProjects(paths: string[]): AddResult {
  const added: string[] = [];
  const skipped: string[] = [];
  for (const path of paths) {
    if (!isDirectory(path)) {
      skipped.push(path);
      continue;
    }
    const { project, added: isNew } = store.add(path);
    if (!isNew) {
      skipped.push(path);
      continue;
    }
    added.push(project.id);
    queueScan(project.id, false);
  }
  notify();
  return { added: views().filter((v) => added.includes(v.id)), skipped };
}

async function removeProject(id: string): Promise<void> {
  cancelScan(id);
  if (live?.id === id) await closeProject();
  store.remove(id);
  notify();
}

// ── engine hosts ─────────────────────────────────────────────────────────

function forkHost(serviceName: string): UtilityProcess {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env.PATH = shellPath() ?? env.PATH ?? '';
  env.EYRIE_GRAMMAR_DIR = join(resourcesDir(), 'grammars');
  return utilityProcess.fork(join(__dirname, 'engine-host.mjs'), [], { serviceName, env });
}

/** Asks a host to stop, and kills it if it does not exit in time. */
function stopHost(host: UtilityProcess): Promise<void> {
  return new Promise((done) => {
    const timer = setTimeout(() => {
      host.kill();
      done();
    }, 5000);
    host.once('exit', () => {
      clearTimeout(timer);
      done();
    });
    host.postMessage({ type: 'stop' } satisfies ToHost);
  });
}

/** Stops the open project's engine. The window keeps whatever it shows. */
function closeProject(): Promise<void> {
  const current = live;
  live = null;
  engineOrigin = null;
  notify();
  return current ? stopHost(current.host) : Promise.resolve();
}

async function openProject(id: string): Promise<void> {
  const project = store.get(id);
  if (!project) return;
  const win = ensureWindow();
  win.setTitle(`Eyrie — ${project.name}`);
  if (live?.id === id) {
    void win.loadURL(live.url ?? statusPage(`Indexing ${project.root}…`));
    return;
  }
  if (!isDirectory(project.root)) {
    store.recordError(id, 'The folder no longer exists.');
    notify();
    return;
  }
  // Opening indexes the project anyway.
  cancelScan(id);
  store.markOpened(id);
  void win.loadURL(statusPage(`Indexing ${project.root}…`));
  await closeProject();

  const host = forkHost('Eyrie engine');
  const current: NonNullable<typeof live> = { id, host, since: Date.now() };
  live = current;
  host.on('message', (message: FromHost) => {
    if (live !== current) return;
    if (message.type === 'log') console.log(`[eyrie] ${message.message}`);
    else if (message.type === 'ready') {
      current.url = message.url;
      engineOrigin = new URL(message.url).origin;
      store.recordIndex(id, message);
      void win.loadURL(message.url);
    } else if (message.type === 'failed') {
      store.recordError(id, message.message);
      void closeProject();
      showProjects();
    }
  });
  host.on('exit', (code) => {
    if (live !== current) return;
    live = null;
    engineOrigin = null;
    store.recordError(id, `The engine stopped unexpectedly (exit code ${code}).`);
    showProjects();
  });
  host.postMessage({ type: 'start', root: project.root, webDir: join(resourcesDir(), 'web') } satisfies ToHost);
}

/** Adds a folder if it is new, then opens it: the command line, File → Open Project… and a second launch. */
async function openFolder(root: string): Promise<void> {
  try {
    await openProject(store.add(root).project.id);
  } catch (err) {
    dialog.showErrorBox('Could not open the project', (err as Error).message);
  }
}

// ── scans ────────────────────────────────────────────────────────────────

/** Queues a scan. The open project is skipped: its engine already keeps its index current. */
function queueScan(id: string, reset: boolean): void {
  if (live?.id === id || scans.has(id) || !store.get(id)) return;
  scans.set(id, { reset });
  runScans();
  notify();
}

function scanAll(): void {
  for (const project of store.list()) if (isDirectory(project.root)) queueScan(project.id, false);
}

function cancelScan(id: string): void {
  const scan = scans.get(id);
  if (!scan) return;
  scans.delete(id);
  // The cache is written in one transaction at the end, so stopping part-way leaves it as it was.
  scan.host?.kill();
  runScans();
  notify();
}

function runScans(): void {
  let running = [...scans.values()].filter((s) => s.host).length;
  for (const [id, scan] of scans) {
    if (running >= MAX_SCANS) break;
    if (!scan.host && startScan(id, scan)) running++;
  }
}

function startScan(id: string, scan: { reset: boolean; host?: UtilityProcess; since?: number }): boolean {
  const project = store.get(id);
  if (!project || !isDirectory(project.root)) {
    scans.delete(id);
    if (project) store.recordError(id, 'The folder no longer exists.');
    return false;
  }
  const host = forkHost('Eyrie scan');
  scan.host = host;
  scan.since = Date.now();
  const finish = (record: () => void) => {
    if (scans.get(id) !== scan) return;
    scans.delete(id);
    record();
    void stopHost(host);
    runScans();
    notify();
  };
  host.on('message', (message: FromHost) => {
    if (message.type === 'log') console.log(`[eyrie scan] ${message.message}`);
    else if (message.type === 'scanned') finish(() => store.recordIndex(id, message));
    else if (message.type === 'failed') finish(() => store.recordError(id, message.message));
  });
  host.on('exit', (code) => finish(() => store.recordError(id, `The scan stopped unexpectedly (exit code ${code}).`)));
  host.postMessage({ type: 'scan', root: project.root, reset: scan.reset } satisfies ToHost);
  return true;
}

// ── menus ────────────────────────────────────────────────────────────────

const REVEAL_LABEL = process.platform === 'darwin' ? 'Show in Finder' : process.platform === 'win32' ? 'Show in Explorer' : 'Show in File Manager';

function openInEditor(root: string): void {
  const PATH = shellPath() ?? '';
  const editor = findEditor(PATH, process.env.EYRIE_EDITOR);
  if (editor) spawn(editor.cmd, [root], { detached: true, stdio: 'ignore', env: { ...process.env, PATH } }).unref();
}

/** The project's actions as a native menu, for its ⋯ button and a right-click on its row. */
function showProjectMenu(id: string, at?: { x: number; y: number }): void {
  const project = store.get(id);
  if (!project || !window) return;
  const isLive = live?.id === id;
  const scanning = scans.has(id);
  const missing = !isDirectory(project.root);
  const editor = findEditor(shellPath() ?? '', process.env.EYRIE_EDITOR);
  const template: MenuItemConstructorOptions[] = [
    { label: isLive ? 'Return to Map' : 'Open', enabled: !missing, click: () => void openProject(id) },
    scanning
      ? { label: 'Stop Scan', click: () => cancelScan(id) }
      : { label: 'Scan', enabled: !isLive && !missing, click: () => queueScan(id, false) },
    { label: 'Rescan from Scratch', enabled: !isLive && !missing && !scanning, click: () => queueScan(id, true) },
    { type: 'separator' },
    { label: editor ? `Open in ${editor.name}` : 'Open in Editor', enabled: !missing && !!editor, click: () => openInEditor(project.root) },
    { label: REVEAL_LABEL, enabled: !missing, click: () => shell.showItemInFolder(project.root) },
    { label: 'Copy Path', click: () => clipboard.writeText(project.root) },
    { type: 'separator' },
    ...(isLive ? [{ label: 'Close Project', click: () => void closeProject() }] : []),
    { label: 'Remove from List', click: () => void removeProject(id) },
  ];
  Menu.buildFromTemplate(template).popup({ window, ...(at ? { x: Math.round(at.x), y: Math.round(at.y) } : {}) });
}

function buildMenu(): Menu {
  const mac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Projects', accelerator: 'CmdOrCtrl+Shift+P', click: () => showProjects() },
        {
          label: 'Add Projects…',
          click: async () => {
            addProjects(await chooseFolders(true));
            showProjects();
          },
        },
        {
          label: 'Open Project…',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const [root] = await chooseFolders(false);
            if (root) await openFolder(root);
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

// ── IPC ──────────────────────────────────────────────────────────────────

/** Project calls are only taken from the Projects page, never from a page the engine serves. */
function handle(channel: string, fn: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (event.sender !== window?.webContents || !event.senderFrame?.url.startsWith('eyrie://app/')) throw new Error('Not allowed from this page');
    return fn(...args);
  });
}

const asId = (value: unknown) => (typeof value === 'string' ? value : '');
const asPoint = (value: unknown) => {
  const p = value as { x?: unknown; y?: unknown } | undefined;
  return p && typeof p.x === 'number' && typeof p.y === 'number' ? { x: p.x, y: p.y } : undefined;
};

function registerIpc(): void {
  handle(Channel.list, () => views());
  handle(Channel.add, async () => addProjects(await chooseFolders(true)));
  handle(Channel.addPaths, (paths) => addProjects(Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string') : []));
  handle(Channel.open, (id) => openProject(asId(id)));
  handle(Channel.scan, (id, reset) => queueScan(asId(id), reset === true));
  handle(Channel.scanAll, () => scanAll());
  handle(Channel.cancel, (id) => cancelScan(asId(id)));
  handle(Channel.close, (id) => (live?.id === asId(id) ? closeProject() : undefined));
  handle(Channel.remove, (id) => removeProject(asId(id)));
  handle(Channel.menu, (id, at) => showProjectMenu(asId(id), asPoint(at)));
  ipcMain.on(Channel.show, (event) => {
    if (event.sender === window?.webContents) showProjects();
  });
}

// ── lifecycle ────────────────────────────────────────────────────────────

app.on('second-instance', (_event, argv, cwd) => {
  if (!app.isReady()) return;
  const root = projectFromArgs(argv, { packaged: app.isPackaged, cwd });
  if (root) void openFolder(root);
  else window?.focus();
});

app.on('will-quit', (event) => {
  for (const scan of scans.values()) scan.host?.kill();
  scans.clear();
  if (!live) return;
  event.preventDefault();
  void closeProject().then(() => app.quit());
});

void app.whenReady().then(async () => {
  // Unpackaged, the Dock would show Electron's icon.
  if (!app.isPackaged) app.dock?.setIcon(join(resourcesDir(), 'icon.png'));
  store = new ProjectStore(join(app.getPath('userData'), 'projects.json'));
  protocol.handle('eyrie', serveApp);
  registerIpc();
  Menu.setApplicationMenu(buildMenu());
  const root = projectFromArgs(process.argv, { packaged: app.isPackaged });
  if (root) await openFolder(root);
  else showProjects();
});
