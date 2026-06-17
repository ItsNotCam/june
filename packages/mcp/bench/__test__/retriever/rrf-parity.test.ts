// author: Claude
import { describe, expect, test } from "bun:test";
import { reciprocalRankFusion as benchRrf } from "@/retriever/rrf";
import { reciprocalRankFusion as ingestRrf } from "../../../ingest/src/retriever/rrf";
import { seededRng, seedFromString } from "@/lib/rng";

/**
 * Stopgap↔production RRF parity (§ RSI Phase 6, gap #10). The bench houses a copy
 * of the fusion logic (`src/retriever/rrf.ts`) and june ships the production one
 * (`ingest/src/retriever/rrf.ts`) — the bench is only an honest gauge if the two
 * rank IDENTICALLY. This executes BOTH on the same inputs and asserts byte-equal
 * output, so any drift between them (including the Phase-6 tie-break fix landing
 * in one file but not the other) fails the suite. Both read only `payload.chunk_id`,
 * so a shared fake hit feeds both.
 */

const hit = (chunk_id: string) => ({ id: chunk_id, score: 1, payload: { chunk_id } });

const randomLists = (rng: () => number, alphabet: string[]) => {
  const pick = (n: number) => {
    const pool = [...alphabet];
    const out: string[] = [];
    for (let i = 0; i < n && pool.length > 0; i++) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]!);
    return out.map(hit);
  };
  return { dense: pick(1 + Math.floor(rng() * alphabet.length)), bm25: pick(1 + Math.floor(rng() * alphabet.length)) };
};

describe("RRF parity — bench mirrors production", () => {
  test("identical fused ranking + scores + rank_source over random inputs", () => {
    const rng = seededRng(seedFromString("rrf-parity"));
    const alphabet = ["a", "b", "c", "d", "e", "f", "g"];
    for (let trial = 0; trial < 200; trial++) {
      const { dense, bm25 } = randomLists(rng, alphabet);
      const args = {
        dense,
        bm25,
        dense_weight: 0.6,
        bm25_weight: 0.4,
        rank_constant: 60,
        k: 1 + Math.floor(rng() * 7),
      } as const;
      // The two signatures differ only in the (type-only) hit type; both read
      // `payload.chunk_id`. Cast the shared fake to satisfy each.
      const a = benchRrf(args as unknown as Parameters<typeof benchRrf>[0]);
      const b = ingestRrf(args as unknown as Parameters<typeof ingestRrf>[0]);
      expect(a).toEqual(b);
    }
  });

  test("both resolve the equal-score tie-break by chunk_id (the Phase-6 fix is in BOTH)", () => {
    const args = { dense: [hit("b")], bm25: [hit("a")], dense_weight: 1, bm25_weight: 1, rank_constant: 60, k: 10 } as const;
    const a = benchRrf(args as unknown as Parameters<typeof benchRrf>[0]);
    const b = ingestRrf(args as unknown as Parameters<typeof ingestRrf>[0]);
    expect(a.map((r) => r.chunk_id)).toEqual(["a", "b"]);
    expect(b.map((r) => r.chunk_id)).toEqual(["a", "b"]);
  });
});
