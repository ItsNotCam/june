// author: Claude
import type { Retriever, RetrievalResult, Scorer } from "./types";
import { logger } from "@/lib/logger";

/**
 * Second-pass reranking wrapper around any inner `Retriever`.
 *
 * Retrieval surfaces the right chunk but ranks it #1 too rarely (recall@1 ≪
 * recall@10): "recall present, ranking weak" — the textbook cross-encoder case.
 * This decorator fetches a deep candidate pool from the inner retriever, rescores
 * every candidate against the query with a `Scorer`, and returns the top-k by the
 * new score. Because it only ever *reorders* the inner pool and truncates, it
 * cannot surface a chunk the inner retriever didn't already find — the win is
 * purely in ranking (recall@1 / MRR).
 *
 * Mirrors `createMultiHopRetriever`: a decorator over `inner.retrieve` that
 * merges its own knobs into `config_snapshot`.
 *
 * @param inner - the retriever whose ranking is being refined.
 * @param scorer - the relevance backend (provider-agnostic; see `Scorer`).
 * @param poolK - candidate-pool depth fetched from `inner`. MUST be ≥ the `k`
 *   the decorator is called with (guaranteed by the config refine that requires
 *   `pool_k >= max(k_values)`), so the pool is always deeper than the cutoff.
 * @param fetchChunkContent - resolves a chunk's raw text by id (SQLite-backed at
 *   the call site). Returns `null` for unknown ids.
 */
export const createRerankingRetriever = (args: {
  inner: Retriever;
  scorer: Scorer;
  poolK: number;
  fetchChunkContent: (chunkId: string) => string | null;
}): Retriever => {
  const { inner, scorer, poolK, fetchChunkContent } = args;

  const retrieve = async (queryText: string, k: number): Promise<RetrievalResult[]> => {
    const pool = await inner.retrieve(queryText, poolK);
    if (pool.length <= 1) return pool.slice(0, k);

    // Partition: only chunks whose text we can fetch are rerankable. A chunk
    // with no text (unknown id) can't be scored — it must never steal a top-k
    // slot from a scored candidate, so it sinks to the tail in original order.
    const scorable: { result: RetrievalResult; poolIndex: number; text: string }[] = [];
    const unscored: RetrievalResult[] = [];
    pool.forEach((result, poolIndex) => {
      const text = fetchChunkContent(result.chunk_id);
      if (text === null) {
        unscored.push(result);
      } else {
        scorable.push({ result, poolIndex, text });
      }
    });

    if (unscored.length > 0) {
      logger.warn("reranker.missing_chunk_text", {
        missing: unscored.length,
        candidates: pool.length,
      });
    }

    const scores = await scorer.score(queryText, scorable.map((c) => c.text));

    // Sort by an explicit total order — (score desc, original pool index asc) —
    // so ties resolve deterministically to the inner (RRF) ranking rather than
    // relying on the engine's sort stability.
    const ranked = scorable
      .map((c, i) => ({ ...c, score: scores[i] ?? 0 }))
      .sort((a, b) => b.score - a.score || a.poolIndex - b.poolIndex)
      // Overwrite `score` with the reranker score; keep `rank_source` as a
      // fusion-provenance tag (no longer the ranker). Metrics read only chunk_id
      // + order, so this is metric-safe.
      .map((c): RetrievalResult => ({ ...c.result, score: c.score }));

    return [...ranked, ...unscored].slice(0, k);
  };

  return {
    name: `rerank(${inner.name})`,
    config_snapshot: {
      ...inner.config_snapshot,
      rerank: { scorer: scorer.name, pool_k: poolK },
    },
    retrieve,
  };
};
