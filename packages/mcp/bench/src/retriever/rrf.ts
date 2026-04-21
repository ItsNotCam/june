// author: Claude
import type { QdrantQueryHit } from "./qdrant";
import type { RankSource, RetrievalResult } from "@/types/retrieval";

/**
 * Reciprocal rank fusion (§20, Appendix E).
 *
 * `score = sum_over_sources(weight / (rank_constant + rank))`, rank 1-indexed.
 * `rank_constant` comes from `config.retrieval.retriever_config.rank_constant`
 * (default 60 — the RRF-literature convention). Changing it lands in
 * `results.json.retrieval_config_snapshot` so `compare` flags cross-run
 * incompatibilities.
 *
 * **`rank_source` tagging** is the diagnostic signal: a chunk that shows up
 * only in BM25 tells a different story than one both modalities agree on.
 * The bench records the tag on every returned hit for per-run analysis.
 */
export const reciprocalRankFusion = (args: {
  dense: QdrantQueryHit[];
  bm25: QdrantQueryHit[];
  dense_weight: number;
  bm25_weight: number;
  rank_constant: number;
  k: number;
}): RetrievalResult[] => {
  const { dense, bm25, dense_weight, bm25_weight, rank_constant, k } = args;

  const fused = new Map<
    string,
    { score: number; dense_rank: number | null; bm25_rank: number | null }
  >();

  dense.forEach((hit, i) => {
    const chunkId = chunkIdOf(hit);
    if (!chunkId) return;
    const score = dense_weight / (rank_constant + (i + 1));
    fused.set(chunkId, {
      score,
      dense_rank: i + 1,
      bm25_rank: null,
    });
  });

  bm25.forEach((hit, i) => {
    const chunkId = chunkIdOf(hit);
    if (!chunkId) return;
    const existing = fused.get(chunkId);
    const bm25Score = bm25_weight / (rank_constant + (i + 1));
    if (existing) {
      existing.score += bm25Score;
      existing.bm25_rank = i + 1;
    } else {
      fused.set(chunkId, {
        score: bm25Score,
        dense_rank: null,
        bm25_rank: i + 1,
      });
    }
  });

  const ordered = [...fused.entries()]
    .map(([chunk_id, entry]) => ({ chunk_id, ...entry }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  return ordered.map((row) => {
    const rank_source: RankSource =
      row.dense_rank !== null && row.bm25_rank !== null
        ? "fused"
        : row.dense_rank !== null
          ? "dense"
          : "bm25";
    return { chunk_id: row.chunk_id, score: row.score, rank_source };
  });
};

/**
 * Extracts the canonical `chunk_id` from a Qdrant hit.
 *
 * june writes `chunk_id` into the payload so `with_payload: ["chunk_id"]`
 * surfaces it. If a provider change ever stores the id at the point level
 * instead, extend this helper — the rest of the bench reads through it.
 */
const chunkIdOf = (hit: QdrantQueryHit): string | null => {
  const raw = hit.payload["chunk_id"];
  if (typeof raw === "string") return raw;
  return null;
};
