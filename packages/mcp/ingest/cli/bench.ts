// author: Claude
import { spawn } from "bun";
import { join } from "node:path";
import { parseCommonFlags } from "./shared";

/**
 * `june bench <corpus-path> [--out <file>] [--no-store]` ([§28](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#28-benchmark-harness)). Thin wrapper
 * that spawns `benchmark/harness.ts` — the harness is self-contained so the
 * CLI doesn't need to re-plumb the stub dependencies.
 */
export const runBench = async (argv: ReadonlyArray<string>): Promise<number> => {
  const { positional, remaining } = parseCommonFlags(argv);
  if (positional.length === 0) {
    process.stderr.write("june: bench requires a corpus path\n");
    return 64;
  }
  const harness = join(import.meta.dir, "..", "benchmark", "harness.ts");
  const args = [...positional, ...remaining];
  const proc = spawn({
    cmd: ["bun", "run", harness, ...args],
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  return code;
};
