// author: Claude
/**
 * Controlled vocabularies ([§12](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#12-controlled-vocabularies), Appendix D) as runtime `as const` tuples.
 *
 * Each array is the single source of truth for its domain. Zod schemas derive
 * their enums from these arrays via `z.enum(VALUES)`; TypeScript union types
 * derive via `(typeof VALUES)[number]`. Never hand-type the values elsewhere.
 *
 * Adding a new value is additive ([§11](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#11-deterministic-id-scheme) schema policy) — no `schema_version` bump.
 * Removing a value is a breaking change.
 */

export const CATEGORY_VALUES = [
  "tutorial",
  "how-to",
  "reference",
  "explanation",
  "policy",
  "spec",
  "release-notes",
  "changelog",
  "incident",
  "runbook",
  "decision-record",
  "api-doc",
  "code-doc",
  "faq",
  "glossary",
] as const;
export type Category = (typeof CATEGORY_VALUES)[number];

export const SECTION_ROLE_VALUES = [
  "overview",
  "concept",
  "procedure",
  "reference",
  "example",
  "warning",
  "rationale",
  "appendix",
] as const;
export type SectionRole = (typeof SECTION_ROLE_VALUES)[number];

export const ANSWER_SHAPE_VALUES = [
  "definition",
  "step-by-step",
  "code-example",
  "comparison",
  "decision",
  "concept",
  "lookup",
] as const;
export type AnswerShape = (typeof ANSWER_SHAPE_VALUES)[number];

export const AUDIENCE_VALUES = [
  "engineering",
  "ops",
  "security",
  "data-science",
  "product",
  "design",
  "sales",
  "support",
  "legal",
  "finance",
  "executive",
  "general",
] as const;
export type Audience = (typeof AUDIENCE_VALUES)[number];

export const SENSITIVITY_VALUES = [
  "public",
  "internal",
  "confidential",
  "restricted",
] as const;
export type Sensitivity = (typeof SENSITIVITY_VALUES)[number];

export const LIFECYCLE_VALUES = [
  "draft",
  "review",
  "published",
  "deprecated",
  "archived",
] as const;
export type LifecycleStatus = (typeof LIFECYCLE_VALUES)[number];

export const STABILITY_VALUES = ["stable", "evolving", "experimental"] as const;
export type Stability = (typeof STABILITY_VALUES)[number];

export const TEMPORAL_VALUES = ["timeless", "current", "historical"] as const;
export type TemporalScope = (typeof TEMPORAL_VALUES)[number];

export const TRUST_TIER_VALUES = [
  "first-party",
  "derived",
  "third-party",
  "user-generated",
] as const;
export type SourceTrustTier = (typeof TRUST_TIER_VALUES)[number];

export const SOURCE_TYPE_VALUES = ["internal", "external"] as const;
export type SourceType = (typeof SOURCE_TYPE_VALUES)[number];

export const CONTENT_TYPE_VALUES = [
  "doc",
  "endpoint",
  "schema",
  "code",
  "conversation",
] as const;
export type ContentType = (typeof CONTENT_TYPE_VALUES)[number];

export const SOURCE_SYSTEM_VALUES = [
  "confluence",
  "onedrive",
  "github",
  "gitlab",
  "openapi",
  "local",
  "s3",
  "notion",
  "slack",
  "other",
] as const;
export type SourceSystem = (typeof SOURCE_SYSTEM_VALUES)[number];

export const FRESHNESS_DECAY_VALUES = [
  "slow",
  "medium",
  "fast",
  "never",
] as const;
export type FreshnessDecay = (typeof FRESHNESS_DECAY_VALUES)[number];

export const DOCUMENT_STATUS_VALUES = [
  "pending",
  "parsed",
  "chunked",
  "contextualized",
  "embedded",
  "stored",
  "failed",
  "skipped_empty",
  "skipped_metadata_only",
  "deleted",
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUS_VALUES)[number];

export const CHUNK_STATUS_VALUES = [
  "pending",
  "contextualized",
  "embedded",
  "stored",
  "failed",
] as const;
export type ChunkStatus = (typeof CHUNK_STATUS_VALUES)[number];

export const INGEST_STAGE_VALUES = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "startup",
  "reconcile",
  "re-embed",
] as const;
export type IngestStage = (typeof INGEST_STAGE_VALUES)[number];

export const RUN_TRIGGER_VALUES = [
  "cli",
  "api",
  "reconcile",
  "re-embed",
  "init",
] as const;
export type RunTrigger = (typeof RUN_TRIGGER_VALUES)[number];

export const RECONCILE_EVENT_TYPE_VALUES = [
  "soft_delete_document",
  "hard_delete_chunks",
  "qdrant_orphan_deleted",
  "dry_run_would_delete",
] as const;
export type ReconcileEventType = (typeof RECONCILE_EVENT_TYPE_VALUES)[number];

export const RECONCILE_REASON_VALUES = [
  "file_vanished",
  "qdrant_orphan",
  "manual_purge",
] as const;
export type ReconcileReason = (typeof RECONCILE_REASON_VALUES)[number];

/**
 * Shipped tag vocabulary. Classifier output is filtered against
 * `TAGS_DEFAULT ∪ config.classifier.tag_extensions`; unknown tags are dropped
 * with an `ingestion_errors` row ([§18.5](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#185-vocab-filtering-for-tags)). This list is intentionally small —
 * operators extend via `config.yaml`, never via code changes.
 */
export const TAGS_DEFAULT: ReadonlyArray<string> = [
  "oauth",
  "refresh-token",
  "http",
  "security",
  "deployment",
  "configuration",
  "migration",
  "performance",
  "testing",
  "monitoring",
  "logging",
  "error-handling",
  "architecture",
  "api",
  "database",
];

/**
 * Default mapping from `source_system` to `source_type` ([§12](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#12-controlled-vocabularies)).
 * Operators override per-path via `config.yaml`.
 */
export const SOURCE_SYSTEM_TO_SOURCE_TYPE: Readonly<Record<SourceSystem, SourceType>> = {
  confluence: "internal",
  onedrive: "internal",
  github: "internal",
  gitlab: "internal",
  openapi: "external",
  local: "internal",
  s3: "internal",
  notion: "internal",
  slack: "internal",
  other: "external",
};

/**
 * Seeds the Pillar 4 `authority_source_score` at ingest ([§12](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#12-controlled-vocabularies)). Initial value
 * only; runtime systems update the field post-ingest.
 */
export const SOURCE_SYSTEM_TO_AUTHORITY_SCORE: Readonly<Record<SourceSystem, number>> = {
  confluence: 0.7,
  onedrive: 0.5,
  github: 0.8,
  gitlab: 0.8,
  openapi: 0.9,
  local: 0.6,
  s3: 0.6,
  notion: 0.7,
  slack: 0.3,
  other: 0.5,
};

/**
 * Seeds the Pillar 4 `freshness_decay_profile` by category ([§12](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#12-controlled-vocabularies)). Categories
 * not in this map default to `"medium"`.
 */
export const CATEGORY_TO_FRESHNESS_DECAY: Readonly<Partial<Record<Category, FreshnessDecay>>> = {
  runbook: "fast",
  changelog: "fast",
  "release-notes": "fast",
  incident: "slow",
  "decision-record": "never",
  spec: "medium",
  policy: "medium",
  "how-to": "medium",
  explanation: "medium",
  reference: "slow",
  "api-doc": "slow",
  "code-doc": "slow",
  tutorial: "slow",
  faq: "medium",
  glossary: "never",
};
