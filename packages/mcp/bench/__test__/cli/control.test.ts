// author: Claude
import { describe, expect, test } from "bun:test";
import type { MetricWithCi, ResultsFile, TierAggregates } from "@/types/results";
import {
  detectRegressions,
  judgeMismatch,
  perTierMetrics,
  type GoldenEntry,
  type GoldenTier,
} from "../../cli/control";

/**
 * The statistical gate (Phase 1). A metric regresses ONLY when its point drops
 * past the noise floor AND its CI is entirely below the golden's — so run-to-run
 * noise can never trip the gate, and retrieval metrics (recall@k, MRR) are gated
 * alongside correct%. Plus the cross-judge guard. These are the first tests of
 * control-pin/control-check logic; the file had none.
 */

const gm = (point: number, ci_low: number, ci_high: number) => ({ point, ci_low, ci_high });

const gtier = (
  correct: ReturnType<typeof gm>,
  recall1: ReturnType<typeof gm>,
  recall5: ReturnType<typeof gm>,
  mrr: ReturnType<typeof gm>,
): GoldenTier => ({
  query_count: 10,
  reader_correct_pct: correct,
  recall_at_1: recall1,
  recall_at_5: recall5,
  mrr,
});

const golden = (per_tier: Record<string, GoldenTier>, noise_floor = 0.05): GoldenEntry => ({
  schema_version: 2,
  run_id: "g1",
  fixture_hash: "h",
  noise_floor,
  judge: { provider: "external", model: "claude-sonnet-4-6", prompt_template_hash: "abc123" },
  per_tier,
});

const stable = gm(0.5, 0.45, 0.55); // a metric we hold constant across golden/candidate

describe("detectRegressions — CI-aware gate", () => {
  test("no regression when candidate matches golden (CIs overlap)", () => {
    const t = gtier(gm(0.8, 0.75, 0.85), gm(0.7, 0.65, 0.75), gm(0.9, 0.85, 0.95), gm(0.6, 0.55, 0.65));
    const { regressions } = detectRegressions(golden({ T1: t }), { T1: t });
    expect(regressions).toHaveLength(0);
  });

  test("flags correct% drop that is both past floor AND CI-non-overlapping", () => {
    const g = gtier(gm(0.8, 0.75, 0.85), stable, stable, stable);
    const c = gtier(gm(0.6, 0.55, 0.65), stable, stable, stable);
    const { regressions } = detectRegressions(golden({ T1: g }), { T1: c });
    expect(regressions).toHaveLength(1);
    expect(regressions[0]).toContain("T1 correct%");
  });

  test("does NOT flag a drop past floor when CIs still overlap (noise)", () => {
    const g = gtier(gm(0.8, 0.7, 0.9), stable, stable, stable);
    const c = gtier(gm(0.72, 0.62, 0.82), stable, stable, stable); // Δ -8pp but [0.62,0.82] overlaps [0.7,0.9]
    const { regressions } = detectRegressions(golden({ T1: g }), { T1: c });
    expect(regressions).toHaveLength(0);
  });

  test("does NOT flag a non-overlapping drop that is within the noise floor", () => {
    const g = gtier(gm(0.8, 0.79, 0.81), stable, stable, stable);
    const c = gtier(gm(0.78, 0.77, 0.785), stable, stable, stable); // CI below golden's, but Δ -2pp < floor 5pp
    const { regressions } = detectRegressions(golden({ T1: g }), { T1: c });
    expect(regressions).toHaveLength(0);
  });

  test("gates retrieval metrics: a confident recall@5 / MRR drop fails", () => {
    const g = gtier(stable, gm(0.7, 0.65, 0.75), gm(0.9, 0.85, 0.95), gm(0.8, 0.75, 0.85));
    const c = gtier(stable, gm(0.4, 0.35, 0.45), gm(0.5, 0.45, 0.55), gm(0.4, 0.35, 0.45));
    const { regressions } = detectRegressions(golden({ T1: g }), { T1: c });
    const labels = regressions.join(" | ");
    expect(labels).toContain("recall@1");
    expect(labels).toContain("recall@5");
    expect(labels).toContain("MRR");
    expect(regressions).toHaveLength(3); // correct% held stable
  });

  test("T5 gates correct% only — retrieval metrics are not gated on negatives", () => {
    // T5 recall collapses 0.5 → 0 (confident), but recall is meaningless on T5.
    const g = gtier(gm(0.9, 0.85, 0.95), gm(0.5, 0.5, 0.5), gm(0.5, 0.5, 0.5), gm(0.5, 0.5, 0.5));
    const c = gtier(gm(0.9, 0.85, 0.95), gm(0, 0, 0), gm(0, 0, 0), gm(0, 0, 0));
    const { regressions } = detectRegressions(golden({ T5: g }), { T5: c });
    expect(regressions).toHaveLength(0);
  });

  test("skips tiers absent from either golden or candidate", () => {
    const g = gtier(gm(0.8, 0.75, 0.85), stable, stable, stable);
    const { regressions, lines } = detectRegressions(golden({ T1: g }), {}); // candidate has no T1
    expect(regressions).toHaveLength(0);
    expect(lines).toHaveLength(0);
  });
});

describe("judgeMismatch — cross-judge guard", () => {
  const g = golden({}).judge;

  test("null when model and prompt hash match", () => {
    expect(judgeMismatch(g, { model: "claude-sonnet-4-6", prompt_template_hash: "abc123" })).toBeNull();
  });

  test("flags a different judge model", () => {
    const msg = judgeMismatch(g, { model: "deepseek-v4-pro", prompt_template_hash: "abc123" });
    expect(msg).toContain("judge model differs");
  });

  test("flags a different judge prompt hash", () => {
    const msg = judgeMismatch(g, { model: "claude-sonnet-4-6", prompt_template_hash: "zzz999" });
    expect(msg).toContain("judge PROMPT differs");
  });
});

describe("perTierMetrics — snapshot extraction", () => {
  const ci = (point: number): MetricWithCi => ({ point, ci_low: point, ci_high: point, query_ids: [] });
  const agg = (query_count: number, correct: number): TierAggregates => ({
    query_count,
    recall_at_1: ci(0.1),
    recall_at_3: ci(0.2),
    recall_at_5: ci(0.3),
    recall_at_10: ci(0.4),
    mrr: ci(0.5),
    reader_correct_pct: ci(correct),
    reader_hallucinated_pct: ci(0),
    reader_refused_pct: ci(0),
    unjudged_pct: 0,
    t5_top1_score_median: null,
  });

  test("includes only tiers with queries, carrying point + CI per metric", () => {
    const results = {
      per_tier: { T1: agg(10, 0.8), T2: agg(0, 0) },
    } as unknown as ResultsFile;
    const out = perTierMetrics(results);
    expect(Object.keys(out)).toEqual(["T1"]); // T2 has no queries
    expect(out["T1"]!.reader_correct_pct).toEqual({ point: 0.8, ci_low: 0.8, ci_high: 0.8 });
    expect(out["T1"]!.recall_at_5).toEqual({ point: 0.3, ci_low: 0.3, ci_high: 0.3 });
    expect(out["T1"]!.mrr.point).toBe(0.5);
  });
});
