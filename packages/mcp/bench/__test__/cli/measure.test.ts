// author: Claude
import { describe, expect, test, beforeAll } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { MetricWithCi, PerQueryRecord, ResultsFile, TierAggregates } from "@/types/results";
import type { VerdictsFile } from "@/types/judge-tasks";
import { NoiseFloorFileSchema } from "@/types/noise-floor";
import { readJson, writeJsonAtomic } from "@/lib/artifacts";
import { IntegrityViolationError, UsageError } from "@/lib/errors";
import { gatherVariance, runMeasureNoiseFloor, runMeasureConsistency } from "../../cli/measure";
import { resolveNoiseFloor } from "../../cli/control";
import type { GoldenTier } from "../../cli/control";
import { writeTestConfig } from "../helpers";

/**
 * Phase 2 — the MEASURED noise floor. `measure-noise-floor` proves retrieval
 * determinism (asserts ≈0 on a shared ingest); `measure-consistency` measures
 * judge variance; `control-pin` consumes the resulting noise-floor.json instead
 * of a hand-typed guess.
 */

let cfgPath: string;
beforeAll(async () => {
  cfgPath = await writeTestConfig();
});

// ---- builders -------------------------------------------------------------

const ci = (point: number): MetricWithCi => ({ point, ci_low: point, ci_high: point, query_ids: [] });

const emptyMetric = (): MetricWithCi => ci(0);
const emptyTier = (): TierAggregates => ({
  query_count: 0,
  recall_at_1: emptyMetric(),
  recall_at_3: emptyMetric(),
  recall_at_5: emptyMetric(),
  recall_at_10: emptyMetric(),
  mrr: emptyMetric(),
  reader_correct_pct: emptyMetric(),
  reader_hallucinated_pct: emptyMetric(),
  reader_refused_pct: emptyMetric(),
  unjudged_pct: 0,
  t5_top1_score_median: null,
});

const tier = (count: number, m: { r1: number; r5: number; mrr: number; correct: number }): TierAggregates => ({
  ...emptyTier(),
  query_count: count,
  recall_at_1: ci(m.r1),
  recall_at_5: ci(m.r5),
  mrr: ci(m.mrr),
  reader_correct_pct: ci(m.correct),
});

const gt = (m: { r1: number; r5: number; mrr: number; correct: number }, count = 10): GoldenTier => ({
  query_count: count,
  reader_correct_pct: { point: m.correct, ci_low: m.correct, ci_high: m.correct },
  recall_at_1: { point: m.r1, ci_low: m.r1, ci_high: m.r1 },
  recall_at_5: { point: m.r5, ci_low: m.r5, ci_high: m.r5 },
  mrr: { point: m.mrr, ci_low: m.mrr, ci_high: m.mrr },
});

const baseResults = (over: {
  run_id: string;
  fixture_hash: string;
  ingest_run_id: string;
  per_tier?: Partial<Record<string, TierAggregates>>;
  per_query?: PerQueryRecord[];
}): ResultsFile => ({
  fixture_id: "FID",
  run_id: over.run_id,
  schema_version: 1,
  run_status: "awaiting_verdicts",
  started_at: "",
  completed_at: "",
  manifest: {
    fixture_id: "FID",
    fixture_hash: over.fixture_hash,
    fixture_seed: 1,
    run_id: over.run_id,
    bench_version: "0.1.0",
    schema_version: 1,
    started_at: "",
    completed_at: "",
    mode: "control",
    roles: {
      corpus_author: { provider: "a", model: "b" },
      query_author: { provider: "c", model: "d" },
      reader: { provider: "ollama", model: "gemma4:26b", temperature: 0 },
      judge: { provider: "external", model: "claude-sonnet-4-6", prompt_template_hash: "hash-A" },
      baseline: null,
    },
    june: { ingest_run_id: over.ingest_run_id, schema_version: 1, embedding_model: "m", embedding_model_version: "" },
    retrieval_config_snapshot: {},
    caching_enabled: false,
    budget_cap_usd: 5,
  },
  per_query: over.per_query ?? [],
  per_tier: {
    T1: over.per_tier?.["T1"] ?? emptyTier(),
    T2: over.per_tier?.["T2"] ?? emptyTier(),
    T3: over.per_tier?.["T3"] ?? emptyTier(),
    T4: over.per_tier?.["T4"] ?? emptyTier(),
    T5: over.per_tier?.["T5"] ?? emptyTier(),
    T6: over.per_tier?.["T6"] ?? emptyTier(),
    T7: over.per_tier?.["T7"] ?? emptyTier(),
  },
  overall: {
    macro: { reader_correct_pct: emptyMetric(), recall_at_5: emptyMetric(), recall_at_10: emptyMetric(), mrr: emptyMetric() },
    micro: { reader_correct_pct: emptyMetric(), recall_at_5: emptyMetric(), recall_at_10: emptyMetric(), mrr: emptyMetric() },
  },
  integrity: { unresolved_pct: 0, embedding_pct: 0, unjudged_pct: 1, queries_with_leakage_warning: 0 },
  cost_usd: { role_1: 0, role_2: 0, role_3: 0, role_4: 0, total: 0 },
});

