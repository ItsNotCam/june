// author: Claude
import { z } from "zod";
import {
  CHUNK_STATUS_VALUES,
  CONTENT_TYPE_VALUES,
  SOURCE_TYPE_VALUES,
} from "@/types/vocab";

const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);
const UlidZ = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);

/**
 * Validates a full chunk record as it leaves Stage 10 for Qdrant payload +
 * SQLite row. The `content` field is Qdrant-payload *and* SQLite-authoritative
 * per [§6](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#6-complete-chunk-payload-schema-v1); retrieval may serve it without a sidecar fetch (Appendix H6).
 *
 * ID fields are plain hex strings here. Callers brand via `asChunkId`,
 * `asDocId`, etc. at the usage boundary — this keeps the schema usable from
 * both runtime (Qdrant JSON) and SQLite reads.
 */

const ChunkSpanSchema = z.object({
  byte_offset_start: z.number().int().nonnegative(),
  byte_offset_end: z.number().int().nonnegative(),
  char_offset_start: z.number().int().nonnegative(),
  char_offset_end: z.number().int().nonnegative(),
  line_start: z.number().int().nonnegative(),
  line_end: z.number().int().nonnegative(),
});

const TypeSpecificSchema = z.discriminatedUnion("content_type", [
  z.object({ content_type: z.literal("doc"), version: z.string() }),
  z.object({
    content_type: z.literal("endpoint"),
    api_name: z.string(),
    method: z.string(),
    path: z.string(),
    api_refs: z.array(z.string()),
  }),
  z.object({ content_type: z.literal("schema") }),
  z.object({
    content_type: z.literal("code"),
    repo: z.string(),
    branch: z.string(),
    file_path: z.string(),
    symbol_kind: z.string(),
    symbol_name: z.string(),
    language: z.string(),
  }),
  z.object({ content_type: z.literal("conversation") }),
]);

export const ChunkSchema = z.object({
  // Pillar 1
  chunk_id: Sha256Hex,
  doc_id: Sha256Hex,
  version: z.string().min(1),
  section_id: Sha256Hex,
  source_type: z.enum(SOURCE_TYPE_VALUES),
  content_type: z.enum(CONTENT_TYPE_VALUES),
  schema_version: z.number().int().positive(),
  chunk_index_in_document: z.number().int().nonnegative(),
  chunk_index_in_section: z.number().int().nonnegative(),
  is_latest: z.boolean(),

  // Pillar 2
  source_uri: z.string().min(1),
  source_system: z.string().min(1),
  document_title: z.string(),
  heading_path: z.array(z.string()),
  span: ChunkSpanSchema,
  content_hash: Sha256Hex,
  source_modified_at: z.string().optional(),
  ingested_at: z.string(),
  ingested_by: UlidZ,

  // Pillar 5 — Embedding inputs + outputs
  contextual_summary: z.string(),
  embed_text: z.string(),
  is_continuation: z.boolean(),

  type_specific: TypeSpecificSchema,

  content: z.string(),

  embedding_model_name: z.string(),
  embedding_model_version: z.string(),
  embedding_dim: z.number().int().positive(),
  embedded_at: z.string(),

  status: z.enum(CHUNK_STATUS_VALUES),
});

export type ChunkJson = z.infer<typeof ChunkSchema>;
