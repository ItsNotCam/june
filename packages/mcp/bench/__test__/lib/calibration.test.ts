// author: Claude
import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { GoldCase } from "@/types/calibration";
import type { VerdictRecord } from "@/types/judge";
import { writeJsonAtomic } from "@/lib/artifacts";
import {
  scoreCalibration,
  loadGoldSet,
  computeGoldSetHash,
  calibrationStatus,
  writeCalibrationRecord,
  judgeKey,
} from "@/lib/calibration";

/**
 * Judge calibration (Phase 5). The score is pure (gold + agent verdicts → κ +
 * pass/fail); the licensing status checks a passing record exists for the judge
 * identity AND was measured against the CURRENT gold (a changed gold invalidates).
 */

const gold: GoldCase[] = [
  { id: "g1", tier: "T1", query_text: "q1", expected_surface_hints: ["h1"], retrieved_context: "c", reader_answer: "a1", human_verdict: "CORRECT", acceptable_verdicts: ["CORRECT"] },
  { id: "g2", tier: "T1", query_text: "q2", expected_surface_hints: ["h2"], retrieved_context: "c", reader_answer: "a2", human_verdict: "INCORRECT", acceptable_verdicts: ["INCORRECT", "HALLUCINATED"] },
  { id: "g3", tier: "T5", query_text: "q3", expected_surface_hints: [], retrieved_context: "c", reader_answer: "a3", human_verdict: "REFUSED", acceptable_verdicts: ["REFUSED"] },
  { id: "g4", tier: "T1", query_text: "q4", expected_surface_hints: ["h4"], retrieved_context: "c", reader_answer: "a4", human_verdict: "HALLUCINATED", acceptable_verdicts: ["HALLUCINATED"] },
];

const v = (id: string, verdict: VerdictRecord["verdict"]): VerdictRecord => ({ query_id: id, verdict, rationale: "", unjudged_reason: null });
const judge = { kind: "claude-code-agent", model: "claude-sonnet-4-6", prompt_template_hash: "ph" };

describe("scoreCalibration", () => {
  test("perfect agreement → κ 1, passed", () => {
    const rec = scoreCalibration({
      gold,
      verdicts: [v("g1", "CORRECT"), v("g2", "INCORRECT"), v("g3", "REFUSED"), v("g4", "HALLUCINATED")],
      judge, min_kappa: 0.7, judged_at: "t",
    });
    expect(rec.cohens_kappa).toBe(1);
    expect(rec.raw_agreement).toBe(1);
    expect(rec.passed).toBe(true);
    expect(rec.per_class.CORRECT).toEqual({ support: 1, agree: 1 });
  });

  test("lenient agreement credits an acceptable alternative; raw does not", () => {
    // g2 human=INCORRECT, agent=HALLUCINATED (in acceptable set).
    const rec = scoreCalibration({
      gold,
      verdicts: [v("g1", "CORRECT"), v("g2", "HALLUCINATED"), v("g3", "REFUSED"), v("g4", "HALLUCINATED")],
      judge, min_kappa: 0.7, judged_at: "t",
    });
    expect(rec.raw_agreement).toBe(0.75); // g2 exact-misses
    expect(rec.lenient_agreement).toBe(1); // but is acceptable
    expect(rec.confusion.some((c) => c.a === "INCORRECT" && c.b === "HALLUCINATED")).toBe(true);
  });

  test("a missing/UNJUDGED verdict blocks passed even at high κ", () => {
    const rec = scoreCalibration({
      gold,
      verdicts: [v("g1", "CORRECT"), v("g2", "INCORRECT"), v("g3", "REFUSED")], // g4 missing
      judge, min_kappa: 0.1, judged_at: "t",
    });
    expect(rec.passed).toBe(false);
    expect(rec.confusion.some((c) => c.b === "UNJUDGED")).toBe(true);
  });

  test("κ below threshold → not passed", () => {
    const rec = scoreCalibration({
      gold,
      verdicts: [v("g1", "INCORRECT"), v("g2", "CORRECT"), v("g3", "CORRECT"), v("g4", "REFUSED")],
      judge, min_kappa: 0.7, judged_at: "t",
    });
    expect(rec.cohens_kappa).toBeLessThan(0.7);
    expect(rec.passed).toBe(false);
  });
});

describe("loadGoldSet", () => {
  test("rejects a case whose human_verdict is not in acceptable_verdicts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gold-"));
    const path = join(dir, "gold.json");
    await writeJsonAtomic(path, {
      schema_version: 1,
      cases: [{ ...gold[0], human_verdict: "REFUSED", acceptable_verdicts: ["CORRECT"] }],
    });
    await expect(loadGoldSet(path)).rejects.toThrow(/not in acceptable_verdicts/);
  });
});

describe("calibrationStatus", () => {
  const seed = async (passed: boolean, goldHash: string) => {
    const dir = await mkdtemp(join(tmpdir(), "calib-"));
    const goldPath = join(dir, "gold.json");
    await writeJsonAtomic(goldPath, { schema_version: 1, cases: gold });
    const regPath = join(dir, "registry.json");
    await writeCalibrationRecord(
      { schema_version: 1, judge, gold_set_hash: goldHash, n: 4, cohens_kappa: passed ? 0.9 : 0.4, raw_agreement: 0.9, lenient_agreement: 0.9, min_kappa: 0.7, passed, per_class: {}, confusion: [], judged_at: "t" },
      regPath,
    );
    return { goldPath, regPath };
  };

  test("licensed when a passing record matches the current gold hash", async () => {
    const { goldPath, regPath } = await seed(true, computeGoldSetHash(gold));
    const status = await calibrationStatus(judge, { registryPath: regPath, goldPath });
    expect(status.licensed).toBe(true);
  });

  test("not licensed when the record failed", async () => {
    const { goldPath, regPath } = await seed(false, computeGoldSetHash(gold));
    const status = await calibrationStatus(judge, { registryPath: regPath, goldPath });
    expect(status.licensed).toBe(false);
    expect(status.licensed === false && status.reason).toMatch(/failed/);
  });

  test("STALE when the gold set changed since validation", async () => {
    const { goldPath, regPath } = await seed(true, "a-different-old-hash");
    const status = await calibrationStatus(judge, { registryPath: regPath, goldPath });
    expect(status.licensed).toBe(false);
    expect(status.licensed === false && status.reason).toMatch(/STALE/);
  });

  test("not licensed when no record exists for the identity", async () => {
    const dir = await mkdtemp(join(tmpdir(), "calib-empty-"));
    const goldPath = join(dir, "gold.json");
    await writeFile(goldPath, JSON.stringify({ schema_version: 1, cases: gold }), "utf-8");
    const status = await calibrationStatus(judge, { registryPath: join(dir, "none.json"), goldPath });
    expect(status.licensed).toBe(false);
    expect(judgeKey(judge)).toBe("claude-sonnet-4-6::ph");
  });
});
