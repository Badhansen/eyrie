/** Messages between the main process and the engine host (a utility process). */
import type { GraphEngine } from '@eyrie/engine';

/**
 * `start` runs the engine and its server until `stop`. `scan` indexes once
 * (refreshing the cache), reports `scanned` and exits; `reset` re-parses every
 * file instead of reusing the cache. `stop` makes the host close the engine and exit.
 */
export type ToHost = { type: 'start'; root: string; webDir: string } | { type: 'scan'; root: string; reset: boolean } | { type: 'stop' };

/** What an index of a repository found: sent when a project opens, and after a scan. */
export interface IndexSummary {
  repo: GraphEngine['repo'];
  stats: GraphEngine['stats'];
  /** Wall time of the whole index, in milliseconds. */
  ms: number;
}

export type FromHost =
  /** The engine indexed the repository and is serving the UI at `url` (token included). */
  | ({ type: 'ready'; url: string } & IndexSummary)
  /** A scan finished; the host exits after sending it. */
  | ({ type: 'scanned' } & IndexSummary)
  | { type: 'log'; message: string }
  | { type: 'failed'; message: string };
