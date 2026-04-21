// author: Claude
import { describe, expect, test } from "bun:test";
import { reciprocalRankFusion } from "@/retriever/rrf";

/** Builds a fake Qdrant hit in the minimum shape `rrf` expects. */
const hit = (chunk_id: string, score = 1) => ({
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

  test("ranks fused chunks higher than single-source chunks at same rank", () => {
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
});
