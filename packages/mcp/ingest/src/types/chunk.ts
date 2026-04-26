// author: Claude
import type { ChunkId, DocId, RunId, SectionId, Version } from "./ids";
import type { ChunkStatus, ContentType, SourceType } from "./vocab";

/**
 * The byte + character + line span a chunk covers in the normalized body text
 * (post-Stage-2). Character offsets are the authoritative coordinate system
 * ([§15.1](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#151-encoding-normalization-per-i3)); byte and line offsets are convenience fields derived from mdast.
 */
export type ChunkSpan = {
  byte_offset_start: number;
  byte_offset_end: number;
  char_offset_start: number;
  char_offset_end: number;
  line_start: number;
  line_end: number;
};

/**
 * Type-specific payload ([§6](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#6-complete-chunk-payload-schema-v1) Type-specific fields). v1 only populates the
 * `"doc"` variant; the other shapes are reserved so adding them later is
 * additive, not breaking.
 */
export type TypeSpecific =
  | { content_type: "doc"; version: string }
  | {
      content_type: "endpoint";
      api_name: string;
      method: string;
      path: string;
      api_refs: ReadonlyArray<string>;
    }
  | { content_type: "schema" }
  | {
      content_type: "code";
      repo: string;
      branch: string;
      file_path: string;
      symbol_kind: string;
      symbol_name: string;
      language: string;
    }
  | { content_type: "conversation" };

/**
 * The canonical in-memory chunk shape. Passed between stages; Stage 10
 * serializes the payload (everything except `content`) to Qdrant, and the
 * `content` + metadata needed for re-embed into SQLite.
 *
 * v1 ships only the fields the retriever actually reads: identity (Pillar 1),
 * provenance (Pillar 2), and the embedding inputs/outputs (Pillar 5). The
 * classifier/structural-feature/relationships pillars from the original SPEC
 * have been deleted — they were stored but never read by retrieval, so their
 * upkeep was pure overhead. If filter-based retrieval ("only category=runbook")
 * is needed later, restore the relevant pillar at that time.
 */
export type Chunk = {
  // Pillar 1 — Identity
  chunk_id: ChunkId;
  doc_id: DocId;
  version: Version;
  section_id: SectionId;
  source_type: SourceType;
  content_type: ContentType;
  schema_version: number;
  chunk_index_in_document: number;
  chunk_index_in_section: number;
  is_latest: boolean;

  // Pillar 2 — Provenance
  source_uri: string;
  source_system: string;
  document_title: string;
  heading_path: ReadonlyArray<string>;
  span: ChunkSpan;
  content_hash: string;
  source_modified_at: string | undefined;
  ingested_at: string;
  ingested_by: RunId;

  // Pillar 5 — Embedding inputs + outputs
  contextual_summary: string;
  embed_text: string;
  is_continuation: boolean;

  type_specific: TypeSpecific;

  /** SQLite-only. Never part of Qdrant payload outside the `content` field; never logged (I7). */
  content: string;

  embedding_model_name: string;
  embedding_model_version: string;
  embedding_dim: number;
  embedded_at: string;

  status: ChunkStatus;
};
