/**
 * Canonical `error_type` vocabulary ([§25.6](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#256-error-type-vocabulary) / I9).
 *
 * Every non-fatal failure writes an `ingestion_errors` row with one of these
 * values in `error_type`. The const tuple is the single source of truth —
 * callers import `ErrorType` and the exhaustive list lives here, which keeps
 * stage code from inventing one-off strings that SQL queries later can't
 * enumerate.
 *
 * Additive-only: appending a new value is a non-breaking change. Removing or
 * renaming a value is not — historical `ingestion_errors` rows would no longer
 * match the union.
 */
export const ERROR_TYPE_VALUES = [
  // Stage 1 — discover
  "file_too_large",
  "encoding_undetectable",

  // Stage 2 — parse
  "frontmatter_parse_failed",
  "mdast_parse_failed",

  // Stage 3 — chunk
  "oversize_protected_region",

  // Stage 5 — classify
  "classifier_timeout",
  "classifier_unreachable",
  "classifier_model_not_found",
  "classifier_empty_response",
  "classifier_invalid_json",
  "classifier_partial_invalid",
  "classifier_fallback",
  "vocab_unknown_tag",

  // Stage 6 — summarize
  "summarizer_timeout",
  "summarizer_unreachable",
  "summarizer_length_violation",
  "summarizer_invalid_format",
  "summarizer_outline_failed",

  // Stage 8 — embed text
  "embed_text_truncated",

  // Stage 9 — embed
  "embedder_timeout",
  "embedder_unreachable",
  "embedder_model_not_found",
  "embedder_dimension_mismatch",

  // Stage 10 — store
  "qdrant_unreachable",
  "qdrant_validation_failed",
  "qdrant_dimension_mismatch",

  // SQLite
  "sqlite_busy",
  "sqlite_disk_full",

  // Ollama shared
  "ollama_empty_response",
  "ollama_length_violation",
  "ollama_unreachable",

  // Resume / lock / shutdown
  "shutdown_during_stage",
  "lock_broken_stale",
  "embedding_model_mismatch",

  // Catch-all
  "catastrophic",
] as const;

export type ErrorType = (typeof ERROR_TYPE_VALUES)[number];

const ERROR_TYPE_SET: ReadonlySet<string> = new Set(ERROR_TYPE_VALUES);

/**
 * Narrowing predicate — useful at SQLite boundaries where a row's
 * `error_type` column is typed `string` but should be asserted before the
 * value lands on a typed interface.
 */
export const isErrorType = (value: string): value is ErrorType =>
  ERROR_TYPE_SET.has(value);
