import { MultiDirectedGraph } from 'graphology';
import { emptyDiff, type CodeDiff, type CodeEdge, type CodeEdgeKind, type CodeNode } from '@eyrie/core';

/**
 * In-memory code graph (Graphology) with per-file indexes.
 *
 * Every mutation records the item's state before the first change in the
 * current transaction, so `commit()` returns an exact diff without
 * snapshotting the whole graph.
 */
export class CodeGraphStore {
  readonly graph = new MultiDirectedGraph<CodeNode, CodeEdge>({ allowSelfLoops: false });
  private nodesByFile = new Map<string, Set<string>>();
  private edgesByOwner = new Map<string, Set<string>>();
  private nodesByKind = new Map<string, Set<string>>();
  private priorNodes = new Map<string, string | null>();
  private priorEdges = new Map<string, string | null>();

  get nodeCount(): number {
    return this.graph.order;
  }

  get edgeCount(): number {
    return this.graph.size;
  }

  hasNode(id: string): boolean {
    return this.graph.hasNode(id);
  }

  getNode(id: string): CodeNode | undefined {
    return this.graph.hasNode(id) ? this.graph.getNodeAttributes(id) : undefined;
  }

  getEdge(id: string): CodeEdge | undefined {
    return this.graph.hasEdge(id) ? this.graph.getEdgeAttributes(id) : undefined;
  }

  *nodes(): IterableIterator<CodeNode> {
    for (const { attributes } of this.graph.nodeEntries()) yield attributes;
  }

  *edges(): IterableIterator<CodeEdge> {
    for (const { attributes } of this.graph.edgeEntries()) yield attributes;
  }

  nodeIdsOfFile(file: string): string[] {
    return [...(this.nodesByFile.get(file) ?? [])];
  }

  nodeIdsOfKind(kind: CodeNode['kind']): string[] {
    return [...(this.nodesByKind.get(kind) ?? [])];
  }

  edgeIdsOwnedBy(owner: string): string[] {
    return [...(this.edgesByOwner.get(owner) ?? [])];
  }

  outEdges(id: string, kinds?: readonly CodeEdgeKind[]): CodeEdge[] {
    if (!this.graph.hasNode(id)) return [];
    const out: CodeEdge[] = [];
    this.graph.forEachOutEdge(id, (_e, attrs) => {
      if (!kinds || kinds.includes(attrs.kind)) out.push(attrs);
    });
    return out;
  }

  inEdges(id: string, kinds?: readonly CodeEdgeKind[]): CodeEdge[] {
    if (!this.graph.hasNode(id)) return [];
    const out: CodeEdge[] = [];
    this.graph.forEachInEdge(id, (_e, attrs) => {
      if (!kinds || kinds.includes(attrs.kind)) out.push(attrs);
    });
    return out;
  }

  degree(id: string): number {
    return this.graph.hasNode(id) ? this.graph.degree(id) : 0;
  }

  // ── mutations ────────────────────────────────────────────────────────────

  upsertNode(node: CodeNode): void {
    this.rememberNode(node.id);
    if (this.graph.hasNode(node.id)) {
      const prev = this.graph.getNodeAttributes(node.id);
      if (prev.file !== node.file) this.unindexNode(prev);
      this.unindexKind(prev);
      this.graph.replaceNodeAttributes(node.id, node);
    } else {
      this.graph.addNode(node.id, node);
    }
    this.indexNode(node);
  }

  /** Adds the node only if missing (shared nodes such as external services). */
  ensureNode(node: CodeNode): void {
    if (!this.graph.hasNode(node.id)) this.upsertNode(node);
  }

  dropNode(id: string): void {
    if (!this.graph.hasNode(id)) return;
    for (const edgeId of this.graph.edges(id)) this.dropEdge(edgeId);
    const node = this.graph.getNodeAttributes(id);
    this.rememberNode(id);
    this.unindexNode(node);
    this.unindexKind(node);
    this.graph.dropNode(id);
  }

  upsertEdge(edge: CodeEdge): void {
    if (!this.graph.hasNode(edge.source) || !this.graph.hasNode(edge.target) || edge.source === edge.target) return;
    this.rememberEdge(edge.id);
    if (this.graph.hasEdge(edge.id)) {
      const prev = this.graph.getEdgeAttributes(edge.id);
      this.unindexEdge(prev);
      this.graph.replaceEdgeAttributes(edge.id, edge);
    } else {
      this.graph.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, edge);
    }
    this.indexEdge(edge);
  }

  dropEdge(id: string): void {
    if (!this.graph.hasEdge(id)) return;
    this.rememberEdge(id);
    this.unindexEdge(this.graph.getEdgeAttributes(id));
    this.graph.dropEdge(id);
  }

  dropEdgesOwnedBy(owner: string): void {
    for (const id of this.edgeIdsOwnedBy(owner)) this.dropEdge(id);
  }

  /** Returns the diff of everything changed since the previous commit. */
  commit(): CodeDiff {
    const diff = emptyDiff<CodeNode, CodeEdge>();
    for (const [id, before] of this.priorNodes) {
      const now = this.getNode(id);
      if (!now) {
        if (before !== null) diff.removedNodes.push(id);
      } else if (before === null) diff.addedNodes.push(now);
      else if (before !== JSON.stringify(now)) diff.updatedNodes.push(now);
    }
    for (const [id, before] of this.priorEdges) {
      const now = this.getEdge(id);
      if (!now) {
        if (before !== null) diff.removedEdges.push(id);
      } else if (before === null) diff.addedEdges.push(now);
      else if (before !== JSON.stringify(now)) diff.updatedEdges.push(now);
    }
    this.priorNodes.clear();
    this.priorEdges.clear();
    return diff;
  }

  // ── indexes ──────────────────────────────────────────────────────────────

  private rememberNode(id: string): void {
    if (this.priorNodes.has(id)) return;
    const node = this.getNode(id);
    this.priorNodes.set(id, node ? JSON.stringify(node) : null);
  }

  private rememberEdge(id: string): void {
    if (this.priorEdges.has(id)) return;
    const edge = this.getEdge(id);
    this.priorEdges.set(id, edge ? JSON.stringify(edge) : null);
  }

  private indexNode(node: CodeNode): void {
    if (node.file) addTo(this.nodesByFile, node.file, node.id);
    addTo(this.nodesByKind, node.kind, node.id);
  }

  private unindexNode(node: CodeNode): void {
    if (node.file) removeFrom(this.nodesByFile, node.file, node.id);
  }

  private unindexKind(node: CodeNode): void {
    removeFrom(this.nodesByKind, node.kind, node.id);
  }

  private indexEdge(edge: CodeEdge): void {
    if (edge.owner) addTo(this.edgesByOwner, edge.owner, edge.id);
  }

  private unindexEdge(edge: CodeEdge): void {
    if (edge.owner) removeFrom(this.edgesByOwner, edge.owner, edge.id);
  }
}

function addTo(map: Map<string, Set<string>>, key: string, value: string): void {
  let set = map.get(key);
  if (!set) map.set(key, (set = new Set()));
  set.add(value);
}

function removeFrom(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key);
  if (!set) return;
  set.delete(value);
  if (set.size === 0) map.delete(key);
}
