/**
 * The desktop app's bridge, exposed as `window.eyrieDesktop` by
 * apps/desktop/src/preload.ts. It is absent in a browser. Every page gets
 * `showProjects`; only the Projects page gets `projects`.
 * Mirrors apps/desktop/src/bridge.ts and projects.ts; keep the two in step.
 */

export type ProjectStatus = 'idle' | 'queued' | 'scanning' | 'opening' | 'live';

/** What the last scan, or the last open, found. */
export interface ProjectScan {
  at: number;
  ms: number;
  files: number;
  symbols: number;
  components: number;
  links: number;
  frameworks: string[];
  /** Commits recorded in the project's knowledge.db, and how many have an AI note. */
  commits?: number;
  analysed?: number;
}

export interface ProjectView {
  id: string;
  root: string;
  /** `root` with the home folder written as `~`. */
  displayRoot: string;
  name: string;
  addedAt: number;
  openedAt?: number;
  scan?: ProjectScan;
  /** Why the last scan or open failed. */
  error?: string;
  /** The AI backend that notes this project's commits, when turned on. */
  ai?: string;
  status: ProjectStatus;
  /** When the current scan or open started, while one is running. */
  since?: number;
  /** The folder no longer exists. */
  missing: boolean;
}

export interface AddResult {
  added: ProjectView[];
  skipped: string[];
}

export interface DesktopProjects {
  list(): Promise<ProjectView[]>;
  /** Opens a folder picker. */
  add(): Promise<AddResult>;
  /** Adds folders dropped on the page. */
  addFiles(files: File[]): Promise<AddResult>;
  open(id: string): Promise<void>;
  scan(id: string, reset?: boolean): Promise<void>;
  scanAll(): Promise<void>;
  /** Stops a scan, or takes it out of the queue. */
  cancel(id: string): Promise<void>;
  /** Stops the open project's engine. */
  close(id: string): Promise<void>;
  /** Takes a project off the list; its folder and cache stay. */
  remove(id: string): Promise<void>;
  /** Shows the project's native menu at a point in the page. */
  menu(id: string, at?: { x: number; y: number }): Promise<void>;
  onChange(listener: (projects: ProjectView[]) => void): () => void;
}

export interface DesktopBridge {
  platform: string;
  showProjects(): void;
  projects?: DesktopProjects;
}

export const desktop: DesktopBridge | undefined = (window as Window & { eyrieDesktop?: DesktopBridge }).eyrieDesktop;

/** The shortcut for File → Projects, as the platform writes it. */
export const projectsShortcut = desktop?.platform === 'darwin' ? '⇧⌘P' : 'Ctrl+Shift+P';
