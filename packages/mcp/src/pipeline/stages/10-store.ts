// author: Claude
import { chunkIdToQdrantPointId } from "@/lib/ids";
import { logger } from "@/lib/logger";
import type { SidecarStorage, Tx, VectorPoint, VectorStorage } from "@/lib/storage/types";
import type { Chunk, ChunkRelationships } from "@/types/chunk";
import type { Document } from "@/types/document";
import type { ChunkId, RunId, Version } from "@/types/ids";
import type { EmbeddedChunk } from "./09-embed";

/**
 * Stage 10 — Storage Commit ([§23](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#23-stage-10--storage-commit)).
 *
 * Assembles Qdrant points (including sibling lists and previous/next chunk
 * ids), upserts to Qdrant, flips `is_latest` on the prior version, and
 * commits the SQLite half in a single transaction.
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

const buildRelationships = (
  self: EmbeddedChunk,
  all: ReadonlyArray<EmbeddedChunk>,
): ChunkRelationships => {
  const prev = all.find(
    (c) => c.chunk_index_in_document === self.chunk_index_in_document - 1,
  );
  const next = all.find(
    (c) => c.chunk_index_in_document === self.chunk_index_in_document + 1,
  );
  const siblings = all
    .filter(
      (c) =>
        c.section_id === self.section_id && c.chunk_id !== self.chunk_id,
    )
    .sort((a, b) => a.chunk_index_in_section - b.chunk_index_in_section)
    .map((c) => c.chunk_id);
  return {
    ...self.relationships,
    previous_chunk_id: prev?.chunk_id,
    next_chunk_id: next?.chunk_id,
    siblings,
  };
};

const buildPoint = (
  doc: Document,
  chunk: EmbeddedChunk,
  relationships: ChunkRelationships,
): VectorPoint => {
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
    namespace: chunk.classification.namespace,
    project: chunk.classification.project,
    category: chunk.classification.category,
    section_role: chunk.classification.section_role,
    answer_shape: chunk.classification.answer_shape,
    audience: chunk.classification.audience,
    audience_technicality: chunk.classification.audience_technicality,
    sensitivity: chunk.classification.sensitivity,
    lifecycle_status: chunk.classification.lifecycle_status,
    stability: chunk.classification.stability,
    temporal_scope: chunk.classification.temporal_scope,
    source_trust_tier: chunk.classification.source_trust_tier,
    prerequisites: chunk.classification.prerequisites,
    self_contained: chunk.classification.self_contained,
    negation_heavy: chunk.classification.negation_heavy,
    tags: chunk.classification.tags,
    contains_code: chunk.structural_features.contains_code,
    code_languages: chunk.structural_features.code_languages,
    has_table: chunk.structural_features.has_table,
    has_list: chunk.structural_features.has_list,
    link_density: chunk.structural_features.link_density,
    token_count: chunk.structural_features.token_count,
    char_count: chunk.structural_features.char_count,
    language: chunk.structural_features.language,
    quality_score: 0.5,
    freshness_decay_profile: "medium",
    authority_source_score: 0.5,
    authority_author_score: 0.5,
    retrieval_count: 0,
    citation_count: 0,
    user_marked_wrong_count: 0,
    deprecated: false,
    contextual_summary: chunk.contextual_summary,
    embed_text: chunk.embed_text,
    is_continuation: chunk.is_continuation,
    references: relationships.references.map((r) =>
      "doc_id" in r
        ? { doc_id: r.doc_id as string }
        : { section_id: r.section_id as string },
    ),
    external_links: relationships.external_links,
    unresolved_links: relationships.unresolved_links,
    canonical_for: relationships.canonical_for,
    siblings: relationships.siblings.map((s) => s as string),
    previous_chunk_id: relationships.previous_chunk_id
      ? (relationships.previous_chunk_id as string)
      : undefined,
    next_chunk_id: relationships.next_chunk_id
      ? (relationships.next_chunk_id as string)
      : undefined,
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
const buildFullChunk = (
  chunk: EmbeddedChunk,
  relationships: ChunkRelationships,
): Chunk => ({
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
  classification: chunk.classification,
  structural_features: chunk.structural_features,
  runtime_signals: {
    quality_score: 0.5,
    freshness_decay_profile: "medium",
    authority_source_score: 0.5,
    authority_author_score: 0.5,
    retrieval_count: 0,
    citation_count: 0,
    user_marked_wrong_count: 0,
    last_validated_at: undefined,
    deprecated: false,
  },
  contextual_summary: chunk.contextual_summary,
  embed_text: chunk.embed_text,
  is_continuation: chunk.is_continuation,
  relationships,
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

  // 1. Assemble payloads with siblings + neighbors.
  const points: VectorPoint[] = [];
  const fullChunks: Chunk[] = [];
  for (const c of input.chunks) {
    const rels = buildRelationships(c, input.chunks);
    points.push(buildPoint(input.document, c, rels));
    fullChunks.push(buildFullChunk(c, rels));
  }

  // 2. Qdrant upsert.
  const collection = input.chunks[0]!.source_type === "external" ? "external" : "internal";
  await input.vector.upsert(points);

  // 3. Flip is_latest on prior version in Qdrant.
  if (input.priorVersion && input.priorVersion !== input.document.version) {
    await input.vector.flipIsLatest(
      collection,
      input.document.doc_id,
      input.priorVersion,
    );
  }

  // 4. SQLite transactional commit: chunk rows + flip + clear deleted_at + doc status.
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
