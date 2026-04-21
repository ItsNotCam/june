// author: Claude
import { z } from "zod";
import {
  ANSWER_SHAPE_VALUES,
  AUDIENCE_VALUES,
  CATEGORY_VALUES,
  CHUNK_STATUS_VALUES,
  CONTENT_TYPE_VALUES,
  FRESHNESS_DECAY_VALUES,
  LIFECYCLE_VALUES,
  SECTION_ROLE_VALUES,
  SENSITIVITY_VALUES,
  SOURCE_TYPE_VALUES,
  STABILITY_VALUES,
  TEMPORAL_VALUES,
  TRUST_TIER_VALUES,
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

const ChunkClassificationSchema = z.object({
  namespace: z.string().min(1),
  project: z.string().min(1).optional(),
  category: z.enum(CATEGORY_VALUES),
  section_role: z.enum(SECTION_ROLE_VALUES),
  answer_shape: z.enum(ANSWER_SHAPE_VALUES),
  audience: z.array(z.enum(AUDIENCE_VALUES)).min(1).max(3),
  audience_technicality: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  sensitivity: z.enum(SENSITIVITY_VALUES),
  lifecycle_status: z.enum(LIFECYCLE_VALUES),
  stability: z.enum(STABILITY_VALUES),
  temporal_scope: z.enum(TEMPORAL_VALUES),
  source_trust_tier: z.enum(TRUST_TIER_VALUES),
  prerequisites: z.array(z.string()),
  self_contained: z.boolean(),
  negation_heavy: z.boolean(),
  tags: z.array(z.string()),
});

const ChunkStructuralFeaturesSchema = z.object({
  token_count: z.number().int().nonnegative(),
  char_count: z.number().int().nonnegative(),
  contains_code: z.boolean(),
  code_languages: z.array(z.string()),
  has_table: z.boolean(),
  has_list: z.boolean(),
  link_density: z.number().nonnegative(),
  language: z.string().optional(),
});

const ChunkRuntimeSignalsSchema = z.object({
  quality_score: z.number().min(0).max(1),
  freshness_decay_profile: z.enum(FRESHNESS_DECAY_VALUES),
  authority_source_score: z.number().min(0).max(1),
  authority_author_score: z.number().min(0).max(1),
  retrieval_count: z.number().int().nonnegative(),
  citation_count: z.number().int().nonnegative(),
  user_marked_wrong_count: z.number().int().nonnegative(),
  last_validated_at: z.string().optional(),
  deprecated: z.boolean(),
});

const ChunkRelationshipsSchema = z.object({
  references: z.array(
    z.union([
      z.object({ doc_id: Sha256Hex }),
      z.object({ section_id: Sha256Hex }),
    ]),
  ),
  external_links: z.array(z.string()),
  unresolved_links: z.array(z.string()),
  canonical_for: z.array(z.string()),
  siblings: z.array(Sha256Hex),
  previous_chunk_id: Sha256Hex.optional(),
  next_chunk_id: Sha256Hex.optional(),
  supersedes: Sha256Hex.optional(),
  superseded_by: Sha256Hex.optional(),
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

  // Pillar 3
  classification: ChunkClassificationSchema,

  // Pillar 4
  structural_features: ChunkStructuralFeaturesSchema,
  runtime_signals: ChunkRuntimeSignalsSchema,

  // Pillar 5
  contextual_summary: z.string(),
  embed_text: z.string(),
  is_continuation: z.boolean(),

  // Pillar 6
  relationships: ChunkRelationshipsSchema,

  type_specific: TypeSpecificSchema,

  content: z.string(),

  embedding_model_name: z.string(),
  embedding_model_version: z.string(),
  embedding_dim: z.number().int().positive(),
  embedded_at: z.string(),

  status: z.enum(CHUNK_STATUS_VALUES),
});

export type ChunkJson = z.infer<typeof ChunkSchema>;
