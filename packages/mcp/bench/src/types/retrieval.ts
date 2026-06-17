// author: Claude
/**
 * Tag indicating which modality surfaced a chunk during retrieval (§20).
 *
 * - `dense` — only the embedding search ranked it.
 * - `bm25` — only the sparse keyword search ranked it.
 * - `fused` — both modalities ranked it (the strongest diagnostic).
 * - `null` — the adapter doesn't expose a per-modality split (a future
 *   june-API adapter may not).
 */
export type RankSource = "dense" | "bm25" | "fused" | null;

/** One chunk returned by `Retriever.retrieve()`. */
export type RetrievalResult = {
  chunk_id: string;
  score: number;
  rank_source: RankSource;
};

/** Per-query record in `retrieval_results.json` (§20). */
export type RetrievalResultsRecord = {
  query_id: string;
  retrieved: RetrievalResult[];
  recall_at_k: Record<"1" | "3" | "5" | "10", number>;
  mrr: number;
  t5_top1_score: number | null;
  /**
   * Per-fact hop recall — the FRACTION of a query's expected chunks present in
   * top-k, vs `recall_at_k`'s all-or-nothing binary (§ RSI Phase 6). For a
   * multi-hop tier (T4/T6/T7) this distinguishes "retrieved 1 of 2 hops" (0.5)
   * from "retrieved neither" (0.0) when the binary recall is 0 either way — the
   * diagnostic for WHERE a compositional retrieval failed. Diagnostic only; the
   * gated metric stays `recall_at_k`. Optional (older records omit it).
   */
  per_fact_recall_at_k?: Record<"1" | "3" | "5" | "10", number>;
};

/** On-disk shape of `retrieval_results.json`. */
export type RetrievalResultsFile = {
  fixture_id: string;
  ingest_run_id: string;
  retriever_config: {
    adapter: string;
    retrieval_config_snapshot: Record<string, unknown>;
  };
  results: RetrievalResultsRecord[];
};
