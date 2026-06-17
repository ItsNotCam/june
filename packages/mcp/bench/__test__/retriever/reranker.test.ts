// author: Claude
import { describe, expect, test } from "bun:test";
import { createRerankingRetriever } from "@/retriever/reranker";
import type { Retriever, Scorer, RetrievalResult } from "@/retriever/types";

/** A stub inner retriever that returns a fixed pool in a fixed order. */
const innerWith = (ids: string[]): Retriever => ({
  name: "stub",
  config_snapshot: { adapter: "stub" },
  retrieve: async (_q, k): Promise<RetrievalResult[]> =>
    ids.slice(0, k).map((chunk_id, i) => ({
      chunk_id,
      score: 1 - i * 0.1, // descending inner (RRF) score
      rank_source: "fused" as const,
    })),
});

/**
 * A deterministic scorer driven by a fixed score table. Candidate "text" IS the
 * chunk id here (see `fetcherFrom`), so the table is keyed by id.
 */
const scorerFrom = (table: Record<string, number>): Scorer => ({
  name: "fake",
  score: async (_q, candidates) => candidates.map((c) => table[c] ?? 0),
});

/** Fetcher that returns each known id AS its text; unknown ids return null. */
const fetcherFrom = (known: string[]) => (id: string) =>
  known.includes(id) ? id : null;

describe("createRerankingRetriever", () => {
  test("reorders the inner pool by reranker score, descending", async () => {
    const inner = innerWith(["a", "b", "c"]);
    // Inner order a,b,c; reranker prefers c > a > b.
    const r = createRerankingRetriever({
      inner,
      scorer: scorerFrom({ a: 0.5, b: 0.1, c: 0.9 }),
      poolK: 10,
      fetchChunkContent: fetcherFrom(["a", "b", "c"]),
    });
    const out = await r.retrieve("q", 3);
    expect(out.map((x) => x.chunk_id)).toEqual(["c", "a", "b"]);
    // score is overwritten with the reranker score; rank_source preserved.
    expect(out[0]!.score).toBe(0.9);
    expect(out[0]!.rank_source).toBe("fused");
  });

  test("truncates to k after reranking", async () => {
    const inner = innerWith(["a", "b", "c", "d"]);
    const r = createRerankingRetriever({
      inner,
      scorer: scorerFrom({ a: 0.1, b: 0.2, c: 0.3, d: 0.4 }),
      poolK: 10,
      fetchChunkContent: fetcherFrom(["a", "b", "c", "d"]),
    });
    const out = await r.retrieve("q", 2);
    expect(out.map((x) => x.chunk_id)).toEqual(["d", "c"]);
  });

  test("ties resolve to inner pool order (stable, explicit)", async () => {
    const inner = innerWith(["a", "b", "c"]);
    // All tied — must keep inner order a,b,c.
    const r = createRerankingRetriever({
      inner,
      scorer: scorerFrom({ a: 0.5, b: 0.5, c: 0.5 }),
      poolK: 10,
      fetchChunkContent: fetcherFrom(["a", "b", "c"]),
    });
    const out = await r.retrieve("q", 3);
    expect(out.map((x) => x.chunk_id)).toEqual(["a", "b", "c"]);
  });

  test("chunks with no fetchable text sink to the tail in original order", async () => {
    const inner = innerWith(["a", "b", "c"]);
    // 'b' has no text → can't be scored. 'a' and 'c' score low/high.
    const r = createRerankingRetriever({
      inner,
      scorer: scorerFrom({ a: 0.1, c: 0.9 }),
      poolK: 10,
      fetchChunkContent: fetcherFrom(["a", "c"]), // no 'b'
    });
    const out = await r.retrieve("q", 3);
    // scored: c(0.9) > a(0.1); unscored b appended last.
    expect(out.map((x) => x.chunk_id)).toEqual(["c", "a", "b"]);
  });

  test("config_snapshot merges inner snapshot with rerank knobs", async () => {
    const inner = innerWith(["a"]);
    const r = createRerankingRetriever({
      inner,
      scorer: scorerFrom({ a: 1 }),
      poolK: 40,
      fetchChunkContent: fetcherFrom(["a"]),
    });
    expect(r.config_snapshot).toEqual({
      adapter: "stub",
      rerank: { scorer: "fake", pool_k: 40 },
    });
    expect(r.name).toBe("rerank(stub)");
  });

  test("fetches the deep pool (poolK), not k, from the inner retriever", async () => {
    const seen: number[] = [];
    const inner: Retriever = {
      name: "spy",
      config_snapshot: {},
      retrieve: async (_q, k) => {
        seen.push(k);
        return Array.from({ length: k }, (_v, i) => ({
          chunk_id: `c${i}`,
          score: 1 - i,
          rank_source: "fused" as const,
        }));
      },
    };
    const r = createRerankingRetriever({
      inner,
      scorer: { name: "n", score: async (_q, cs) => cs.map(() => 0) },
      poolK: 40,
      fetchChunkContent: (id) => id,
    });
    await r.retrieve("q", 10);
    expect(seen).toEqual([40]); // inner asked for poolK, not k
  });
});
