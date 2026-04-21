// author: Claude
import type { Chunk } from "@/types/chunk";
import type { Document } from "@/types/document";
import type { ChunkId, DocId, RunId, Version } from "@/types/ids";
import type { Section } from "@/types/section";
import type { IngestionError, IngestionRun, ReconcileEvent } from "@/types/run";
import type { ChunkStatus, DocumentStatus } from "@/types/vocab";

/**
 * Transaction handle. Commit / rollback is the caller's responsibility; the
 * sidecar implementation guarantees either-or semantics.
 */
export type Tx = {
  commit(): Promise<void> | void;
  rollback(): Promise<void> | void;
};

/**
 * Combined storage surface passed into the pipeline. Vector and sidecar live
 * on this single struct so the factory can inject both together.
 */
export type StorageInterface = {
  readonly vector: VectorStorage;
  readonly sidecar: SidecarStorage;
};

/**
 * The shape of a point headed into Qdrant. The caller (Stage 10) assembles
 * these from `Chunk` + `EmbeddingResult` + sibling enumeration.
 */
export type VectorPoint = {
  chunk_id: ChunkId;
  /** UUID-shaped Qdrant point ID derived from the chunk_id per [§11](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#11-deterministic-id-scheme). */
  point_id: string;
  dense: ReadonlyArray<number>;
  sparse: { indices: number[]; values: number[] };
  payload: Record<string, unknown>;
  collection: "internal" | "external";
};

/**
 * Swappable vector-store interface. v1 ships `createQdrantStorage`; future
 * backends (pgvector, Weaviate) implement the same interface.
 */
export type VectorStorage = {
  readonly name: string;
  /** Idempotent setup — called by `init` and at every pipeline startup. */
  ensureCollections(dim: number): Promise<void>;
  upsert(points: ReadonlyArray<VectorPoint>): Promise<void>;
  /** Flips `is_latest=false` on every point for (doc_id, prior_version). Returns the count flipped. */
  flipIsLatest(
    collection: "internal" | "external",
    doc_id: DocId,
    prior_version: Version,
  ): Promise<number>;
  deletePointsByChunkIds(
    collection: "internal" | "external",
    chunk_ids: ReadonlyArray<ChunkId>,
  ): Promise<number>;
  deletePointsByDocId(
    collection: "internal" | "external",
    doc_id: DocId,
  ): Promise<number>;
  /** Scroll all point IDs for reconciliation orphan detection ([§27.5](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#275-reconcile-command-detailed)). */
  scrollAllChunkIds(
    collection: "internal" | "external",
    batchSize: number,
  ): AsyncIterable<ReadonlyArray<ChunkId>>;
  /** `re-embed` atomically swaps the collection alias once the new collection is populated ([§27.6](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#276-re-embed-command-detailed)). */
  swapEmbedAlias(
    alias: "internal" | "external",
    new_collection: string,
  ): Promise<void>;
  /** Reachability probe for `june health`. Returns `true` if Qdrant responds; `false` otherwise. */
  probeReachable(): Promise<boolean>;
};

/**
 * Swappable SQL sidecar. v1 ships `createSqliteSidecar`; the interface is
 * dialect-agnostic so Postgres / MSSQL can slot in later.
 */
export type SidecarStorage = {
  readonly dialect: "sqlite" | "postgres" | "mssql";
  begin(): Promise<Tx> | Tx;

  // Single-writer lock (I2)
  acquireWriteLock(run_id: RunId): Promise<void>;
  heartbeat(run_id: RunId): Promise<void>;
  releaseWriteLock(run_id: RunId): Promise<void>;

  // Runs
  putRun(run: IngestionRun): Promise<void>;
  updateRun(run_id: RunId, patch: Partial<Omit<IngestionRun, "run_id">>): Promise<void>;

  // Documents
  upsertDocument(tx: Tx, doc: Document): Promise<void>;
  getLatestDocumentByUri(source_uri: string): Promise<Document | undefined>;
  getLatestDocument(doc_id: DocId): Promise<Document | undefined>;
  getDocument(doc_id: DocId, version: Version): Promise<Document | undefined>;
  setDocumentStatus(
    tx: Tx,
    doc_id: DocId,
    version: Version,
    status: DocumentStatus,
  ): Promise<void>;
  flipPriorIsLatest(
    tx: Tx,
    doc_id: DocId,
    new_version: Version,
  ): Promise<void>;
  clearDeletedAt(tx: Tx, doc_id: DocId): Promise<void>;
  listLatestDocuments(): Promise<ReadonlyArray<Document>>;
  listDocumentsByStatus(
    status: DocumentStatus,
  ): Promise<ReadonlyArray<Document>>;
  listVersionsForDoc(doc_id: DocId): Promise<ReadonlyArray<Document>>;

  // Sections
  putSections(tx: Tx, sections: ReadonlyArray<Section>): Promise<void>;
  getSectionsForDoc(
    doc_id: DocId,
    version: Version,
  ): Promise<ReadonlyArray<Section>>;

  // Chunks
  putChunks(tx: Tx, chunks: ReadonlyArray<Chunk>): Promise<void>;
  setChunkStatus(tx: Tx, chunk_id: ChunkId, status: ChunkStatus): Promise<void>;
  setChunkSummary(
    tx: Tx,
    chunk_id: ChunkId,
    contextual_summary: string,
  ): Promise<void>;
  setChunkEmbedded(
    tx: Tx,
    chunk_id: ChunkId,
    model_name: string,
    model_version: string,
    embedded_at: string,
  ): Promise<void>;
  getChunksForDoc(
    doc_id: DocId,
    version: Version,
  ): Promise<ReadonlyArray<Chunk>>;
  getChunksByStatus(
    doc_id: DocId,
    version: Version,
    status: ChunkStatus,
  ): Promise<ReadonlyArray<Chunk>>;
  chunkExistsInSidecar(chunk_id: ChunkId): Promise<boolean>;
  /**
   * Count chunks whose persisted `embedding_model_name` does NOT match the
   * given value, restricted to terminally-embedded states. Drives [§24.6](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#246-resume-across-embedding-model-changes)'s
   * resume warning: if the current env var disagrees with what's in the
   * sidecar, resume warns instead of silently re-embedding.
   */
  countChunksWithDifferentEmbeddingModel(expected_model: string): Promise<number>;

  // Errors + reconcile events
  recordError(err: Omit<IngestionError, "id">): Promise<number>;
  recordReconcileEvent(ev: Omit<ReconcileEvent, "id">): Promise<number>;

  // Lifecycle
  close(): Promise<void> | void;
  /** Reachability probe for `june health`. */
  probeReachable(): Promise<boolean>;
};
