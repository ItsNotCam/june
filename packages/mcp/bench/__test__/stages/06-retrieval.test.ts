// author: Claude
import { describe, expect, test } from "bun:test";
import type { RetrievalResult } from "@/types/retrieval";
import { computeMrr, computeRecall, perFactRecall } from "@/stages/06-retrieval";

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

  test("T6 / T7: ALL expected chunks in top-K (multi-hop, like T4)", () => {
    expect(computeRecall("T6", ["c-a", "c-b", "c-c"], top(["c-a", "c-b", "c-c"]), 5)).toBe(1);
    expect(computeRecall("T6", ["c-a", "c-b", "c-c"], top(["c-a", "c-b", "c-z"]), 5)).toBe(0);
    expect(computeRecall("T7", ["c-a", "c-b", "c-c", "c-d"], top(["c-a", "c-b", "c-c", "c-d"]), 5)).toBe(1);
    expect(computeRecall("T7", ["c-a", "c-b", "c-c", "c-d"], top(["c-a", "c-b", "c-c"]), 5)).toBe(0);
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

  test("T6 / T7: latest-rank bottleneck over all N chunks", () => {
    expect(
      computeMrr("T6", ["c-a", "c-b", "c-c"], top(["c-a", "c-b", "c-x", "c-c"])),
    ).toBeCloseTo(1 / 4, 6);
    expect(computeMrr("T7", ["c-a", "c-b", "c-c", "c-d"], top(["c-a", "c-b", "c-c"]))).toBe(0);
  });

  test("T5 always 0", () => {
    expect(computeMrr("T5", [], top(["c-a"]))).toBe(0);
  });
});

describe("perFactRecall — partial-hop diagnostic", () => {
  test("multi-hop: distinguishes 1-of-2 hops (0.5) from 0-of-2 (0) where binary recall is 0 for both", () => {
    // 1 of 2 hops retrieved — gated computeRecall is 0, but the diagnostic shows 0.5.
    expect(computeRecall("T4", ["c-a", "c-b"], top(["c-a", "c-z"]), 3)).toBe(0);
    expect(perFactRecall("T4", ["c-a", "c-b"], top(["c-a", "c-z"]), 3)).toBeCloseTo(0.5, 6);
    // neither hop → 0
    expect(perFactRecall("T4", ["c-a", "c-b"], top(["c-y", "c-z"]), 3)).toBe(0);
  });

  test("multi-hop: all hops present → 1.0 (agrees with binary recall)", () => {
    expect(perFactRecall("T6", ["c-a", "c-b", "c-c"], top(["c-a", "c-b", "c-c"]), 5)).toBe(1);
    expect(perFactRecall("T7", ["c-a", "c-b", "c-c", "c-d"], top(["c-a", "c-b", "c-c"]), 5)).toBeCloseTo(3 / 4, 6);
  });

  test("single-fact tier equals the binary recall; respects k; T5 → 0", () => {
    expect(perFactRecall("T1", ["c-x"], top(["c-x", "c-y"]), 3)).toBe(1);
    expect(perFactRecall("T1", ["c-x"], top(["c-y", "c-z", "c-x"]), 1)).toBe(0);
    expect(perFactRecall("T5", [], top(["c-a"]), 3)).toBe(0);
  });
});
