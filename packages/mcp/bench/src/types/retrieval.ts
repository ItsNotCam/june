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
