// author: Claude
import { describe, expect, test } from "bun:test";
import { cohensKappa, observedAgreement, confusionMatrix, type LabelPair } from "@/lib/kappa";

/**
 * Cohen's κ (Phase 5). κ subtracts chance agreement, so a judge that always
 * guesses the majority class scores ~0, not high — the property that makes it a
 * trustworthy calibration gate.
 */

const pairs = (a: string[], b: string[]): LabelPair[] => a.map((x, i) => ({ a: x, b: b[i]! }));

describe("cohensKappa", () => {
  test("perfect agreement over 2 categories → 1", () => {
    expect(cohensKappa(pairs(["A", "A", "B", "B"], ["A", "A", "B", "B"]))).toBe(1);
  });

  test("chance-level agreement → 0", () => {
    // p_o = 0.5, marginals 50/50 each → p_e = 0.5 → κ = 0.
    expect(cohensKappa(pairs(["A", "A", "B", "B"], ["A", "B", "A", "B"]))).toBeCloseTo(0, 10);
  });

  test("perfectly anti-correlated → −1", () => {
    expect(cohensKappa(pairs(["A", "A", "B", "B"], ["B", "B", "A", "A"]))).toBeCloseTo(-1, 10);
  });

  test("known mixed value", () => {
    // 6 A/A, 2 B/B, 1 A/B, 1 B/A over 10 → p_o 0.8, p_e 0.58 → κ ≈ 0.5238.
    const a = ["A", "A", "A", "A", "A", "A", "B", "B", "A", "B"];
    const b = ["A", "A", "A", "A", "A", "A", "B", "B", "B", "A"];
    expect(cohensKappa(pairs(a, b))).toBeCloseTo(0.5238, 3);
  });

  test("majority-class guessing scores near zero, not high raw agreement", () => {
    // Human mostly CORRECT; agent ALWAYS says CORRECT → raw agreement high, κ = 0.
    const human = ["CORRECT", "CORRECT", "CORRECT", "CORRECT", "INCORRECT", "REFUSED"];
    const agent = ["CORRECT", "CORRECT", "CORRECT", "CORRECT", "CORRECT", "CORRECT"];
    expect(observedAgreement(pairs(human, agent))).toBeCloseTo(4 / 6, 5);
    expect(cohensKappa(pairs(human, agent))).toBeCloseTo(0, 10);
  });

  test("single-category perfect agreement → 1 (degenerate denominator)", () => {
    expect(cohensKappa(pairs(["A", "A"], ["A", "A"]))).toBe(1);
  });

  test("empty → 0", () => {
    expect(cohensKappa([])).toBe(0);
  });
});

describe("confusionMatrix", () => {
  test("counts cells, sorted by descending count", () => {
    const cells = confusionMatrix(pairs(["A", "A", "B"], ["A", "B", "B"]));
    expect(cells[0]).toEqual({ a: "A", b: "A", count: 1 });
    expect(cells).toHaveLength(3);
    const offDiag = cells.filter((c) => c.a !== c.b);
    expect(offDiag).toEqual([{ a: "A", b: "B", count: 1 }]);
  });
});
