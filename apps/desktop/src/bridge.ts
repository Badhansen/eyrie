/**
 * The contract between the main process and the window's pages: the Projects
 * page (served as eyrie://app/projects.html) and a project's map, carried over
 * IPC by src/preload.ts.
 * apps/web/src/lib/desktop.ts mirrors these types for the page; keep the two in step.
 */
import type { Project } from './projects.js';

/** What is happening to a project right now. Not stored: it describes this run of the app. */
export type ProjectStatus = 'idle' | 'queued' | 'scanning' | 'opening' | 'live';

export interface ProjectView extends Project {
  status: ProjectStatus;
  /** `root` with the home folder written as `~`, for display. */
  displayRoot: string;
  /** When the current scan or open started (epoch ms), while one is running. */
  since?: number;
  /** The folder no longer exists. */
  missing: boolean;
}

export interface AddResult {
  added: ProjectView[];
  /** Paths that are not folders, or are already in the list. */
  skipped: string[];
}

export const Channel = {
  list: 'projects:list',
  add: 'projects:add',
  addPaths: 'projects:add-paths',
  open: 'projects:open',
  scan: 'projects:scan',
  scanAll: 'projects:scan-all',
  cancel: 'projects:cancel',
  /** Stops the open project's engine. */
  close: 'projects:close',
  /** Takes a project off the list. Its folder and its cache stay as they are. */
  remove: 'projects:remove',
  menu: 'projects:menu',
  /** Main → page: the list or a project's status changed. */
  changed: 'projects:changed',
  /** Any page → main: show the Projects page. */
  show: 'projects:show',
  /** Any page → main, synchronous: the saved UI choices (src/prefs.ts). */
  prefs: 'prefs:all',
  /** Any page → main: save a UI choice, or forget it with null. */
  setPref: 'prefs:set',
} as const;
