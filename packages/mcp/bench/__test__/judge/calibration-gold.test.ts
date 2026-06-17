// author: Claude
import { describe, expect, test } from "bun:test";
import { join } from "path";
import type { VerdictsFile } from "@/types/judge-tasks";
import { readJson } from "@/lib/artifacts";
import { loadGoldSet, scoreCalibration, DEFAULT_GOLD_SET_PATH, DEFAULT_MIN_KAPPA } from "@/lib/calibration";
import type { Verdict } from "@/types/verdict";

/**
 * The committed gold set + recorded verdicts (Phase 5) — the deterministic,
 * agent-free calibration check CI runs. The gold is balanced across all 5 verdict
 * classes; the recorded Sonnet-agent verdicts re-score to a PASSING κ. Re-scoring
 * here proves the committed artifacts stay consistent without spawning any agent.
 */

const GOLD = DEFAULT_GOLD_SET_PATH;
const VERDICTS = join(import.meta.dir, "fixtures", "calibration-verdicts.json");
const VERDICT_CLASSES: Verdict[] = ["CORRECT", "PARTIAL", "INCORRECT", "REFUSED", "HALLUCINATED"];

describe("committed calibration gold set", () => {
  test("is balanced across all five verdict classes, every label internally valid", async () => {
    const gold = await loadGoldSet(GOLD); // throws if any human_verdict ∉ acceptable_verdicts
    expect(gold.cases.length).toBeGreaterThanOrEqual(40);
    const dist = new Map<string, number>();
    for (const c of gold.cases) dist.set(c.human_verdict, (dist.get(c.human_verdict) ?? 0) + 1);
    for (const cls of VERDICT_CLASSES) {
      expect(dist.get(cls) ?? 0).toBeGreaterThanOrEqual(5); // each class meaningfully represented
    }
  });

  test("recorded Sonnet-agent verdicts re-score to a PASSING calibration (CI gate, no agents)", async () => {
    const gold = await loadGoldSet(GOLD);
    const verdicts = (await readJson(VERDICTS)) as VerdictsFile;
    const record = scoreCalibration({
      gold: gold.cases,
      verdicts: verdicts.verdicts,
      judge: verdicts.judge,
      min_kappa: DEFAULT_MIN_KAPPA,
      judged_at: "test",
    });
    expect(record.n).toBe(gold.cases.length);
    expect(record.passed).toBe(true);
    expect(record.cohens_kappa).toBeGreaterThanOrEqual(DEFAULT_MIN_KAPPA);
    // Every gold case has a recorded verdict (no UNJUDGED holes).
    expect(record.confusion.some((c) => c.b === "UNJUDGED")).toBe(false);
  });
});
