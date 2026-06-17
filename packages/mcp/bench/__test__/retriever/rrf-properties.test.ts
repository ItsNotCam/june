// author: Claude
import { describe, expect, test } from "bun:test";
import { reciprocalRankFusion } from "@/retriever/rrf";
import { seededRng, seedFromString } from "@/lib/rng";

/**
 * Property / metamorphic tests for RRF (§ RSI Phase 6, gap #9). These are
 * judge-independent — pure ranking logic — and assert the invariants the fusion
 * must hold for ANY input, plus the determinism the Phase-6 tie-break fix
 * guarantees: equal-score chunks resolve by an EXPLICIT (score desc, chunk_id
 * asc) total order, so the output never depends on Qdrant arrival order.
 */

const hit = (chunk_id: string) => ({ id: chunk_id, score: 1, payload: { chunk_id } });
const ids = (xs: ReadonlyArray<{ chunk_id: string }>) => xs.map((x) => x.chunk_id);
const hitIds = (xs: ReadonlyArray<{ payload: { chunk_id: string } }>) => xs.map((x) => x.payload.chunk_id);

/** Deterministic random hit lists drawn from a small id alphabet (forces ties). */
const randomLists = (rng: () => number, alphabet: string[]) => {
  const pick = (n: number) => {
    const pool = [...alphabet];
    const out: string[] = [];
    for (let i = 0; i < n && pool.length > 0; i++) {
      out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]!);
    }
    return out.map(hit);
  };
  return { dense: pick(1 + Math.floor(rng() * alphabet.length)), bm25: pick(1 + Math.floor(rng() * alphabet.length)) };
};

describe("RRF — invariants over random inputs", () => {
  const alphabet = ["a", "b", "c", "d", "e", "f"];

  test("output obeys the explicit total order (score desc, then chunk_id asc) — the tie-break fix", () => {
    const rng = seededRng(seedFromString("rrf-total-order"));
    for (let trial = 0; trial < 200; trial++) {
      const { dense, bm25 } = randomLists(rng, alphabet);
      const out = reciprocalRankFusion({ dense, bm25, dense_weight: 1, bm25_weight: 1, rank_constant: 60, k: 10 });
      for (let i = 0; i + 1 < out.length; i++) {
        const a = out[i]!;
        const b = out[i + 1]!;
        const ordered = a.score > b.score || (a.score === b.score && a.chunk_id < b.chunk_id);
        expect(ordered).toBe(true);
      }
    }
  });

  test("deterministic: identical inputs → identical output", () => {
    const rng = seededRng(seedFromString("rrf-determinism"));
    for (let trial = 0; trial < 100; trial++) {
      const { dense, bm25 } = randomLists(rng, alphabet);
      const a = reciprocalRankFusion({ dense, bm25, dense_weight: 0.6, bm25_weight: 0.4, rank_constant: 60, k: 5 });
      const b = reciprocalRankFusion({ dense, bm25, dense_weight: 0.6, bm25_weight: 0.4, rank_constant: 60, k: 5 });
      expect(a).toEqual(b);
    }
  });

  test("respects k and only ever returns chunks from the inputs", () => {
    const rng = seededRng(seedFromString("rrf-k-subset"));
    for (let trial = 0; trial < 100; trial++) {
      const { dense, bm25 } = randomLists(rng, alphabet);
      const k = 1 + Math.floor(rng() * 8);
      const out = reciprocalRankFusion({ dense, bm25, dense_weight: 1, bm25_weight: 1, rank_constant: 60, k });
      expect(out.length).toBeLessThanOrEqual(k);
      const inputIds = new Set([...hitIds(dense), ...hitIds(bm25)]);
      for (const r of out) expect(inputIds.has(r.chunk_id)).toBe(true);
      // No duplicate chunk in the output (a chunk in both modalities is fused once).
      expect(new Set(ids(out)).size).toBe(out.length);
    }
  });
});

describe("RRF — metamorphic", () => {
  test("modality-swap invariance: which modality surfaced a chunk does not change the tie order", () => {
    // dense=[a], bm25=[b] with equal weights → a and b tie at 1/61. Swapping which
    // list each came from must NOT change the output order (it did before the fix,
    // because ties resolved to dense-then-bm25 insertion order).
    const run1 = reciprocalRankFusion({ dense: [hit("a")], bm25: [hit("b")], dense_weight: 1, bm25_weight: 1, rank_constant: 60, k: 10 });
    const run2 = reciprocalRankFusion({ dense: [hit("b")], bm25: [hit("a")], dense_weight: 1, bm25_weight: 1, rank_constant: 60, k: 10 });
    expect(run1.map((r) => r.chunk_id)).toEqual(["a", "b"]);
    expect(run2.map((r) => r.chunk_id)).toEqual(["a", "b"]); // identical despite the swap
  });

  test("a chunk in both modalities outscores the same-rank single-modality chunks (formula)", () => {
    const out = reciprocalRankFusion({ dense: [hit("x"), hit("y")], bm25: [hit("x"), hit("z")], dense_weight: 1, bm25_weight: 1, rank_constant: 60, k: 10 });
    // x: 1/61 (dense r1) + 1/61 (bm25 r1) = 2/61; y: 1/62; z: 1/62.
    expect(out[0]!.chunk_id).toBe("x");
    expect(out[0]!.score).toBeCloseTo(2 / 61, 9);
    expect(out[0]!.rank_source).toBe("fused");
    // y and z tie at 1/62 → ordered by chunk_id (y before z).
    expect(out.slice(1).map((r) => r.chunk_id)).toEqual(["y", "z"]);
  });
});
