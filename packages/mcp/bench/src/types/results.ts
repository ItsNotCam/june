// author: Claude
import type { QueryTier } from "./query";
import type { Verdict } from "./verdict";

/**
 * A metric reported with its bootstrap 95% CI and provenance trail (§30).
 *
 * `query_ids` is the I-EVAL-1 provenance: the per-query records that fed this
 * aggregate. Summary markdown can drill back to `results.json.per_query[id]`
 * without guessing.
 */
export type MetricWithCi = {
  point: number;
  ci_low: number;
  ci_high: number;
  query_ids: string[];
};

/** Per-tier aggregate record (§30.1). */
export type TierAggregates = {
  query_count: number;
  recall_at_1: MetricWithCi;
  recall_at_3: MetricWithCi;
  recall_at_5: MetricWithCi;
  recall_at_10: MetricWithCi;
  mrr: MetricWithCi;
  reader_correct_pct: MetricWithCi;
  reader_hallucinated_pct: MetricWithCi;
  reader_refused_pct: MetricWithCi;
  unjudged_pct: number;
  /**
   * T5 only; null for T1–T4. Bare median without CI by design (§30.1) — a
   * diagnostic rather than a headline; percentile-CI on a median would require
   * a different bootstrap recipe for no operator-visible benefit.
   */
  t5_top1_score_median: number | null;
};

/**
 * Narrow headline aggregates (§30.1).
 *
 * Deliberately smaller than `TierAggregates`: carries only the four headline
 * numbers that answer the bar question and feed `compare`'s delta table.
 */
export type OverallAggregates = {
  reader_correct_pct: MetricWithCi;
  recall_at_5: MetricWithCi;
  recall_at_10: MetricWithCi;
  mrr: MetricWithCi;
};

/** Per-query record preserving the full audit trail (§30.1). */
export type PerQueryRecord = {
  query_id: string;
  tier: QueryTier;
  query_text: string;
  expected_fact_ids: string[];
  retrieved_chunk_ids: string[];
  reader_answer: string;
  verdict: Verdict;
  rationale: string;
  recall_at_k: Record<"1" | "3" | "5" | "10", number>;
  mrr: number;
  t5_top1_score: number | null;
  /** Populated only for the optional no-RAG Opus baseline pass (§23). */
  baseline_answer: string | null;
  baseline_verdict: Verdict | null;
};

/** Per-run manifest — every provider + every metadata fact (§30.1). */
export type RunManifest = {
  fixture_id: string;
  fixture_hash: string;
  fixture_seed: number;
  run_id: string;
  bench_version: string;
  schema_version: 1;
  started_at: string;
  completed_at: string;
  roles: {
    corpus_author: { provider: string; model: string };
    query_author: { provider: string; model: string };
    reader: { provider: string; model: string; temperature: number };
    judge: { provider: "anthropic-batch"; model: string };
    baseline: { provider: string; model: string; temperature: number } | null;
  };
  june: {
    ingest_run_id: string;
    schema_version: number;
    embedding_model: string;
    embedding_model_version: string;
  };
  retrieval_config_snapshot: Record<string, unknown>;
  caching_enabled: boolean;
  budget_cap_usd: number;
};

/**
 * Run status (§30.1).
 *
 * `completed` is the clean finish. The `aborted_*` variants capture the
 * partial-write cases §§19/22/27 produce when integrity or budget caps
 * trip. `results.json` still carries every field Stage 9 could compute;
 * downstream tooling surfaces the status before quoting the numbers.
 */
export type RunStatus =
  | "completed"
  | "aborted_integrity_resolution"
  | "aborted_integrity_judge"
  | "aborted_budget"
  | "aborted_corpus_tampered";

/** On-disk shape of `results.json` — the single source of truth for a run's numbers. */
export type ResultsFile = {
  fixture_id: string;
  run_id: string;
  schema_version: 1;
  run_status: RunStatus;
  started_at: string;
  completed_at: string;
  manifest: RunManifest;
  per_query: PerQueryRecord[];
  per_tier: Record<QueryTier, TierAggregates>;
  overall: { macro: OverallAggregates; micro: OverallAggregates };
  integrity: {
    unresolved_pct: number;
    embedding_pct: number;
    unjudged_pct: number;
    queries_with_leakage_warning: number;
  };
  cost_usd: {
    role_1: number;
    role_2: number;
    role_3: number;
    role_4: number;
    total: number;
  };
};
