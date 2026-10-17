/// <reference lib="dom" />
/**
 * Runs in every page of the window, sandboxed. Each page gets `showProjects`,
 * so the engine's UI can offer a way back; only the Projects page
 * (eyrie://app/) also gets the project list. The main process checks the
 * sender of every project call again, so this split is not the only guard.
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { Channel, type AddResult, type ProjectView } from './bridge.js';

const projects = {
  list: (): Promise<ProjectView[]> => ipcRenderer.invoke(Channel.list),
  /** Opens a folder picker; resolves with what was added. */
  add: (): Promise<AddResult> => ipcRenderer.invoke(Channel.add),
  /** Adds folders dropped on the page. */
  addFiles: (files: File[]): Promise<AddResult> => ipcRenderer.invoke(Channel.addPaths, files.map((f) => webUtils.getPathForFile(f)).filter(Boolean)),
  open: (id: string): Promise<void> => ipcRenderer.invoke(Channel.open, id),
  scan: (id: string, reset = false): Promise<void> => ipcRenderer.invoke(Channel.scan, id, reset),
  scanAll: (): Promise<void> => ipcRenderer.invoke(Channel.scanAll),
  cancel: (id: string): Promise<void> => ipcRenderer.invoke(Channel.cancel, id),
  close: (id: string): Promise<void> => ipcRenderer.invoke(Channel.close, id),
  remove: (id: string): Promise<void> => ipcRenderer.invoke(Channel.remove, id),
  /** Shows the project's menu at a point in the page, or under the pointer. */
  menu: (id: string, at?: { x: number; y: number }): Promise<void> => ipcRenderer.invoke(Channel.menu, id, at),
  onChange: (listener: (projects: ProjectView[]) => void): (() => void) => {
    const handler = (_event: unknown, list: ProjectView[]) => listener(list);
    ipcRenderer.on(Channel.changed, handler);
    return () => ipcRenderer.off(Channel.changed, handler);
  },
};

contextBridge.exposeInMainWorld('eyrieDesktop', {
  platform: process.platform,
  showProjects: () => ipcRenderer.send(Channel.show),
  ...(location.protocol === 'eyrie:' ? { projects } : {}),
});
