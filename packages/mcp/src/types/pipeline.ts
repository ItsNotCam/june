// author: Claude
import type { Root as MdastRoot } from "mdast";
import type { Chunk, ChunkClassification } from "./chunk";
import type { Document } from "./document";
import type { ChunkId } from "./ids";
import type { Section } from "./section";

/**
 * Wire types between pipeline stages ([§30.5](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#305-stage-outputs-the-wire-types-between-stages)). Each type is the handoff shape
 * from one stage to the next; stages never reach across a non-adjacent
 * boundary.
 */

/**
 * Stage 2 output. `raw_normalized` is UTF-8, LF-only, with zero-width
 * characters stripped ([§15.1](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#151-encoding-normalization-per-i3)). Character offsets downstream reference
 * positions in this string.
 */
export type ParsedDocument = {
  document: Document;
  ast: MdastRoot;
  raw_normalized: string;
};

/** Stage 3 output. Sections + unclassified chunks carry forward into Stages 4–7. */
export type ChunkedDocument = {
  document: Document;
  sections: ReadonlyArray<Section>;
  chunks: ReadonlyArray<UnclassifiedChunk>;
};

/**
 * A chunk after Stage 3 but before Stages 4–9 populate the remaining Pillar
 * fields. Computed structural features are present; classification, summary,
 * relationships, runtime signals, and embedding metadata arrive later.
 */
export type UnclassifiedChunk = Omit<
  Chunk,
  | "classification"
  | "runtime_signals"
  | "contextual_summary"
  | "embed_text"
  | "relationships"
  | "embedding_model_name"
  | "embedding_model_version"
  | "embedding_dim"
  | "embedded_at"
>;

/**
 * Stage 5 output per chunk. `raw_response` is the JSON string the classifier
 * returned — retained for audit (first 200 chars max, I7-safe by construction
 * because the classifier output is schema-shaped JSON, not arbitrary content).
 */
export type ClassifierOutput = {
  chunk_id: ChunkId;
  classification: ChunkClassification;
  raw_response: string;
};

/** Stage 6 output per chunk. `used_long_doc_path` records which prompt variant ran. */
export type SummarizerOutput = {
  chunk_id: ChunkId;
  contextual_summary: string;
  used_long_doc_path: boolean;
};

/**
 * Stage 9 output per chunk. `vector` is the dense embedding (L2-normalized by
 * the embedder); `bm25_terms` is the client-side sparse representation that
 * Stage 10 converts to `{ indices, values }` for Qdrant upsert.
 */
export type EmbeddingResult = {
  chunk_id: ChunkId;
  vector: ReadonlyArray<number>;
  bm25_terms: ReadonlyArray<{ token: string; weight: number }>;
  model_name: string;
  model_version: string;
  dim: number;
};
