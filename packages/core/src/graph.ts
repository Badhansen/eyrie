/** Node and edge types of the detailed code graph. */

export type CodeNodeKind =
  | 'repository'
  | 'folder'
  | 'file'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'function'
  | 'method'
  | 'variable'
  | 'react_component'
  | 'hook'
  | 'api_route'
  | 'middleware'
  | 'database_model'
  | 'queue'
  | 'event'
  | 'background_job'
  | 'external_service';

export type CodeEdgeKind =
  | 'CONTAINS'
  | 'IMPORTS'
  | 'EXPORTS'
  | 'CALLS'
  | 'USES'
  | 'IMPLEMENTS'
  | 'EXTENDS'
  | 'DEPENDS_ON'
  | 'HTTP_CALL'
  | 'READS_FROM'
  | 'WRITES_TO'
  | 'PUBLISHES'
  | 'SUBSCRIBES'
  | 'TRIGGERS';

export interface LineRange {
  start: number;
  end: number;
}

export interface CodeNode {
  /** Compact stable id derived from `key`. */
  id: string;
  /** Readable identity: `<path>#<kind>:<qualifiedName>` or a namespaced key. */
  key: string;
  kind: CodeNodeKind;
  name: string;
  qualifiedName: string;
  /** Repo-relative path of the defining file. */
  file?: string;
  range?: LineRange;
  exported?: boolean;
  meta?: Record<string, unknown>;
}

export interface CodeEdge {
  id: string;
  kind: CodeEdgeKind;
  source: string;
  target: string;
  /** 1 = syntactically certain, lower = heuristic. */
  confidence: number;
  /** File whose facts produced this edge (used for incremental invalidation). */
  owner?: string;
  line?: number;
  meta?: Record<string, unknown>;
}

/** Architecture-level types: the small graph users normally see. */

export type ArchKind =
  | 'page'
  | 'component'
  | 'hook'
  | 'middleware'
  | 'api_route'
  | 'server_action'
  | 'service'
  | 'repository'
  | 'module'
  | 'database_model'
  | 'external_service'
  | 'queue'
  | 'background_job';

/** Drives semantic color. */
export type ArchCategory =
  | 'frontend'
  | 'api'
  | 'service'
  | 'ai'
  | 'data'
  | 'external'
  | 'infra'
  | 'utility';

/** Left-to-right lane in the architecture layout. */
export type ArchLane = 'ui' | 'edge' | 'api' | 'logic' | 'data' | 'external';

export const ARCH_LANES: readonly ArchLane[] = ['ui', 'edge', 'api', 'logic', 'data', 'external'];

export interface SourceRef {
  file: string;
  line: number;
  endLine?: number;
}

export interface ArchNode {
  id: string;
  key: string;
  kind: ArchKind;
  category: ArchCategory;
  lane: ArchLane;
  label: string;
  /** Route, file path, or provider detail shown under the label. */
  sublabel?: string;
  /** Feature domain such as 'resume' or 'auth'. */
  domain?: string;
  /** Code node ids folded into this component. */
  members: string[];
  files: string[];
  source?: SourceRef;
  /** Deterministic description built from facts (doc comments, routes, edges). */
  summary?: string;
  meta?: Record<string, unknown>;
}

export interface ArchEdge {
  id: string;
  source: string;
  target: string;
  /** Distinct code-edge kinds folded into this edge. */
  kinds: CodeEdgeKind[];
  /** Number of code-level relationships folded into this edge. */
  weight: number;
  /** Hidden intermediate components (utilities) this edge passes through. */
  via?: string[];
  /** Example call sites. */
  sites?: SourceRef[];
  /** Lens annotations (for example a data-flow role). Not produced by derivation. */
  meta?: Record<string, unknown>;
}

export interface ArchGraph {
  nodes: ArchNode[];
  edges: ArchEdge[];
}

export interface GraphStats {
  files: number;
  symbols: number;
  nodes: number;
  edges: number;
  archNodes: number;
  archEdges: number;
  parseMs?: number;
  buildMs?: number;
}