const writeRun = async (root: string, r: ResultsFile): Promise<string> => {
  const dir = join(root, r.run_id);
  await mkdir(dir, { recursive: true });
  await writeJsonAtomic(join(dir, "results.json"), r);
  return dir;
};

const pq = (id: string, t: PerQueryRecord["tier"]): PerQueryRecord => ({
  query_id: id,
  tier: t,
  query_text: "",
  expected_fact_ids: [],
  retrieved_chunk_ids: [],
  reader_answer: "",
  verdict: "UNJUDGED",
  rationale: "",
  recall_at_k: { "1": 1, "3": 1, "5": 1, "10": 1 },
  mrr: 1,
  t5_top1_score: null,
  baseline_answer: null,
  baseline_verdict: null,
});

const verdictsFile = (
  run_id: string,
  verdicts: Array<{ query_id: string; verdict: VerdictsFile["verdicts"][number]["verdict"] }>,
  judge: { model: string; prompt_template_hash: string } = { model: "claude-sonnet-4-6", prompt_template_hash: "hash-A" },
): VerdictsFile => ({
  fixture_id: "FID",
  run_id,
  schema_version: 1,
  judge: { kind: "claude-code-agent", model: judge.model, prompt_template_hash: judge.prompt_template_hash, judged_at: "2026-06-17T00:00:00Z" },
  verdicts: verdicts.map((v) => ({ query_id: v.query_id, verdict: v.verdict, rationale: "", unjudged_reason: null })),
});

const writeVerdicts = async (root: string, name: string, v: VerdictsFile): Promise<string> => {
  const p = join(root, name);
  await writeFile(p, JSON.stringify(v), "utf-8");
  return p;
};

// ---- gatherVariance (pure) ------------------------------------------------

describe("gatherVariance", () => {
  const metrics = [
    { key: "recall_at_5", label: "recall_at_5" },
    { key: "mrr", label: "mrr" },
  ] as const;

  test("identical runs → every range 0, max_drift 0", () => {
    const a = { T1: gt({ r1: 0.7, r5: 0.9, mrr: 0.8, correct: 0.9 }) };
    const { per_tier, max_drift } = gatherVariance([a, a], metrics, { retrievalOnly: true });
    expect(max_drift).toBe(0);
    expect(per_tier["T1"]!["recall_at_5"]!.range).toBe(0);
  });

  test("differing runs → max_drift is the largest spread", () => {
    const a = { T1: gt({ r1: 0.7, r5: 0.9, mrr: 0.8, correct: 0.9 }) };
    const b = { T1: gt({ r1: 0.7, r5: 0.5, mrr: 0.6, correct: 0.9 }) }; // r5 −0.4, mrr −0.2
    const { per_tier, max_drift } = gatherVariance([a, b], metrics, { retrievalOnly: true });
    expect(per_tier["T1"]!["recall_at_5"]!.range).toBeCloseTo(0.4, 12);
    expect(per_tier["T1"]!["mrr"]!.range).toBeCloseTo(0.2, 12);
    expect(max_drift).toBeCloseTo(0.4, 12);
  });

  test("retrievalOnly skips T5", () => {
    const a = { T1: gt({ r1: 1, r5: 1, mrr: 1, correct: 1 }), T5: gt({ r1: 0, r5: 0, mrr: 0, correct: 1 }) };
    const { per_tier } = gatherVariance([a, a], metrics, { retrievalOnly: true });
    expect(per_tier["T5"]).toBeUndefined();
    expect(per_tier["T1"]).toBeDefined();
  });

  test("a tier present in only one run is dropped (no shrinking the sample)", () => {
    const a = { T1: gt({ r1: 1, r5: 1, mrr: 1, correct: 1 }), T2: gt({ r1: 1, r5: 1, mrr: 1, correct: 1 }) };
    const b = { T1: gt({ r1: 1, r5: 1, mrr: 1, correct: 1 }) }; // no T2
    const { per_tier } = gatherVariance([a, b], metrics, { retrievalOnly: true });
    expect(per_tier["T2"]).toBeUndefined();
    expect(per_tier["T1"]).toBeDefined();
  });
});

