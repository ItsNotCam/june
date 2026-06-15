import type { VectorSearchHit } from "#internal/lib/storage/types";
import type { RankSource } from "#internal/types/retrieval";

/**
 * Reciprocal rank fusion over dense + sparse hit lists.
 *
 * `score = sum_over_modalities(weight / (rank_constant + rank))`, rank
 * 1-indexed. A chunk both modalities rank gets both contributions and is
 * tagged `fused` — the strongest agreement signal. Ported from the bench's
 * `retriever/rrf.ts`; kept payload-free (operates on `chunk_id` only) so the
 * caller re-joins payload after fusion.
 */

export type FusedHit = {
  chunk_id: string;
  score: number;
  rank_source: RankSource;
};

export const reciprocalRankFusion = (args: {
  dense: ReadonlyArray<VectorSearchHit>;
  bm25: ReadonlyArray<VectorSearchHit>;
  dense_weight: number;
  bm25_weight: number;
  rank_constant: number;
  k: number;
}): FusedHit[] => {
  const { dense, bm25, dense_weight, bm25_weight, rank_constant, k } = args;

  const fused = new Map<
    string,
    { score: number; dense_rank: number | null; bm25_rank: number | null }
  >();

  dense.forEach((hit, i) => {
    const chunkId = chunkIdOf(hit);
    if (!chunkId) return;
    fused.set(chunkId, {
      score: dense_weight / (rank_constant + (i + 1)),
      dense_rank: i + 1,
      bm25_rank: null,
    });
  });

  bm25.forEach((hit, i) => {
    const chunkId = chunkIdOf(hit);
    if (!chunkId) return;
    const bm25Score = bm25_weight / (rank_constant + (i + 1));
    const existing = fused.get(chunkId);
    if (existing) {
      existing.score += bm25Score;
      existing.bm25_rank = i + 1;
    } else {
      fused.set(chunkId, { score: bm25Score, dense_rank: null, bm25_rank: i + 1 });
    }
  });

  return [...fused.entries()]
    .map(([chunk_id, entry]) => ({ chunk_id, ...entry }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((row) => ({
      chunk_id: row.chunk_id,
      score: row.score,
      rank_source:
        row.dense_rank !== null && row.bm25_rank !== null
          ? "fused"
          : row.dense_rank !== null
            ? "dense"
            : "bm25",
    }));
};

/** june writes `chunk_id` into every chunk's payload (Stage 10), so it surfaces with `with_payload: true`. */
const chunkIdOf = (hit: VectorSearchHit): string | null => {
  const raw = hit.payload["chunk_id"];
  return typeof raw === "string" ? raw : null;
};
