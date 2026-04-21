// author: Claude
/**
 * Typed error classes for bench-specific failure modes.
 *
 * Each class maps to a CLI exit code (§28):
 *
 * - `1` — fatal/config errors (FactGenerationError, CorpusValidationError,
 *   CorpusTamperedError, GroundTruthResolutionError, PromptTemplateError).
 * - `2` — run-dir lock contention (LockContentionError).
 * - `3` — integrity / budget (IntegrityViolationError,
 *   JudgeIntegrityError, JudgeBatchExpiredError, BudgetExceededError).
 * - `4` — operator abort at a confirmation prompt (OperatorAbortError).
 * - `64` — usage error (UsageError).
 *
 * Callers `instanceof`-check to decide between rethrow, log + exit, or
 * structured error-result, per CLAUDE.md's typed-error rule.
 */

/** Stage 1 validation failed — template bug, not an operator bug. Exit 1. */
export class FactGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FactGenerationError";
  }
}

/** Stage 2 validator could not produce a document with all planted hints after max_retries. Exit 1. */
export class CorpusValidationError extends Error {
  constructor(
    message: string,
    readonly document_title: string,
    readonly missing_fact_ids: string[],
  ) {
    super(message);
    this.name = "CorpusValidationError";
  }
}

/** A corpus file's content hash no longer matches `corpus_manifest.json` (§18 pre-ingest hash check). Exit 1. */
export class CorpusTamperedError extends Error {
  constructor(
    message: string,
    readonly divergent_files: string[],
  ) {
    super(message);
    this.name = "CorpusTamperedError";
  }
}

/** Stage 5 assertion / setup failure (e.g. doc_id mismatch between manifest and mcp's `documents` table). Exit 1. */
export class GroundTruthResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroundTruthResolutionError";
  }
}

/** Stage 5 integrity thresholds tripped — unresolved or embedding-fallback percentage too high. Exit 3. */
export class IntegrityViolationError extends Error {
  constructor(
    message: string,
    readonly unresolved_pct: number,
    readonly embedding_pct: number,
  ) {
    super(message);
    this.name = "IntegrityViolationError";
  }
}

/** Stage 8 UNJUDGED cap exceeded. Exit 3. */
export class JudgeIntegrityError extends Error {
  constructor(
    message: string,
    readonly unjudged_pct: number,
    readonly max_unjudged_pct: number,
  ) {
    super(message);
    this.name = "JudgeIntegrityError";
  }
}

/** Batch API didn't transition to `ended` within the 24h poll ceiling. Exit 3. */
export class JudgeBatchExpiredError extends Error {
  constructor(readonly batch_id: string) {
    super(`Batch ${batch_id} did not complete within the configured timeout`);
    this.name = "JudgeBatchExpiredError";
  }
}

/** Budget cap exceeded — accumulated cost exceeds `config.cost.max_budget_usd`. Exit 3. */
export class BudgetExceededError extends Error {
  constructor(
    message: string,
    readonly spent_usd: number,
    readonly cap_usd: number,
  ) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

/** Provider rate-limit retries exhausted. Propagates up and aborts the run. */
export class ProviderRateLimitExhausted extends Error {
  constructor(readonly provider: string) {
    super(`Rate-limit retries exhausted for provider ${provider}`);
    this.name = "ProviderRateLimitExhausted";
  }
}

/** Prompt template had an unfilled `{{placeholder}}` at send time. Exit 1. */
export class PromptTemplateError extends Error {
  constructor(
    readonly template: string,
    readonly unfilled: string[],
  ) {
    super(
      `Unfilled placeholders in template "${template}": ${unfilled.join(", ")}`,
    );
    this.name = "PromptTemplateError";
  }
}

/** Operator declined a confirmation prompt. Exit 4. */
export class OperatorAbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperatorAbortError";
  }
}

/** Another bench process is writing to the same run dir. Exit 2. */
export class LockContentionError extends Error {
  constructor(readonly run_dir: string) {
    super(`Run directory is locked by another process: ${run_dir}`);
    this.name = "LockContentionError";
  }
}

/** Bad CLI usage — missing argument, unknown subcommand, etc. Exit 64. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}
