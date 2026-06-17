// author: Claude
import type { RetrievalResult } from "@/types/retrieval";

/**
 * The `Retriever` interface (§35).
 *
 * One method — `retrieve(queryText, k)`. Small, stable, deliberately unaware
 * of how scores are fused. The stopgap adapter (Appendix E) hits Qdrant and
 * SQLite directly; a future `june-api` adapter will call june's public
 * retrieval surface when one exists.
 *
 * `config_snapshot` captures whatever knobs the adapter exposes so
 * `results.json.retrieval_config_snapshot` can record them — `compare`
 * refuses to diff runs with different snapshots (I-EVAL-3).
 */
export type Retriever = {
  name: string;
  config_snapshot: Record<string, unknown>;
  retrieve: (queryText: string, k: number) => Promise<RetrievalResult[]>;
};

/**
 * A relevance scorer for second-pass reranking — the provider-agnostic seam.
 *
 * `score` takes the query and a list of candidate chunk texts and returns one
 * relevance score per candidate, **aligned to input order** (higher = more
 * relevant). The reranking decorator (`createRerankingRetriever`) is the only
 * caller; it depends on this interface, never on a concrete backend, so a local
 * cross-encoder, a hosted rerank API, or an LLM-listwise scorer all drop in here
 * unchanged.
 *
 * Implementations MUST be deterministic — the reranker A/B holds no noise floor
 * otherwise (the bench's recall@1/MRR comparison assumes a fixed mapping from
 * candidate set to ranking). A local cross-encoder at inference is deterministic
 * by construction; an LLM scorer would need temperature 0 + caching to qualify.
 */
export type Scorer = {
  name: string;
  score: (query: string, candidates: string[]) => Promise<number[]>;
};

export type { RetrievalResult };
