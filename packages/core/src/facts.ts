/**
 * Facts extracted from a single source file by a language adapter.
 *
 * Facts are a pure function of (path, content): they contain no cross-file
 * resolution. That makes them cacheable by content hash and lets the graph
 * layer re-resolve relationships without re-parsing.
 */

export type SourceLanguage = 'typescript' | 'tsx' | 'javascript' | 'jsx' | 'prisma';

/** A data model declared in a schema file (Prisma model, Drizzle table, ...). */
export interface ModelFact {
  name: string;
  line: number;
  endLine: number;
  fields: string[];
  /** Names of other models this model references. */
  relations: string[];
  orm: 'prisma';
}

export interface FileFacts {
  /** Repo-relative POSIX path. */
  path: string;
  language: SourceLanguage;
  /** Content hash of the file. */
  hash: string;
  loc: number;
  /** Top-of-file directives such as 'use client' / 'use server'. */
  directives: string[];
  imports: ImportFact[];
  exports: ExportFact[];
  symbols: SymbolFact[];
  references: ReferenceFact[];
  /** Express/Hono/Fastify-style route registrations found in the file. */
  routes: RouteFact[];
  /** Data models declared by schema files. */
  models?: ModelFact[];
  parseErrors: number;
}

export interface ImportSpecifier {
  /** 'default', '*', or the exported name in the source module. */
  imported: string;
  local: string;
  typeOnly?: boolean;
}

export interface ImportFact {
  source: string;
  line: number;
  typeOnly: boolean;
  specifiers: ImportSpecifier[];
  /** `import('./x')` or `require('./x')`. */
  dynamic?: boolean;
}

export type ExportFact =
  /** `export function a`, `export { a as b }`, `export default a`. */
  | { kind: 'local'; exported: string; local: string; line: number }
  /** `export { a as b } from './x'`. */
  | { kind: 'reexport'; exported: string; imported: string; source: string; line: number }
  /** `export * from './x'`. */
  | { kind: 'reexport-all'; source: string; line: number }
  /** `export * as ns from './x'`. */
  | { kind: 'reexport-namespace'; exported: string; source: string; line: number };

export type SymbolKind =
  | 'function'
  | 'class'
  | 'method'
  | 'interface'
  | 'type'
  | 'enum'
  | 'variable'
  | 'react_component'
  | 'hook';

export interface FieldFact {
  name: string;
  /** Declared type name (root identifier), e.g. `OrderService`. */
  type?: string;
  /** Class instantiated in the initializer, e.g. `new OrderService()`. */
  instanceOf?: string;
}

export interface SymbolFact {
  name: string;
  /** Dotted name inside the file, e.g. `OrderService.checkout`. */
  qualifiedName: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  /** Declared with the `export` keyword or listed in an export clause. */
  exported: boolean;
  /** Qualified name of the containing class or object. */
  parent?: string;
  async?: boolean;
  returnsJsx?: boolean;
  extends?: string[];
  implements?: string[];
  /** For variables: `new X()` initializer → 'X'. */
  instanceOf?: string;
  /** For variables: `createClient(...)` initializer → 'createClient'. */
  initCall?: string;
  /** Declared type annotation root name. */
  typeName?: string;
  /** Class fields and constructor parameter properties. */
  fields?: FieldFact[];
  /** Local variables / parameters bound to a class instance or type. */
  locals?: Record<string, string>;
  /** First line of the declaration, trimmed. */
  signature?: string;
  /** Leading doc comment, first paragraph. */
  doc?: string;
}

/** A literal argument value captured at a call site. */
export type ArgFact = string | Record<string, string> | null;

export interface ReferenceFact {
  /** Qualified name of the enclosing symbol; '' for module scope; 'route:GET /x' for inline route handlers. */
  from: string;
  kind: 'call' | 'new' | 'jsx' | 'ref';
  /** Member chain, e.g. ['this', 'repo', 'save'] or ['fetch']. */
  callee: string[];
  line: number;
  /** Up to three literal arguments (strings, template strings with ':param', or small object literals). */
  args?: ArgFact[];
}

export interface RouteFact {
  method: string;
  path: string;
  line: number;
  /** Router object the route was registered on, e.g. 'app' or 'router'. */
  router: string;
  /** Scope name used for references inside inline handlers. */
  scope: string;
  /** Identifiers passed as handlers / middleware. */
  handlers: string[];
}
