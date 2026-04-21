// author: Claude
import { beforeAll, describe, expect, test } from "bun:test";
import { computeBootstrapCi } from "@/lib/bootstrap";
import { loadTestConfig } from "../helpers";

describe("computeBootstrapCi", () => {
  beforeAll(async () => {
    await loadTestConfig();
  });

  test("returns zero metric on empty input", () => {
    const m = computeBootstrapCi([], "seed");
    expect(m.point).toBe(0);
    expect(m.ci_low).toBe(0);
    expect(m.ci_high).toBe(0);
    expect(m.query_ids).toEqual([]);
  });

  test("point estimate matches mean of inputs", () => {
    const values = Array.from({ length: 50 }, (_, i) => ({
      query_id: `q-${i}`,
      value: i % 2,
    }));
    const m = computeBootstrapCi(values, "seed");
    // 25 ones in 50 → 0.5
    expect(m.point).toBeCloseTo(0.5, 6);
  });

  test("CI brackets the point for a realistic proportion", () => {
    const values = Array.from({ length: 200 }, (_, i) => ({
      query_id: `q-${i}`,
      value: i < 160 ? 1 : 0, // p = 0.8
    }));
    const m = computeBootstrapCi(values, "seed");
    expect(m.point).toBeCloseTo(0.8, 6);
    expect(m.ci_low).toBeLessThan(m.point);
    expect(m.ci_high).toBeGreaterThan(m.point);
    // Reasonable bounds around 0.8 for n=200
    expect(m.ci_low).toBeGreaterThan(0.65);
    expect(m.ci_high).toBeLessThan(0.95);
  });

  test("deterministic given the same seed key", () => {
    const values = Array.from({ length: 30 }, (_, i) => ({
      query_id: `q-${i}`,
      value: i % 3 === 0 ? 1 : 0,
    }));
    const a = computeBootstrapCi(values, "seed-A");
    const b = computeBootstrapCi(values, "seed-A");
    expect(a).toEqual(b);
  });

  test("different seed keys produce different CIs", () => {
    const values = Array.from({ length: 30 }, (_, i) => ({
      query_id: `q-${i}`,
      value: i % 3 === 0 ? 1 : 0,
    }));
    const a = computeBootstrapCi(values, "seed-A");
    const b = computeBootstrapCi(values, "seed-B");
    expect(a.ci_low === b.ci_low && a.ci_high === b.ci_high).toBe(false);
  });
});