// ---- measure-noise-floor (determinism) ------------------------------------

describe("measure-noise-floor", () => {
  test("identical metrics + shared ingest → deterministic, max_drift 0", async () => {
    const root = await mkdtemp(join(tmpdir(), "mnf-det-"));
    const out = join(root, "noise-floor.json");
    const t = { T1: tier(10, { r1: 0.7, r5: 0.9, mrr: 0.8, correct: 0.9 }) };
    const a = await writeRun(root, baseResults({ run_id: "r-a", fixture_hash: "FH", ingest_run_id: "ing-1", per_tier: t }));
    const b = await writeRun(root, baseResults({ run_id: "r-b", fixture_hash: "FH", ingest_run_id: "ing-1", per_tier: t }));

    await runMeasureNoiseFloor([a, b, "--config", cfgPath, "--out", out]);

    const file = NoiseFloorFileSchema.parse(await readJson(out));
    expect(file.fixture_hash).toBe("FH");
    expect(file.determinism!.shared_ingest).toBe(true);
    expect(file.determinism!.deterministic).toBe(true);
    expect(file.determinism!.max_drift).toBe(0);
    expect(file.consistency).toBeNull();
    expect(file.recommended_noise_floor).toBe(0);
  });

  test("differing retrieval + shared ingest → THROWS (non-determinism is a bug)", async () => {
    const root = await mkdtemp(join(tmpdir(), "mnf-bug-"));
    const out = join(root, "noise-floor.json");
    const a = await writeRun(root, baseResults({ run_id: "r-a", fixture_hash: "FH", ingest_run_id: "ing-1", per_tier: { T1: tier(10, { r1: 0.7, r5: 0.9, mrr: 0.8, correct: 0.9 }) } }));
    const b = await writeRun(root, baseResults({ run_id: "r-b", fixture_hash: "FH", ingest_run_id: "ing-1", per_tier: { T1: tier(10, { r1: 0.7, r5: 0.6, mrr: 0.8, correct: 0.9 }) } }));

    await expect(runMeasureNoiseFloor([a, b, "--config", cfgPath, "--out", out])).rejects.toBeInstanceOf(IntegrityViolationError);
  });

  test("differing retrieval + DIFFERENT ingests → no throw, reports non-deterministic drift", async () => {
    const root = await mkdtemp(join(tmpdir(), "mnf-fresh-"));
    const out = join(root, "noise-floor.json");
    const a = await writeRun(root, baseResults({ run_id: "r-a", fixture_hash: "FH", ingest_run_id: "ing-1", per_tier: { T1: tier(10, { r1: 0.7, r5: 0.9, mrr: 0.8, correct: 0.9 }) } }));
    const b = await writeRun(root, baseResults({ run_id: "r-b", fixture_hash: "FH", ingest_run_id: "ing-2", per_tier: { T1: tier(10, { r1: 0.7, r5: 0.6, mrr: 0.8, correct: 0.9 }) } }));

    await runMeasureNoiseFloor([a, b, "--config", cfgPath, "--out", out]);
    const file = NoiseFloorFileSchema.parse(await readJson(out));
    expect(file.determinism!.shared_ingest).toBe(false);
    expect(file.determinism!.deterministic).toBe(false);
    expect(file.determinism!.max_drift).toBeCloseTo(0.3, 12); // recall@5 0.9→0.6
    expect(file.recommended_noise_floor).toBeCloseTo(0.3, 12);
  });

  test("mismatched fixture across runs → UsageError", async () => {
    const root = await mkdtemp(join(tmpdir(), "mnf-fix-"));
    const out = join(root, "noise-floor.json");
    const a = await writeRun(root, baseResults({ run_id: "r-a", fixture_hash: "FH1", ingest_run_id: "ing-1" }));
    const b = await writeRun(root, baseResults({ run_id: "r-b", fixture_hash: "FH2", ingest_run_id: "ing-1" }));
    await expect(runMeasureNoiseFloor([a, b, "--config", cfgPath, "--out", out])).rejects.toBeInstanceOf(UsageError);
  });

  test("fewer than 2 runs → UsageError", async () => {
    const root = await mkdtemp(join(tmpdir(), "mnf-one-"));
    const a = await writeRun(root, baseResults({ run_id: "r-a", fixture_hash: "FH", ingest_run_id: "ing-1" }));
    await expect(runMeasureNoiseFloor([a, "--config", cfgPath, "--out", join(root, "nf.json")])).rejects.toBeInstanceOf(UsageError);
  });
});

