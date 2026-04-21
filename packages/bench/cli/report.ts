// author: Claude
import { resolve, join } from "path";
import { writeFile } from "fs/promises";
import type { ResultsFile } from "@/types/results";
import { renderSummary } from "@/stages/09-score";
import { readJson } from "@/lib/artifacts";
import { UsageError } from "@/lib/errors";
import { bootstrap, parseArgv } from "./shared";

/**
 * `june-eval report <run_dir>` — regenerates `summary.md` from an existing
 * `results.json` (§28).
 *
 * Useful when iterating on the summary template. Deterministic — the "ten
 * verdicts to eyeball" sampler is seeded from `fixture_hash + run_id`, so the
 * same `results.json` always yields the same summary.
 */
export const runReport = async (argv: readonly string[]): Promise<void> => {
  const { positionals, flags } = parseArgv(argv);
  if (positionals.includes("--help") || positionals.length < 1) {
    process.stderr.write(REPORT_HELP);
    if (positionals.length < 1) {
      throw new UsageError("Missing <run_dir>");
    }
    return;
  }
  await bootstrap(flags);
  const run_dir = resolve(positionals[0]!);
  const resultsPath = join(run_dir, "results.json");
  const summaryPath = join(run_dir, "summary.md");
  const results = (await readJson(resultsPath)) as ResultsFile;
  await writeFile(summaryPath, renderSummary(results), "utf-8");
  process.stderr.write(`Wrote ${summaryPath}\n`);
};

const REPORT_HELP = `june-eval report — regenerate summary.md from results.json.

USAGE
  june-eval report <run_dir> [--config <path>]
`;
