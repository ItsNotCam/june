// author: Claude
import { chunkIdToQdrantPointId } from "@/lib/ids";
import { logger } from "@/lib/logger";
import type { SidecarStorage, Tx, VectorPoint, VectorStorage } from "@/lib/storage/types";
import type { Chunk } from "@/types/chunk";
import type { Document } from "@/types/document";
import type { ChunkId, RunId, Version } from "@/types/ids";
import type { EmbeddedChunk } from "./09-embed";

/**
 * Stage 10 — Storage Commit ([§23](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#23-stage-10--storage-commit)).
 *
 * Upserts chunks to Qdrant, flips `is_latest` on the prior version, and
 * commits the SQLite half in a single transaction.
 *
 * The Qdrant payload carries only the fields retrieval and `is_latest`
 * filtering need. Classification, structural-feature, runtime-signal, and
 * relationship pillars from the original SPEC were dropped — they were
 * stored but never read by the retriever.
 */

export type Stage10Input = {
  readonly document: Document;
  readonly chunks: ReadonlyArray<EmbeddedChunk>;
  readonly priorVersion: Version | undefined;
  readonly vector: VectorStorage;
  readonly sidecar: SidecarStorage;
  readonly tx: Tx;
  readonly runId: RunId;
};

export type Stage10Result = {
  readonly committedChunkIds: ReadonlyArray<ChunkId>;
};

const buildPoint = (doc: Document, chunk: EmbeddedChunk): VectorPoint => {
  const collection: "internal" | "external" =
    chunk.source_type === "external" ? "external" : "internal";
  const payload: Record<string, unknown> = {
    chunk_id: chunk.chunk_id as string,
    doc_id: chunk.doc_id as string,
    version: chunk.version as string,
    section_id: chunk.section_id as string,
    source_type: chunk.source_type,
    content_type: chunk.content_type,
    schema_version: chunk.schema_version,
    chunk_index_in_document: chunk.chunk_index_in_document,
    chunk_index_in_section: chunk.chunk_index_in_section,
    is_latest: true,
    source_uri: doc.source_uri,
    source_system: doc.source_system,
    document_title: chunk.document_title,
    heading_path: chunk.heading_path,
    span: chunk.span,
    content_hash: chunk.content_hash,
    source_modified_at: doc.source_modified_at,
    ingested_at: chunk.ingested_at,
    ingested_by: chunk.ingested_by as string,
    contextual_summary: chunk.contextual_summary,
    embed_text: chunk.embed_text,
    is_continuation: chunk.is_continuation,
    type_specific: chunk.type_specific,
    embedding_model_name: chunk.embedding_model_name,
    embedding_model_version: chunk.embedding_model_version,
    embedding_dim: chunk.embedding_dim,
    embedded_at: chunk.embedded_at,
    content: chunk.content,
  };
  return {
    chunk_id: chunk.chunk_id,
    point_id: chunkIdToQdrantPointId(chunk.chunk_id),
    dense: chunk.dense,
    sparse: { indices: [...chunk.sparse.indices], values: [...chunk.sparse.values] },
    payload,
    collection,
  };
};

/**
 * Assemble the final `Chunk` record for SQLite persistence. Stage 10 only
 * needs to update `status = 'stored'` and the embedding metadata — row
 * content is already present from Stage 3.
 */
const buildFullChunk = (chunk: EmbeddedChunk): Chunk => ({
  chunk_id: chunk.chunk_id,
  doc_id: chunk.doc_id,
  version: chunk.version,
  section_id: chunk.section_id,
  source_type: chunk.source_type,
  content_type: chunk.content_type,
  schema_version: chunk.schema_version,
  chunk_index_in_document: chunk.chunk_index_in_document,
  chunk_index_in_section: chunk.chunk_index_in_section,
  is_latest: true,
  source_uri: chunk.source_uri,
  source_system: chunk.source_system,
  document_title: chunk.document_title,
  heading_path: chunk.heading_path,
  span: chunk.span,
  content_hash: chunk.content_hash,
  source_modified_at: chunk.source_modified_at,
  ingested_at: chunk.ingested_at,
  ingested_by: chunk.ingested_by,
  contextual_summary: chunk.contextual_summary,
  embed_text: chunk.embed_text,
  is_continuation: chunk.is_continuation,
  type_specific: chunk.type_specific,
  content: chunk.content,
  embedding_model_name: chunk.embedding_model_name,
  embedding_model_version: chunk.embedding_model_version,
  embedding_dim: chunk.embedding_dim,
  embedded_at: chunk.embedded_at,
  status: "stored",
});

export const runStage10 = async (input: Stage10Input): Promise<Stage10Result> => {
  if (input.chunks.length === 0) {
    return { committedChunkIds: [] };
  }

  const points: VectorPoint[] = [];
  const fullChunks: Chunk[] = [];
  for (const c of input.chunks) {
    points.push(buildPoint(input.document, c));
    fullChunks.push(buildFullChunk(c));
  }

  const collection = input.chunks[0]!.source_type === "external" ? "external" : "internal";
  await input.vector.upsert(points);

  if (input.priorVersion && input.priorVersion !== input.document.version) {
    await input.vector.flipIsLatest(
      collection,
      input.document.doc_id,
      input.priorVersion,
    );
  }

  await input.sidecar.putChunks(input.tx, fullChunks);
  await input.sidecar.flipPriorIsLatest(
    input.tx,
    input.document.doc_id,
    input.document.version,
  );
  await input.sidecar.clearDeletedAt(input.tx, input.document.doc_id);
  await input.sidecar.setDocumentStatus(
    input.tx,
    input.document.doc_id,
    input.document.version,
    "stored",
  );

  logger.info("doc_stored", {
    event: "doc_stored",
    doc_id: input.document.doc_id as string,
    count: input.chunks.length,
  });

  return { committedChunkIds: input.chunks.map((c) => c.chunk_id) };
};
