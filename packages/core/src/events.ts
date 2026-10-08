import type { ArchDiff } from './diff.js';
import type { ArchGraph, CodeEdge, CodeNode, GraphStats } from './graph.js';

export type FileChangeKind = 'add' | 'change' | 'unlink';

export interface FileChange {
  file: string;
  change: FileChangeKind;
}

export type GraphEvent =
  | { type: 'file.changed'; file: string; change: FileChangeKind }
  | { type: 'node.created'; node: CodeNode }
  | { type: 'node.updated'; node: CodeNode }
  | { type: 'node.deleted'; id: string }
  | { type: 'edge.created'; edge: CodeEdge }
  | { type: 'edge.updated'; edge: CodeEdge }
  | { type: 'edge.deleted'; id: string }
  | { type: 'architecture.updated'; diff: ArchDiff };

export interface RepoInfo {
  name: string;
  root: string;
  frameworks: string[];
}

/** Messages pushed from the engine server to clients over WebSocket. */
export type ServerMessage =
  | { type: 'hello'; seq: number; repo: RepoInfo; stats: GraphStats; architecture: ArchGraph }
  | { type: 'status'; state: 'indexing' | 'ready' | 'error'; message?: string }
  | {
      type: 'batch';
      seq: number;
      at: number;
      ms: number;
      files: FileChange[];
      /** Code-level events are omitted when a batch is very large. */
      events: GraphEvent[];
      truncated: boolean;
      stats: GraphStats;
    };
