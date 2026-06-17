// author: Claude
/**
 * Real-document holdout types (§ RSI Phase 4, audit gap #6: 100% synthetic).
 *
 * The synthetic fixture is **fact-native**: planted facts → corpus hints →
 * `expected_fact_ids` → Stage-5 fact→chunk resolution → chunk-level recall. Real
 * documents have **no planted facts**, so the holdout is **doc-native** instead:
 * the corpus is real markdown ingested as-is, and ground truth is a hand-labeled
 * **expected document** per query. Recall@k is scored at the document level ("a
 * chunk from an expected doc appears in top-k"), bypassing Stage 5 entirely.
 *
 * The holdout is **sealed**: it is reported SEPARATELY from the synthetic
 * fixtures and is structurally incapable of becoming a golden — its on-disk
 * result is a `HoldoutResultsFile` (`kind: "holdout"`), never the `ResultsFile`
 * that `control-pin`/`control-check` consume. Synthetic↔holdout divergence is the
 * reward-hacking alarm (a change that lifts the toy score but not the real-doc
 * score is overfitting). See `docs/rsi-foundation-plan.md` Phase 4.
 */

import type { RunMode } from "@/lib/modes";
import type { MetricWithCi, RunStatus } from "@/types/results";
import type { Verdict } from "@/types/verdict";

/**
 * One hand-labeled holdout query. Ground truth is the **document(s)** that
 * contain the answer, recorded by filename (resolved to june `doc_id`s at run
 * time, so the fixture is location-independent like the lock). `gold_answer` is
 * the short reference answer the external judge grades against.
 */
export type HoldoutQuery = {
  /** `q-0001`, … — assigned by `holdout-assemble`. */
  id: string;
  /** The natural-language question. */
  text: string;
  /**
   * Filenames (within `corpus/`) of the document(s) whose chunks should rank in
   * top-k. Exactly one or more for an answerable query; EMPTY for an
   * unanswerable (negative) query — correct behavior there is refusal.
   */
  expected_doc_filenames: string[];
  /** Short reference answer for the judge. Empty for unanswerable queries. */
  gold_answer: string;
  /** True for a negative query whose answer is NOT in the corpus (refusal expected). */
  unanswerable: boolean;
  /** Source URL(s) of the expected doc(s) — provenance only, not scored. */
  source_urls: string[];
};

/** On-disk shape of `holdout_queries.json`. */
export type HoldoutQueriesFile = {
  holdout_id: string;
  schema_version: 1;
  /** The agent that hand-labeled the Q/A (the corpus itself is real, not authored). */
  label_author: { provider: string; model: string };
  queries: HoldoutQuery[];
};

/**
 * Manifest provenance for a holdout run. Focused (vs the synthetic `RunManifest`)
 * — a holdout has no synthetic facts, seed, or corpus/query authors; it has a
 * real `source` and a single `label_author`.
 */
export type HoldoutManifest = {
  holdout_id: string;
  holdout_hash: string;
  run_id: string;
  bench_version: string;
  schema_version: 1;
  started_at: string;
  completed_at: string;
  /** Reader-by-purpose intent. Holdout runs SHOULD be `control` (gemma4:26b). */
  mode: RunMode;
  reader: { provider: string; model: string; temperature: number };
  judge: { provider: string; model: string; prompt_template_hash: string };
  baseline: { provider: string; model: string } | null;
  june: {
    ingest_run_id: string;
    schema_version: number;
    embedding_model: string;
    embedding_model_version: string;
  };
  source: { name: string; url: string; doc_count: number };
  label_author: { provider: string; model: string };
};

/** Per-query holdout record — doc-level retrieval + reader verdict. */
export type HoldoutPerQuery = {
  query_id: string;
  query_text: string;
  unanswerable: boolean;
  /** june `doc_id`s of the labeled expected documents (empty for unanswerable). */
  expected_doc_ids: string[];
  expected_doc_filenames: string[];
  retrieved_chunk_ids: string[];
  /** `doc_id` of each retrieved chunk, in rank order (the doc-level projection). */
  retrieved_doc_ids: string[];
  /** Doc-level recall@k: a chunk from any expected doc in top-k. 0 for unanswerable. */
  recall_at_k: Record<"1" | "3" | "5" | "10", number>;
  /** Doc-level MRR: reciprocal rank of the earliest expected-doc chunk. */
  mrr: number;
  /** Top-1 retrieval score (diagnostic; the only retrieval signal for unanswerable queries). */
  top1_score: number | null;
  reader_answer: string;
  verdict: Verdict;
  rationale: string;
  baseline_answer: string | null;
  baseline_verdict: Verdict | null;
};

/**
 * On-disk shape of `holdout_results.json` — the sealed, separately-reported
 * holdout result. `kind: "holdout"` + `sealed: true` are the structural markers
 * that keep it out of the golden gate: it is NOT a `ResultsFile`, so
 * `control-pin`/`control-check` (which read `results.json`) never see it.
 */
export type HoldoutResultsFile = {
  kind: "holdout";
  /** Always true — a holdout can never become a golden / be tuned against. */
  sealed: true;
  holdout_id: string;
  holdout_hash: string;
  run_id: string;
  schema_version: 1;
  run_status: RunStatus;
  started_at: string;
  completed_at: string;
  manifest: HoldoutManifest;
  /**
   * Answerable-query aggregates. **Retrieval metrics lead** — recall@k/MRR over
   * the labeled expected docs are NOT contaminated by the reader's/judge's
   * parametric memory of real Next.js docs (the validity trap). `reader_*` are
   * secondary on this holdout.
   */
  answerable: {
    query_count: number;
    recall_at_1: MetricWithCi;
    recall_at_3: MetricWithCi;
    recall_at_5: MetricWithCi;
    recall_at_10: MetricWithCi;
    mrr: MetricWithCi;
    reader_correct_pct: MetricWithCi;
  };
  /** Unanswerable-query aggregates — refusal is correct; no recall. */
  unanswerable: {
    query_count: number;
    reader_refused_pct: MetricWithCi;
    top1_score_median: number | null;
  };
  /**
   * The HONEST reader signal under parametric contamination: RAG vs no-RAG
   * correct%. If the no-RAG baseline already answers real Next.js questions from
   * memory, `reader_rag_correct_pct ≈ reader_norag_correct_pct` and the reader
   * number says little about RETRIEVAL — which is why retrieval metrics lead.
   * `reader_norag_correct_pct` is null when the baseline pass didn't run.
   */
  reader_rag_correct_pct: MetricWithCi;
  reader_norag_correct_pct: MetricWithCi | null;
  per_query: HoldoutPerQuery[];
  integrity: {
    unjudged_pct: number;
    /** Labeled expected docs that didn't resolve to an ingested june doc_id (should be 0). */
    queries_with_unknown_doc: number;
  };
  cost_usd: {
    role_1: number;
    role_2: number;
    role_3: number;
    role_4: number;
    total: number;
  };
};