// ---- measure-consistency --------------------------------------------------

describe("measure-consistency", () => {
  const fourT1 = [pq("q1", "T1"), pq("q2", "T1"), pq("q3", "T1"), pq("q4", "T1")];

  test("two re-judges with different correctness → measured correct% spread", async () => {
    const root = await mkdtemp(join(tmpdir(), "mc-"));
    const out = join(root, "noise-floor.json");
    const dir = await writeRun(root, baseResults({ run_id: "r-1", fixture_hash: "FH", ingest_run_id: "ing-1", per_query: fourT1 }));

    // Judge A: all CORRECT → T1 correct% = 1.0. Judge B: half → 0.5. Spread 0.5.
    const vA = await writeVerdicts(root, "vA.json", verdictsFile("r-1", fourT1.map((q) => ({ query_id: q.query_id, verdict: "CORRECT" as const }))));
    const vB = await writeVerdicts(root, "vB.json", verdictsFile("r-1", [
      { query_id: "q1", verdict: "CORRECT" }, { query_id: "q2", verdict: "CORRECT" },
      { query_id: "q3", verdict: "INCORRECT" }, { query_id: "q4", verdict: "INCORRECT" },
    ]));

    await runMeasureConsistency([dir, vA, vB, "--config", cfgPath, "--out", out]);
    const file = NoiseFloorFileSchema.parse(await readJson(out));
    expect(file.consistency!.runs).toBe(2);
    expect(file.consistency!.judge.model).toBe("claude-sonnet-4-6");
    expect(file.consistency!.per_tier["T1"]!["reader_correct_pct"]!.range).toBeCloseTo(0.5, 12);
    expect(file.consistency!.max_drift).toBeCloseTo(0.5, 12);
    expect(file.recommended_noise_floor).toBeCloseTo(0.5, 12);
  });

  test("re-judges under different judge identities → UsageError", async () => {
    const root = await mkdtemp(join(tmpdir(), "mc-judge-"));
    const dir = await writeRun(root, baseResults({ run_id: "r-1", fixture_hash: "FH", ingest_run_id: "ing-1", per_query: fourT1 }));
    const vA = await writeVerdicts(root, "vA.json", verdictsFile("r-1", [{ query_id: "q1", verdict: "CORRECT" }]));
    const vB = await writeVerdicts(root, "vB.json", verdictsFile("r-1", [{ query_id: "q1", verdict: "CORRECT" }], { model: "deepseek-v4-pro", prompt_template_hash: "hash-A" }));
    await expect(runMeasureConsistency([dir, vA, vB, "--config", cfgPath, "--out", join(root, "nf.json")])).rejects.toBeInstanceOf(UsageError);
  });

  test("verdicts for the wrong run → UsageError", async () => {
    const root = await mkdtemp(join(tmpdir(), "mc-wrong-"));
    const dir = await writeRun(root, baseResults({ run_id: "r-1", fixture_hash: "FH", ingest_run_id: "ing-1", per_query: fourT1 }));
    const vA = await writeVerdicts(root, "vA.json", verdictsFile("r-1", [{ query_id: "q1", verdict: "CORRECT" }]));
    const vB = await writeVerdicts(root, "vB.json", verdictsFile("r-OTHER", [{ query_id: "q1", verdict: "CORRECT" }]));
    await expect(runMeasureConsistency([dir, vA, vB, "--config", cfgPath, "--out", join(root, "nf.json")])).rejects.toBeInstanceOf(UsageError);
  });

  test("fewer than 2 verdict sets → UsageError", async () => {
    const root = await mkdtemp(join(tmpdir(), "mc-one-"));
    const dir = await writeRun(root, baseResults({ run_id: "r-1", fixture_hash: "FH", ingest_run_id: "ing-1", per_query: fourT1 }));
    const vA = await writeVerdicts(root, "vA.json", verdictsFile("r-1", [{ query_id: "q1", verdict: "CORRECT" }]));
    await expect(runMeasureConsistency([dir, vA, "--config", cfgPath, "--out", join(root, "nf.json")])).rejects.toBeInstanceOf(UsageError);
  });

  test("merges into an existing determinism block; recommended = max of both", async () => {
    const root = await mkdtemp(join(tmpdir(), "mc-merge-"));
    const out = join(root, "noise-floor.json");
    // First, a determinism block with a small fresh-ingest drift of 0.1.
    const a = await writeRun(root, baseResults({ run_id: "r-a", fixture_hash: "FH", ingest_run_id: "ing-1", per_tier: { T1: tier(10, { r1: 0.7, r5: 0.9, mrr: 0.8, correct: 0.9 }) } }));
    const b = await writeRun(root, baseResults({ run_id: "r-b", fixture_hash: "FH", ingest_run_id: "ing-2", per_tier: { T1: tier(10, { r1: 0.7, r5: 0.8, mrr: 0.8, correct: 0.9 }) } }));
    await runMeasureNoiseFloor([a, b, "--config", cfgPath, "--out", out]);

    // Then consistency with a larger 0.5 spread.
    const dir = await writeRun(root, baseResults({ run_id: "r-1", fixture_hash: "FH", ingest_run_id: "ing-1", per_query: fourT1 }));
    const vA = await writeVerdicts(root, "vA.json", verdictsFile("r-1", fourT1.map((q) => ({ query_id: q.query_id, verdict: "CORRECT" as const }))));
    const vB = await writeVerdicts(root, "vB.json", verdictsFile("r-1", [
      { query_id: "q1", verdict: "CORRECT" }, { query_id: "q2", verdict: "CORRECT" },
      { query_id: "q3", verdict: "INCORRECT" }, { query_id: "q4", verdict: "INCORRECT" },
    ]));
    await runMeasureConsistency([dir, vA, vB, "--config", cfgPath, "--out", out]);

    const file = NoiseFloorFileSchema.parse(await readJson(out));
    expect(file.determinism).not.toBeNull();
    expect(file.consistency).not.toBeNull();
    expect(file.determinism!.max_drift).toBeCloseTo(0.1, 12);
    expect(file.consistency!.max_drift).toBeCloseTo(0.5, 12);
    expect(file.recommended_noise_floor).toBeCloseTo(0.5, 12); // max(0.1, 0.5)
  });
});

