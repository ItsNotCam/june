// author: Claude
import { resolve, join } from "path";
import { writeFile } from "fs/promises";
import type { ResultsFile } from "@/types/results";
import type { JudgeProvenance } from "@/types/judge-tasks";
import { VerdictsFileSchema } from "@/schemas/verdict";
import { rescoreWithVerdicts, renderSummary } from "@/stages/09-score";
import { readJson, writeJsonAtomic } from "@/lib/artifacts";
import { UsageError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { bootstrap, parseArgv, flagString } from "./shared";

/**
 * `june-eval score <run_dir> --verdicts <file>` — finalize an `awaiting_verdicts`
 * run from externally-produced verdicts (the no-API judge architecture).
 *
 * The bench's `run --judge external` emits `judge_tasks.json` and writes a
 * partial `results.json` (retrieval metrics final, correctness pending). The
 * Claude Code RSI orchestrator judges those tasks with its own Sonnet agents
 * and writes `verdicts.json` (see JUDGE-RUNNER.md). This command overlays those
 * verdicts onto the partial run and rewrites `results.json` + `summary.md` as a
 * completed run. It calls no LLM and reads only the run-dir — pure aggregation.
 *
 * Idempotent: re-running with fresh verdicts re-finalizes the same run (e.g.
 * after re-judging). The verdicts' judge identity (model + prompt hash) is
 * recorded into the manifest as the cross-judge guard's key.
 */
export const runScore = async (argv: readonly string[]): Promise<void> => {
  const { positionals, flags } = parseArgv(argv);
  if (positionals.includes("--help") || positionals.length < 1) {
    process.stderr.write(SCORE_HELP);
    if (positionals.length < 1) throw new UsageError("Missing <run_dir>");
    return;
  }
  await bootstrap(flags);

  const run_dir = resolve(positionals[0]!);
  const verdictsArg = flagString(flags, "verdicts");
  if (verdictsArg === undefined) {
    throw new UsageError("Missing --verdicts <file>.\n\n" + SCORE_HELP);
  }

  const resultsPath = join(run_dir, "results.json");
  const summaryPath = join(run_dir, "summary.md");
  const partial = (await readJson(resultsPath)) as ResultsFile;

  // Validate the agent-produced verdicts — it comes from out of process.
  const verdicts = VerdictsFileSchema.parse(await readJson(resolve(verdictsArg)));

  // Attribution guards — refuse to staple another run's verdicts onto this one.
  if (verdicts.run_id !== partial.run_id) {
    throw new UsageError(
      `verdicts.json is for run ${verdicts.run_id} but ${resultsPath} is run ${partial.run_id}.`,
    );
  }
  if (verdicts.fixture_id !== partial.fixture_id) {
    throw new UsageError(
      `verdicts.json fixture ${verdicts.fixture_id} ≠ run fixture ${partial.fixture_id}.`,
    );
  }
  // The judge must have run the SAME prompt the bench stamped, or the verdicts
  // aren't comparable to anything pinned under that prompt. Warn (don't abort):
  // the recorded provenance below is the source of truth for what actually judged.
  const stampedHash = partial.manifest.roles.judge.prompt_template_hash;
  if (stampedHash && verdicts.judge.prompt_template_hash !== stampedHash) {
    logger.warn("score.judge_prompt_mismatch", {
      run_stamped: stampedHash,
      verdicts_used: verdicts.judge.prompt_template_hash,
    });
  }
  if (partial.run_status !== "awaiting_verdicts") {
    logger.warn("score.unexpected_status", {
      run_status: partial.run_status,
      note: "scoring a run that was not awaiting_verdicts (re-score?)",
    });
  }

  const judge: JudgeProvenance = verdicts.judge;
  const completed_at = new Date().toISOString();
  const final = rescoreWithVerdicts({
    partial,
    verdicts: verdicts.verdicts,
    judge,
    run_status: "completed",
    completed_at,
  });

  await writeJsonAtomic(resultsPath, final);
  await writeFile(summaryPath, renderSummary(final), "utf-8");

  const unjudged = final.integrity.unjudged_pct;
  logger.info("score.complete", {
    run_id: final.run_id,
    judge_model: judge.model,
    verdicts: verdicts.verdicts.length,
    unjudged_pct: unjudged,
    reader_correct_pct: final.overall.micro.reader_correct_pct.point,
  });
  process.stderr.write(
    `Scored ${final.run_id} with ${verdicts.verdicts.length} verdicts (judge ${judge.model}). ` +
      `Reader-correct ${(final.overall.micro.reader_correct_pct.point * 100).toFixed(1)}%` +
      `${unjudged > 0 ? `, UNJUDGED ${(unjudged * 100).toFixed(1)}%` : ""}.\n` +
      `Wrote ${resultsPath} and ${summaryPath}\n`,
  );
};

const SCORE_HELP = `june-eval score — finalize an awaiting-verdicts run from external verdicts.

USAGE
  june-eval score <run_dir> --verdicts <verdicts.json> [--config <path>]

The run_dir must contain a partial results.json written by \`june-eval run
--judge external\` (run_status "awaiting_verdicts"). The verdicts.json is the
judge output produced by the Claude Code orchestrator's Sonnet agents — see
JUDGE-RUNNER.md. Overlays the verdicts, rewrites results.json + summary.md as a
completed run. No LLM is called.
`;
