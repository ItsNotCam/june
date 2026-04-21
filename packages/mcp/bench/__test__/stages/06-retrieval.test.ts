// author: Claude
import { describe, expect, test } from "bun:test";
import type { RetrievalResult } from "@/types/retrieval";
import { computeMrr, computeRecall } from "@/stages/06-retrieval";

const top = (ids: readonly string[]): RetrievalResult[] =>
  ids.map((chunk_id, i) => ({
    chunk_id,
    score: 1 / (i + 1),
    rank_source: "dense",
  }));

describe("computeRecall — tier dispatch", () => {
  test("T1 / T2: 'any' match counts", () => {
    expect(computeRecall("T1", ["c-x"], top(["c-x", "c-y"]), 3)).toBe(1);
    expect(computeRecall("T2", ["c-x"], top(["c-a", "c-b"]), 3)).toBe(0);
  });

  test("T3: ANY expected chunk in top-K", () => {
    expect(computeRecall("T3", ["c-a", "c-b"], top(["c-a", "c-z"]), 3)).toBe(1);
    expect(computeRecall("T3", ["c-a", "c-b"], top(["c-z"]), 3)).toBe(0);
  });

  test("T4: ALL expected chunks in top-K", () => {
    expect(computeRecall("T4", ["c-a", "c-b"], top(["c-a", "c-b", "c-c"]), 3)).toBe(1);
    // Second fact's chunk not in top-K → recall 0 even though one hit
    expect(computeRecall("T4", ["c-a", "c-b"], top(["c-a", "c-z"]), 3)).toBe(0);
  });

  test("T5: recall undefined — always returns 0", () => {
    expect(computeRecall("T5", [], top(["c-a"]), 3)).toBe(0);
  });

  test("respects K cutoff", () => {
    expect(computeRecall("T1", ["c-x"], top(["c-y", "c-z", "c-x"]), 1)).toBe(0);
    expect(computeRecall("T1", ["c-x"], top(["c-y", "c-z", "c-x"]), 3)).toBe(1);
  });
});

describe("computeMrr — tier dispatch", () => {
  test("T1: reciprocal of earliest expected rank", () => {
    expect(computeMrr("T1", ["c-a"], top(["c-z", "c-a"]))).toBeCloseTo(1 / 2, 6);
  });

  test("T3: earliest-rank of any expected", () => {
    expect(computeMrr("T3", ["c-a", "c-b"], top(["c-b", "c-a"]))).toBeCloseTo(1 / 1, 6);
  });

  test("T4: latest-rank — multi-hop bottleneck", () => {
    expect(
      computeMrr("T4", ["c-a", "c-b"], top(["c-a", "c-x", "c-b"])),
    ).toBeCloseTo(1 / 3, 6);
  });

  test("T4: missing expected chunk → 0", () => {
    expect(computeMrr("T4", ["c-a", "c-b"], top(["c-a", "c-x"]))).toBe(0);
  });

  test("T5 always 0", () => {
    expect(computeMrr("T5", [], top(["c-a"]))).toBe(0);
  });
});