// ---- control-pin consuming the measured floor -----------------------------

describe("resolveNoiseFloor (control-pin)", () => {
  const writeNf = async (over: { fixture_hash: string; consistency: boolean; rec: number }): Promise<string> => {
    const root = await mkdtemp(join(tmpdir(), "nf-"));
    const p = join(root, "noise-floor.json");
    await writeJsonAtomic(p, {
      schema_version: 1,
      fixture_hash: over.fixture_hash,
      determinism: { runs: 2, source_run_ids: ["a", "b"], ingest_run_ids: ["i", "i"], shared_ingest: true, per_tier: {}, max_drift: 0, epsilon: 1e-9, deterministic: true, measured_at: "t" },
      consistency: over.consistency
        ? { runs: 2, source_run_id: "r", source_verdicts: ["a", "b"], judge: { model: "claude-sonnet-4-6", prompt_template_hash: "hash-A" }, per_tier: {}, max_drift: over.rec, measured_at: "t" }
        : null,
      recommended_noise_floor: over.rec,
    });
    return p;
  };

  test("--accept-floor overrides with a typed value, marked UNMEASURED", async () => {
    const { noise_floor, source } = await resolveNoiseFloor({ "accept-floor": "0.08" }, "FH");
    expect(noise_floor).toBe(0.08);
    expect(source).toContain("UNMEASURED");
  });

  test("--accept-floor out of [0,1] → UsageError", async () => {
    await expect(resolveNoiseFloor({ "accept-floor": "1.5" }, "FH")).rejects.toBeInstanceOf(UsageError);
  });

  test("measured file with matching fixture + consistency block → its recommended floor", async () => {
    const p = await writeNf({ fixture_hash: "FH", consistency: true, rec: 0.06 });
    const { noise_floor, source } = await resolveNoiseFloor({ "noise-floor-file": p }, "FH");
    expect(noise_floor).toBeCloseTo(0.06, 12);
    expect(source).toContain("measured");
  });

  test("missing file → UsageError pointing at the measure commands", async () => {
    await expect(resolveNoiseFloor({ "noise-floor-file": "/nonexistent/noise-floor.json" }, "FH")).rejects.toBeInstanceOf(UsageError);
  });

  test("fixture mismatch → UsageError", async () => {
    const p = await writeNf({ fixture_hash: "OTHER", consistency: true, rec: 0.06 });
    await expect(resolveNoiseFloor({ "noise-floor-file": p }, "FH")).rejects.toBeInstanceOf(UsageError);
  });

  test("no consistency block → UsageError (gated correct% floor must be measured)", async () => {
    const p = await writeNf({ fixture_hash: "FH", consistency: false, rec: 0 });
    await expect(resolveNoiseFloor({ "noise-floor-file": p }, "FH")).rejects.toBeInstanceOf(UsageError);
  });
});
