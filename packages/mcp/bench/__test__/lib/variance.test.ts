// author: Claude
import { describe, expect, test } from "bun:test";
import { computeVariance, maxRange } from "@/lib/variance";

/**
 * The variance math behind the MEASURED noise floor (Phase 2). `range`
 * (max − min) is the load-bearing output — the conservative floor a real change
 * must clear. These pin the edge cases (empty, single, identical, sample n−1).
 */
describe("computeVariance", () => {
  test("empty input → all-zero stats, n=0 (no throw)", () => {
    expect(computeVariance([])).toEqual({ n: 0, mean: 0, stddev: 0, min: 0, max: 0, range: 0 });
  });

  test("single observation → zero spread, stddev 0 (no n−1 div-by-zero)", () => {
    expect(computeVariance([0.42])).toEqual({
      n: 1,
      mean: 0.42,
      stddev: 0,
      min: 0.42,
      max: 0.42,
      range: 0,
    });
  });

  test("identical observations → range 0 (the deterministic case)", () => {
    const s = computeVariance([0.7, 0.7, 0.7, 0.7]);
    expect(s.range).toBe(0);
    expect(s.stddev).toBe(0);
    expect(s.mean).toBe(0.7);
  });

  test("range is max − min regardless of order", () => {
    const a = computeVariance([0.9, 0.5, 0.8, 0.6]);
    const b = computeVariance([0.5, 0.6, 0.8, 0.9]);
    expect(a.range).toBeCloseTo(0.4, 12);
    expect(a.min).toBe(0.5);
    expect(a.max).toBe(0.9);
    expect(a.range).toBe(b.range);
  });

  test("mean and sample (n−1) stddev are correct", () => {
    // values {2,4,6}: mean 4, sample variance = ((−2)²+0²+2²)/(3−1)=8/2=4 → stddev 2.
    const s = computeVariance([2, 4, 6]);
    expect(s.mean).toBe(4);
    expect(s.stddev).toBeCloseTo(2, 12);
  });
});

describe("maxRange", () => {
  test("returns the largest range across many stats; 0 for empty", () => {
    expect(maxRange([])).toBe(0);
    const stats = [
      computeVariance([0.5, 0.5]), // range 0
      computeVariance([0.1, 0.4]), // range 0.3
      computeVariance([0.7, 0.72]), // range 0.02
    ];
    expect(maxRange(stats)).toBeCloseTo(0.3, 12);
  });
});
