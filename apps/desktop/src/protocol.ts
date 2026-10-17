/** Messages between the main process and the engine host (a utility process). */

/** `stop` makes the host close the engine and exit. */
export type ToHost = { type: 'start'; root: string; webDir: string } | { type: 'stop' };

export type FromHost =
  /** The engine indexed the repository and is serving the UI at `url` (token included). */
  | { type: 'ready'; url: string }
  | { type: 'log'; message: string }
  | { type: 'failed'; message: string };
