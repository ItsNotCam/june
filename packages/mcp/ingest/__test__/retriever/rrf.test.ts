// author: Claude
import { describe, expect, test } from "bun:test";
import { reciprocalRankFusion } from "@/retriever/rrf";
import type { VectorSearchHit } from "@/lib/storage/types";

/** Builds a fake search hit in the minimum shape `rrf` reads (`payload.chunk_id`). */
const hit = (chunk_id: string, score = 1): VectorSearchHit => ({
  id: chunk_id,
  score,
  payload: { chunk_id },
});

describe("reciprocalRankFusion", () => {
  test("tags dense-only hits as 'dense' and bm25-only as 'bm25'", () => {
    const fused = reciprocalRankFusion({
      dense: [hit("a"), hit("b")],
      bm25: [hit("c")],
      dense_weight: 1,
      bm25_weight: 1,
      rank_constant: 60,
      k: 10,
    });
    const byId = new Map(fused.map((f) => [f.chunk_id, f.rank_source]));
    expect(byId.get("a")).toBe("dense");
    expect(byId.get("b")).toBe("dense");
    expect(byId.get("c")).toBe("bm25");
  });

  test("tags chunks appearing in both lists as 'fused'", () => {
    const fused = reciprocalRankFusion({
      dense: [hit("a"), hit("b")],
      bm25: [hit("a")],
      dense_weight: 1,
      bm25_weight: 1,
      rank_constant: 60,
      k: 10,
    });
    const byId = new Map(fused.map((f) => [f.chunk_id, f.rank_source]));
    expect(byId.get("a")).toBe("fused");
  });

  test("ranks a chunk both modalities agree on above single-source chunks", () => {
    const fused = reciprocalRankFusion({
      dense: [hit("a"), hit("b")],
      bm25: [hit("a"), hit("c")],
      dense_weight: 1,
      bm25_weight: 1,
      rank_constant: 60,
      k: 10,
    });
    expect(fused[0]!.chunk_id).toBe("a");
  });

  test("respects k", () => {
    const dense = Array.from({ length: 10 }, (_, i) => hit(`c-${i}`));
    const fused = reciprocalRankFusion({
      dense,
      bm25: [],
      dense_weight: 1,
      bm25_weight: 1,
      rank_constant: 60,
      k: 3,
    });
    expect(fused).toHaveLength(3);
  });

  test("ignores hits with no chunk_id in payload", () => {
    const fused = reciprocalRankFusion({
      dense: [{ id: 1, score: 1, payload: {} }],
      bm25: [hit("b")],
      dense_weight: 1,
      bm25_weight: 1,
      rank_constant: 60,
      k: 10,
    });
    expect(fused.map((f) => f.chunk_id)).toEqual(["b"]);
  });
});
