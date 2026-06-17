// author: Claude
import { describe, expect, test, beforeAll } from "bun:test";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { GoldCase, CalibrationRegistry } from "@/types/calibration";
import type { JudgeTasksFile } from "@/types/judge-tasks";
import { writeJsonAtomic, readJson } from "@/lib/artifacts";
import { judgeKey } from "@/lib/calibration";
import { JudgeCalibrationError } from "@/lib/errors";
import { runValidateJudgeEmit, runValidateJudgeScore } from "../../cli/validate-judge";
import { writeTestConfig } from "../helpers";

/**
 * `validate-judge` emit → score round-trip (Phase 5). emit produces a tasks file
 * the agents judge; score computes κ vs the human gold, writes the licensing
 * record, and fails (throws) below the threshold or on any UNJUDGED case.
 */

let cfgPath: string;
beforeAll(async () => {
  cfgPath = await writeTestConfig();
});

const gold: GoldCase[] = [
  { id: "g1", tier: "T1", query_text: "q1", expected_surface_hints: ["h1"], retrieved_context: "ctx", reader_answer: "a1", human_verdict: "CORRECT", acceptable_verdicts: ["CORRECT"] },
  { id: "g2", tier: "T1", query_text: "q2", expected_surface_hints: ["h2"], retrieved_context: "ctx", reader_answer: "a2", human_verdict: "INCORRECT", acceptable_verdicts: ["INCORRECT"] },
  { id: "g3", tier: "T5", query_text: "q3", expected_surface_hints: [], retrieved_context: "", reader_answer: "a3", human_verdict: "REFUSED", acceptable_verdicts: ["REFUSED"] },
];

const writeGold = async (dir: string): Promise<string> => {
  const p = join(dir, "gold.json");
  await writeJsonAtomic(p, { schema_version: 1, cases: gold });
  return p;
};

const verdictsFile = (entries: Array<[string, string]>) => ({
  fixture_id: "judge-calibration",
  run_id: "calibration-x",
  schema_version: 1 as const,
  judge: { kind: "claude-code-agent" as const, model: "claude-sonnet-4-6", prompt_template_hash: "ph", judged_at: "t" },
  verdicts: entries.map(([query_id, verdict]) => ({ query_id, verdict, rationale: "r", unjudged_reason: null })),
});

describe("validate-judge emit", () => {
  test("writes a judge_tasks.json from the gold cases (no human labels leaked)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vj-emit-"));
    const goldPath = await writeGold(dir);
    const outPath = join(dir, "tasks.json");
    await runValidateJudgeEmit(["--gold", goldPath, "--out", outPath, "--config", cfgPath]);
    const tasks = (await readJson(outPath)) as JudgeTasksFile;
    expect(tasks.tasks).toHaveLength(3);
    expect(tasks.tasks[0]!.query_id).toBe("g1");
    expect(tasks.tasks[0]!.expected_facts).toEqual([{ surface_hint: "h1" }]);
    // No verdict / human label in the emitted task.
    expect(JSON.stringify(tasks)).not.toContain("human_verdict");
  });
});

describe("validate-judge score", () => {
  test("perfect verdicts → passing record written, no throw", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vj-pass-"));
    const goldPath = await writeGold(dir);
    const verdictsPath = join(dir, "verdicts.json");
    await writeJsonAtomic(verdictsPath, verdictsFile([["g1", "CORRECT"], ["g2", "INCORRECT"], ["g3", "REFUSED"]]));
    const regPath = join(dir, "registry.json");
    await runValidateJudgeScore([verdictsPath, "--gold", goldPath, "--out", regPath, "--min-kappa", "0.7", "--config", cfgPath]);
    const registry = (await readJson(regPath)) as CalibrationRegistry;
    const rec = registry[judgeKey({ model: "claude-sonnet-4-6", prompt_template_hash: "ph" })];
    expect(rec?.passed).toBe(true);
    expect(rec?.cohens_kappa).toBe(1);
  });

  test("bad verdicts → throws JudgeCalibrationError AND still records the failure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vj-fail-"));
    const goldPath = await writeGold(dir);
    const verdictsPath = join(dir, "verdicts.json");
    await writeJsonAtomic(verdictsPath, verdictsFile([["g1", "INCORRECT"], ["g2", "CORRECT"], ["g3", "CORRECT"]]));
    const regPath = join(dir, "registry.json");
    await expect(
      runValidateJudgeScore([verdictsPath, "--gold", goldPath, "--out", regPath, "--config", cfgPath]),
    ).rejects.toThrow(JudgeCalibrationError);
    const registry = (await readJson(regPath)) as CalibrationRegistry;
    expect(Object.values(registry)[0]?.passed).toBe(false);
  });
});
