// author: Claude
import { resolve, join } from "path";
import type { ResultsFile } from "@/types/results";
import type { JudgeProvenance } from "@/types/judge-tasks";
import { QUERY_TIERS } from "@/types/query";
import {
  NoiseFloorFileSchema,
  recommendedFloor,
  type DeterminismBlock,
  type ConsistencyBlock,
  type NoiseFloorFile,
} from "@/types/noise-floor";
import { VerdictsFileSchema } from "@/schemas/verdict";
import { rescoreWithVerdicts } from "@/stages/09-score";
import { computeVariance, maxRange, type VarianceStats } from "@/lib/variance";
import { mapConcurrent } from "@/lib/concurrency";
import { readJson, writeJsonAtomic, fileExists } from "@/lib/artifacts";
import { UsageError, IntegrityViolationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { perTierMetrics, DEFAULT_NOISE_FLOOR_PATH, type GoldenTier } from "./control";
import { bootstrap, parseArgv, flagString } from "./shared";

/**
 * The measured noise floor (§ RSI Phase 2 — the audit's gap #2). Two commands
 * replace the hand-typed `--noise-floor` guess with measurement:
 *
 *  - `measure-noise-floor <run_dir...>` — DETERMINISM. Reads N control runs of
 *    one fixture (ideally sharing ONE ingest via `--skip-ingest`) and reports the
 *    recall@k/MRR spread. Retrieval is LLM-free, so on a shared ingest the spread
 *    MUST be ≈0 — it ASSERTS this and fails loudly otherwise (a non-zero spread
 *    is a real determinism bug, e.g. an unstable RRF tie-break).
 *  - `measure-consistency <run_dir> <verdicts.json...>` — CONSISTENCY. Re-scores
 *    one run under N independent agent re-judges of its tasks and reports the
 *    reader_correct_pct spread — the judge is the only non-deterministic stage,
 *    so this is where a real floor comes from.
 *
 * Both write/update `noise-floor.json` (one block each); `control-pin` consumes
 * its `recommended_noise_floor`. The live N-run execution needs the local stack
 * (Qdrant + Ollama gemma, and the orchestrator's agents) — these commands are
 * the pure-aggregation half that turns those runs into a floor.
 */

/** Float slack for the determinism assertion — retrieval points should be bit-identical. */
const DEFAULT_EPSILON = 1e-9;

/** tier → metric label → spread across the repeats. */
type PerTierVariance = Record<string, Record<string, VarianceStats>>;

/** The retrieval signal whose determinism `measure-noise-floor` proves (T5 has no recall). */
const RETRIEVAL_METRICS = [
  { key: "recall_at_1", label: "recall_at_1" },
  { key: "recall_at_5", label: "recall_at_5" },
  { key: "mrr", label: "mrr" },
] as const satisfies ReadonlyArray<{ key: keyof Omit<GoldenTier, "query_count">; label: string }>;

/**
 * Gathers the per-tier/per-metric spread across N runs' metric snapshots.
 *
 * Each entry of `perRun` is one run's `perTierMetrics` output. A tier is
 * measured only when EVERY run carries it (so a sampled run that dropped a tier
 * can't silently shrink the sample). `retrievalOnly` metrics skip T5.
 */
export const gatherVariance = (
  perRun: ReadonlyArray<Record<string, GoldenTier>>,
  metrics: ReadonlyArray<{ key: keyof Omit<GoldenTier, "query_count">; label: string }>,
  opts: { retrievalOnly: boolean },
): { per_tier: PerTierVariance; max_drift: number } => {
  const per_tier: PerTierVariance = {};
  const allStats: VarianceStats[] = [];
  for (const tier of QUERY_TIERS) {
    if (opts.retrievalOnly && tier === "T5") continue;
    if (!perRun.every((r) => r[tier])) continue; // tier absent from ≥1 run
    const tierOut: Record<string, VarianceStats> = {};
    for (const metric of metrics) {
      const values = perRun.map((r) => r[tier]![metric.key].point);
      const stats = computeVariance(values);
      tierOut[metric.label] = stats;
      allStats.push(stats);
    }
    per_tier[tier] = tierOut;
  }
  return { per_tier, max_drift: maxRange(allStats) };
};

/**
 * Reads an existing `noise-floor.json` if it is valid AND for the same fixture,
 * so the sibling command's block is preserved on a read-modify-write. A
 * different fixture (or a malformed file) starts fresh — never mix fixtures.
 */
const loadExisting = async (
  path: string,
  fixture_hash: string,
): Promise<NoiseFloorFile | null> => {
  if (!(await fileExists(path))) return null;
  const parsed = NoiseFloorFileSchema.safeParse(await readJson(path));
  if (!parsed.success) return null;
  if (parsed.data.fixture_hash !== fixture_hash) {
    logger.warn("measure.noise_floor_fixture_changed", {
      existing: parsed.data.fixture_hash,
      current: fixture_hash,
      note: "noise-floor.json was for a different fixture — starting fresh",
    });
    return null;
  }
  return parsed.data;
};

const readResults = async (run_dir: string): Promise<ResultsFile> =>
  (await readJson(join(resolve(run_dir), "results.json"))) as ResultsFile;

/**
 * `june-eval measure-noise-floor <run_dir...> [--out <path>] [--epsilon <n>]`
 *
 * Determinism block. Pass ≥2 control run-dirs of the same fixture. Reports the
 * recall@k/MRR spread; asserts ≈0 when the runs share one ingest.
 */
export const runMeasureNoiseFloor = async (argv: readonly string[]): Promise<void> => {
  const { positionals, flags } = parseArgv(argv);
  if (positionals.includes("--help") || positionals.length < 1) {
    process.stderr.write(MEASURE_NOISE_FLOOR_HELP);
    if (positionals.length < 1) throw new UsageError("Missing <run_dir...>");
    return;
  }
  await bootstrap(flags);

  if (positionals.length < 2) {
    throw new UsageError(
      `measure-noise-floor needs ≥2 run-dirs to measure spread; got ${positionals.length}. ` +
        `Run control twice against ONE ingest (\`--skip-ingest <run_id>\`), then pass both run-dirs.`,
    );
  }
  const epsilonStr = flagString(flags, "epsilon");
  const epsilon = epsilonStr !== undefined ? Number(epsilonStr) : DEFAULT_EPSILON;
  if (!Number.isFinite(epsilon) || epsilon < 0) {
    throw new UsageError(`--epsilon must be a non-negative number; got "${epsilonStr}".`);
  }
  const out_path = resolve(flagString(flags, "out") ?? DEFAULT_NOISE_FLOOR_PATH);

  const runs = await mapConcurrent(positionals, 8, (dir) => readResults(dir));

  // Every run must be the same fixture — mixing fixtures' metrics is meaningless.
  const fixture_hash = runs[0]!.manifest.fixture_hash;
  for (const r of runs) {
    if (r.manifest.fixture_hash !== fixture_hash) {
      throw new UsageError(
        `measure-noise-floor: run ${r.run_id} is fixture ${r.manifest.fixture_hash} but ${runs[0]!.run_id} is ${fixture_hash}. ` +
          `A noise floor is per-fixture; measure one fixture at a time.`,
      );
    }
  }

  const ingest_run_ids = runs.map((r) => r.manifest.june.ingest_run_id);
  const shared_ingest = ingest_run_ids.every((id) => id === ingest_run_ids[0]);

  const perRun = runs.map((r) => perTierMetrics(r));
  const { per_tier, max_drift } = gatherVariance(perRun, RETRIEVAL_METRICS, {
    retrievalOnly: true,
  });

  const deterministic = max_drift <= epsilon;
  // The assertion: on a SHARED ingest retrieval is pure math, so any spread is a
  // real non-determinism bug (unstable tie-break, result-order churn). Fail loud.
  if (shared_ingest && !deterministic) {
    throw new IntegrityViolationError(
      `measure-noise-floor: retrieval is NOT deterministic across ${runs.length} runs sharing ingest ` +
        `${ingest_run_ids[0]} — max recall@k/MRR spread ${(max_drift * 100).toFixed(4)}pp > epsilon ` +
        `${epsilon}. Retrieval metrics are pure math; a non-zero spread on one ingest is a bug ` +
        `(e.g. an unstable RRF tie-break). Fix it before trusting any retrieval delta.`,
      0,
      0,
    );
  }

  const determinism: DeterminismBlock = {
    runs: runs.length,
    source_run_ids: runs.map((r) => r.run_id),
    ingest_run_ids,
    shared_ingest,
    per_tier,
    max_drift,
    epsilon,
    deterministic,
    measured_at: new Date().toISOString(),
  };

  const existing = await loadExisting(out_path, fixture_hash);
  const file: NoiseFloorFile = {
    schema_version: 1,
    fixture_hash,
    determinism,
    consistency: existing?.consistency ?? null,
    recommended_noise_floor: recommendedFloor({
      determinism,
      consistency: existing?.consistency ?? null,
    }),
  };
  await writeJsonAtomic(out_path, file);

  logger.info("measure.noise_floor.complete", {
    fixture_hash,
    runs: runs.length,
    shared_ingest,
    max_drift,
    deterministic,
    recommended_noise_floor: file.recommended_noise_floor,
  });
  process.stderr.write(
    `measure-noise-floor: ${runs.length} runs, fixture ${fixture_hash}` +
      ` (${shared_ingest ? "shared ingest" : "fresh ingests"}).\n` +
      `  retrieval spread (max range): ${(max_drift * 100).toFixed(4)}pp — ` +
      `${deterministic ? "DETERMINISTIC ✓" : "NON-deterministic (fresh-ingest variance, not asserted)"}.\n` +
      `  recommended_noise_floor: ${file.recommended_noise_floor.toFixed(4)} ` +
      `(${file.consistency ? "incl. measured judge consistency" : "judge consistency NOT yet measured — run measure-consistency"}).\n` +
      `  Wrote ${out_path}\n`,
  );
};

/**
 * `june-eval measure-consistency <run_dir> <verdicts.json...> [--out <path>]`
 *
 * Consistency block. Pass one awaiting-verdicts/completed run-dir and ≥2
 * `verdicts.json` files — each an INDEPENDENT agent re-judge of that run's
 * `judge_tasks.json`. Reports the reader_correct_pct spread (the judge variance).
 */
export const runMeasureConsistency = async (argv: readonly string[]): Promise<void> => {
  const { positionals, flags } = parseArgv(argv);
  if (positionals.includes("--help") || positionals.length < 1) {
    process.stderr.write(MEASURE_CONSISTENCY_HELP);
    if (positionals.length < 1) throw new UsageError("Missing <run_dir> <verdicts.json...>");
    return;
  }
  await bootstrap(flags);

  const [run_dir, ...verdictPaths] = positionals;
  if (verdictPaths.length < 2) {
    throw new UsageError(
      `measure-consistency needs ≥2 verdicts.json files to measure spread; got ${verdictPaths.length}. ` +
        `Have the orchestrator judge the run's judge_tasks.json N times → N verdicts.json (see JUDGE-RUNNER.md).`,
    );
  }
  const out_path = resolve(flagString(flags, "out") ?? DEFAULT_NOISE_FLOOR_PATH);

  const partial = await readResults(run_dir!);
  const fixture_hash = partial.manifest.fixture_hash;

  // Load + validate every verdict set (they come from out of process).
  const verdictSets = await mapConcurrent(verdictPaths, 8, async (p) =>
    VerdictsFileSchema.parse(await readJson(resolve(p))),
  );

  // Attribution + cross-judge guards: every set must be THIS run, this fixture,
  // and the SAME judge identity — re-judges under a different model/prompt are a
  // different distribution and can't be pooled into one floor.
  const judge = verdictSets[0]!.judge;
  for (let i = 0; i < verdictSets.length; i++) {
    const v = verdictSets[i]!;
    const where = verdictPaths[i]!;
    if (v.run_id !== partial.run_id) {
      throw new UsageError(`${where}: verdicts are for run ${v.run_id}, not ${partial.run_id}.`);
    }
    if (v.fixture_id !== partial.fixture_id) {
      throw new UsageError(`${where}: fixture ${v.fixture_id} ≠ run fixture ${partial.fixture_id}.`);
    }
    if (v.judge.model !== judge.model || v.judge.prompt_template_hash !== judge.prompt_template_hash) {
      throw new UsageError(
        `${where}: judge identity differs (${v.judge.model}/${v.judge.prompt_template_hash.slice(0, 12)}… vs ` +
          `${judge.model}/${judge.prompt_template_hash.slice(0, 12)}…). Re-judges of one run must share a judge ` +
          `to measure that judge's consistency.`,
      );
    }
  }

  // Re-score the run under each verdict set (pure math) → per-tier correct%.
  const completed_at = new Date().toISOString();
  const perRun = verdictSets.map((v) => {
    const provenance: JudgeProvenance = v.judge;
    const scored = rescoreWithVerdicts({
      partial,
      verdicts: v.verdicts,
      judge: provenance,
      run_status: "completed",
      completed_at,
    });
    return perTierMetrics(scored);
  });

  const { per_tier, max_drift } = gatherVariance(
    perRun,
    [{ key: "reader_correct_pct", label: "reader_correct_pct" }],
    { retrievalOnly: false },
  );

  const consistency: ConsistencyBlock = {
    runs: verdictSets.length,
    source_run_id: partial.run_id,
    source_verdicts: verdictPaths.map((p) => resolve(p)),
    judge: { model: judge.model, prompt_template_hash: judge.prompt_template_hash },
    per_tier,
    max_drift,
    measured_at: completed_at,
  };

  const existing = await loadExisting(out_path, fixture_hash);
  const file: NoiseFloorFile = {
    schema_version: 1,
    fixture_hash,
    determinism: existing?.determinism ?? null,
    consistency,
    recommended_noise_floor: recommendedFloor({
      determinism: existing?.determinism ?? null,
      consistency,
    }),
  };
  await writeJsonAtomic(out_path, file);

  logger.info("measure.consistency.complete", {
    fixture_hash,
    run_id: partial.run_id,
    judges: verdictSets.length,
    judge_model: judge.model,
    max_drift,
    recommended_noise_floor: file.recommended_noise_floor,
  });
  process.stderr.write(
    `measure-consistency: ${verdictSets.length} re-judges of ${partial.run_id} (judge ${judge.model}).\n` +
      `  reader_correct% spread (max range): ${(max_drift * 100).toFixed(2)}pp — the judge noise floor.\n` +
      `  recommended_noise_floor: ${file.recommended_noise_floor.toFixed(4)}.\n` +
      `  Wrote ${out_path}\n`,
  );
};

const MEASURE_NOISE_FLOOR_HELP = `june-eval measure-noise-floor — measure retrieval DETERMINISM (the noise floor's retrieval half).

USAGE
  june-eval measure-noise-floor <run_dir...> [--out <path>] [--epsilon <n>] [--config <path>]

Pass ≥2 COMPLETED/awaiting-verdicts control run-dirs of the SAME fixture — ideally
runs that reused ONE ingest (\`june-eval run … --skip-ingest <run_id>\`). Reports the
per-tier recall@1/@5/MRR spread across the runs and writes the \`determinism\` block of
noise-floor.json. On a shared ingest retrieval is pure math, so the spread MUST be ≈0:
a larger spread FAILS (exit 3) as a real non-determinism bug. Default --out is the
package-root noise-floor.json that control-pin reads.
`;

const MEASURE_CONSISTENCY_HELP = `june-eval measure-consistency — measure judge CONSISTENCY (the noise floor's judge half).

USAGE
  june-eval measure-consistency <run_dir> <verdicts.json...> [--out <path>] [--config <path>]

Pass one run-dir and ≥2 verdicts.json files, each an INDEPENDENT re-judge of that run's
judge_tasks.json by the orchestrator's agents (same judge model + prompt — see
JUDGE-RUNNER.md). Re-scores the run under each and reports the per-tier reader_correct_pct
spread — the judge variance, which is the real noise floor. Writes the \`consistency\` block
of noise-floor.json and the conservative \`recommended_noise_floor\` control-pin consumes.
`;
