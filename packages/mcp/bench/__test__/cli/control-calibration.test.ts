// author: Claude
import { describe, expect, test, beforeAll } from "bun:test";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { writeJsonAtomic } from "@/lib/artifacts";
import { UsageError } from "@/lib/errors";
import { runControlPin } from "../../cli/control";
import { writeTestConfig } from "../helpers";

/**
 * The Phase 5 licensing gate on `control-pin`: a golden may only be pinned with a
 * judge whose identity has a PASSING κ calibration against the current gold set.
 * An uncalibrated judge is refused — and crucially BEFORE any golden is written
 * (the gate runs before the noise-floor resolution + golden write), so a rejected
 * pin never mutates golden.json.
 */

let cfgPath: string;
beforeAll(async () => {
  cfgPath = await writeTestConfig();
});

/** Minimal results.json carrying just what control-pin reads up to the calibration gate. */
const writeRunDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "pin-calib-"));
  await writeJsonAtomic(join(dir, "results.json"), {
    run_status: "completed",
    manifest: {
      mode: "control",
      fixture_hash: "fh",
      roles: { judge: { provider: "claude-code-agent", model: "claude-sonnet-4-6", prompt_template_hash: "ph" } },
    },
  });
  return dir;
};

describe("control-pin judge-calibration gate", () => {
  test("refuses to pin with an uncalibrated judge", async () => {
    const dir = await writeRunDir();
    const emptyRegistry = join(await mkdtemp(join(tmpdir(), "reg-")), "registry.json");
    const goldDir = await mkdtemp(join(tmpdir(), "gold-"));
    const goldPath = join(goldDir, "gold.json");
    await writeJsonAtomic(goldPath, {
      schema_version: 1,
      cases: [{ id: "g1", tier: "T1", query_text: "q", expected_surface_hints: ["h"], retrieved_context: "c", reader_answer: "a", human_verdict: "CORRECT", acceptable_verdicts: ["CORRECT"] }],
    });
    await expect(
      runControlPin([dir, "--calibration-file", emptyRegistry, "--gold-set", goldPath, "--config", cfgPath]),
    ).rejects.toThrow(UsageError);
    await expect(
      runControlPin([dir, "--calibration-file", emptyRegistry, "--gold-set", goldPath, "--config", cfgPath]),
    ).rejects.toThrow(/not licensed/);
  });
});
