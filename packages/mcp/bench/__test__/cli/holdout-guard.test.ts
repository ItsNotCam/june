// author: Claude
import { describe, expect, test, beforeAll } from "bun:test";
import { mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { writeJsonAtomic } from "@/lib/artifacts";
import { HOLDOUT_RESULTS_FILENAME } from "@/lib/holdout-paths";
import { UsageError } from "@/lib/errors";
import { runControlPin, runControlCheck } from "../../cli/control";
import { writeTestConfig } from "../helpers";

/**
 * The sealed-holdout guard (Phase 4). A holdout run-dir carries
 * `holdout_results.json` and is structurally incapable of becoming a golden:
 * `control-pin` / `control-check` must refuse it with a clear message, not pin a
 * real-doc score the RSI loop could then optimize against (reward-hacking guard).
 */

let cfgPath: string;
beforeAll(async () => {
  cfgPath = await writeTestConfig();
});

const makeHoldoutRunDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "holdout-run-"));
  await writeJsonAtomic(join(dir, HOLDOUT_RESULTS_FILENAME), {
    kind: "holdout",
    sealed: true,
    holdout_id: "holdout-abc",
    run_id: "RUN",
  });
  await writeFile(join(dir, "holdout_summary.md"), "# sealed\n", "utf-8");
  return dir;
};

describe("control commands reject a sealed holdout run-dir", () => {
  test("control-pin refuses", async () => {
    const dir = await makeHoldoutRunDir();
    await expect(runControlPin([dir, "--config", cfgPath])).rejects.toThrow(UsageError);
    await expect(runControlPin([dir, "--config", cfgPath])).rejects.toThrow(/SEALED/);
  });

  test("control-check refuses", async () => {
    const dir = await makeHoldoutRunDir();
    await expect(runControlCheck([dir, "--config", cfgPath])).rejects.toThrow(/NEVER be pinned or gated/);
  });
});
