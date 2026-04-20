import type { ChunkId, DocId, RunId, SectionId, Version } from "./ids";
import type {
  AnswerShape,
  Audience,
  Category,
  ChunkStatus,
  ContentType,
  FreshnessDecay,
  LifecycleStatus,
  SectionRole,
  Sensitivity,
  SourceTrustTier,
  SourceType,
  Stability,
  TemporalScope,
} from "./vocab";

/**
 * The byte + character + line span a chunk covers in the normalized body text
 * (post-Stage-2). Character offsets are the authoritative coordinate system
 * ([§15.1](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#151-encoding-normalization-per-i3)); byte and line offsets are convenience fields derived from mdast.
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
 * Pillar 3 — Classification. Populated by Stage 5; falls back to configured
 * defaults when the classifier fails ([§18.6](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#186-failure-handling-and-fallbacks)–18.7).
 */
export type ChunkClassification = {
  namespace: string;
  project: string | undefined;
  category: Category;
  section_role: SectionRole;
  answer_shape: AnswerShape;
  audience: ReadonlyArray<Audience>;
  audience_technicality: 1 | 2 | 3 | 4 | 5;
  sensitivity: Sensitivity;
  lifecycle_status: LifecycleStatus;
  stability: Stability;
  temporal_scope: TemporalScope;
  source_trust_tier: SourceTrustTier;
  prerequisites: ReadonlyArray<string>;
  self_contained: boolean;
  negation_heavy: boolean;
  tags: ReadonlyArray<string>;
};

/**
 * Deterministic, parse-time features ([§6](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#6-complete-chunk-payload-schema-v1) Pillar 5, [§17.3](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#173-per-chunk-free-fields)). Immutable for a
 * given version.
 */
export type ChunkStructuralFeatures = {
  token_count: number;
  char_count: number;
  contains_code: boolean;
  code_languages: ReadonlyArray<string>;
  has_table: boolean;
  has_list: boolean;
  link_density: number;
  language: string | undefined;
};

/**
 * Pillar 4 runtime signals ([§6](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#6-complete-chunk-payload-schema-v1)). Ingest writes initial values only; retrieval
 * and feedback systems update these post-ingest.
 */
export type ChunkRuntimeSignals = {
  quality_score: number;
  freshness_decay_profile: FreshnessDecay;
  authority_source_score: number;
  authority_author_score: number;
  retrieval_count: number;
  citation_count: number;
  user_marked_wrong_count: number;
  last_validated_at: string | undefined;
  deprecated: boolean;
};

/**
 * Pillar 6 relationships. v1 populates only the link-resolvable subset; the
 * rest are reserved stubs with defined shapes so future phases do not require
 * re-ingest ([§20](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#20-stage-7--relationship--reference-extraction)).
 */
export type ChunkRelationships = {
  references: ReadonlyArray<{ doc_id: DocId } | { section_id: SectionId }>;
  external_links: ReadonlyArray<string>;
  unresolved_links: ReadonlyArray<string>;
  canonical_for: ReadonlyArray<string>;
  siblings: ReadonlyArray<ChunkId>;
  previous_chunk_id: ChunkId | undefined;
  next_chunk_id: ChunkId | undefined;
  supersedes: ChunkId | undefined;
  superseded_by: ChunkId | undefined;
};

/**
 * Type-specific payload ([§6](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#6-complete-chunk-payload-schema-v1) Type-specific fields). v1 only populates the
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
 * The canonical in-memory chunk shape ([§6](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#6-complete-chunk-payload-schema-v1)). Passed between stages; Stage 10
 * serializes the payload (everything except `content`) to Qdrant, and the
 * `content` + metadata needed for re-embed into SQLite.
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

  // Pillar 3
  classification: ChunkClassification;

  // Pillar 4
  structural_features: ChunkStructuralFeatures;
  runtime_signals: ChunkRuntimeSignals;

  // Pillar 5
  contextual_summary: string;
  embed_text: string;
  is_continuation: boolean;

  // Pillar 6
  relationships: ChunkRelationships;

  type_specific: TypeSpecific;

  /** SQLite-only. Never part of Qdrant payload outside the `content` field; never logged (I7). */
  content: string;

  embedding_model_name: string;
  embedding_model_version: string;
  embedding_dim: number;
  embedded_at: string;

  status: ChunkStatus;
};
