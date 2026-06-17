// author: Claude
import { resolve, join } from "path";
import { writeFile } from "fs/promises";
import { z } from "zod";
import type { MetricWithCi, ResultsFile } from "@/types/results";
import { QUERY_TIERS } from "@/types/query";
import { NoiseFloorFileSchema, type NoiseFloorFile } from "@/types/noise-floor";
import { readJson, fileExists } from "@/lib/artifacts";
import { UsageError, OperatorAbortError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { bootstrap, parseArgv, flagString } from "./shared";

/**
 * One committed golden baseline — a pinned `control` (gemma4:26b) run that
 * defines "expected results" for a single fixture. `control-check` fails any
 * later control run that *confidently* regresses a gated metric: the point
 * estimate must drop past the noise floor AND the candidate's 95% CI must not
 * overlap the golden's (so run-to-run noise alone can never trip the gate).
 *
 * What changed vs the v1 golden (which stored only per-tier correct% points and
 * compared raw deltas):
 *  - gates the DETERMINISTIC retrieval signal too (recall@1, recall@5, MRR), not
 *    just the reader+judge-bound correct% — an RSI loop optimizes retrieval.
 *  - stores each metric WITH its bootstrap CI and requires non-overlap, so the
 *    gate consults the statistics the bench already computes instead of ignoring
 *    them (the old gate could bank pure noise as a "win").
 *  - records the JUDGE IDENTITY (model + prompt hash) and refuses to compare a
 *    candidate judged differently — different judge ⇒ different verdict
 *    distribution ⇒ the threshold is uncalibrated (the cross-judge guard).
 *
 * Self-contained (stores the snapshot, not a run-dir reference) so it survives
 * state/ pruning.
 */
const GoldenMetricSchema = z.object({
  point: z.number(),
  ci_low: z.number(),
  ci_high: z.number(),
});

const GoldenTierSchema = z.object({
  query_count: z.number().int().nonnegative(),
  reader_correct_pct: GoldenMetricSchema,
  recall_at_1: GoldenMetricSchema,
  recall_at_5: GoldenMetricSchema,
  mrr: GoldenMetricSchema,
});
export type GoldenTier = z.infer<typeof GoldenTierSchema>;

const GoldenJudgeSchema = z.object({
  provider: z.string(),
  model: z.string(),
  prompt_template_hash: z.string(),
});

const GoldenEntrySchema = z.object({
  /** Bumped from the implicit v1 (per_tier_correct points + raw-delta gate). */
  schema_version: z.literal(2),
  run_id: z.string(),
  fixture_hash: z.string(),
  /** Max per-metric point drop tolerated as noise (Phase 2 derives this from a measured floor). */
  noise_floor: z.number().min(0).max(1),
  /** The judge that produced this golden's verdicts — the cross-judge guard's key. */
  judge: GoldenJudgeSchema,
  /** Per-tier metric snapshot (only tiers that had queries). */
  per_tier: z.record(z.string(), GoldenTierSchema),
  note: z.string().optional(),
});
export type GoldenEntry = z.infer<typeof GoldenEntrySchema>;

const GoldenRegistrySchema = z.record(z.string(), GoldenEntrySchema);
type GoldenRegistry = z.infer<typeof GoldenRegistrySchema>;

const GOLDEN_PATH = join(import.meta.dir, "..", "golden.json");
/** Default `noise-floor.json` location — package root, beside `golden.json`. Written by `measure-*`. */
export const DEFAULT_NOISE_FLOOR_PATH = join(import.meta.dir, "..", "noise-floor.json");

/**
 * The metrics the gate watches. `reader_correct_pct` is gated on every tier;
 * the retrieval metrics are skipped on T5 (negative queries have no recall).
 */
const GATED_METRICS = [
  { key: "reader_correct_pct", label: "correct%", retrievalOnly: false },
  { key: "recall_at_1", label: "recall@1", retrievalOnly: true },
  { key: "recall_at_5", label: "recall@5", retrievalOnly: true },
  { key: "mrr", label: "MRR", retrievalOnly: true },
] as const satisfies ReadonlyArray<{
  key: keyof Omit<GoldenTier, "query_count">;
  label: string;
  retrievalOnly: boolean;
}>;

/**
 * Reads the golden registry, tolerating legacy (v1) entries: each entry is
 * `safeParse`d independently so a v1 golden is SKIPPED (with a warning) rather
 * than throwing and bricking every fixture's gate. A skipped fixture reports
 * "no golden" → re-pin under the v2 schema.
 */
const loadRegistry = async (): Promise<GoldenRegistry> => {
  let raw: unknown;
  try {
    raw = await readJson(GOLDEN_PATH);
  } catch {
    return {};
  }
  if (typeof raw !== "object" || raw === null) return {};
  const out: GoldenRegistry = {};
  for (const [fixtureHash, entry] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = GoldenEntrySchema.safeParse(entry);
    if (parsed.success) {
      out[fixtureHash] = parsed.data;
    } else {
      logger.warn("control.golden_skipped_legacy", {
        fixture_hash: fixtureHash,
        note: "golden predates the v2 statistical gate — re-pin with control-pin",
      });
    }
  }
  return out;
};

const goldenMetric = (m: MetricWithCi): z.infer<typeof GoldenMetricSchema> => ({
  point: m.point,
  ci_low: m.ci_low,
  ci_high: m.ci_high,
});

/**
 * Extracts the gated per-tier metric snapshot from a results file — only tiers
 * that actually had queries (an empty tier carries degenerate zero-CIs that
 * would falsely "match" or "regress").
 */
export const perTierMetrics = (results: ResultsFile): Record<string, GoldenTier> => {
  const out: Record<string, GoldenTier> = {};
  for (const tier of QUERY_TIERS) {
    const t = results.per_tier[tier];
    if (t && t.query_count > 0) {
      out[tier] = {
        query_count: t.query_count,
        reader_correct_pct: goldenMetric(t.reader_correct_pct),
        recall_at_1: goldenMetric(t.recall_at_1),
        recall_at_5: goldenMetric(t.recall_at_5),
        mrr: goldenMetric(t.mrr),
      };
    }
  }
  return out;
};

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const pp = (x: number): string => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}pp`;

/**
 * Pure regression detector — the gate's core, exported for unit testing.
 *
 * A metric counts as regressed only when BOTH hold:
 *  1. the point estimate dropped more than `noise_floor` (a meaningful move), and
 *  2. the candidate's CI is entirely below the golden's (`ci_high < ci_low`) — a
 *     statistically confident drop, not run-to-run noise.
 * Requiring both means a noisy wobble never fails the gate, and a real
 * regression inside a wide CI is reported as a watch line but not a hard fail.
 */
export const detectRegressions = (
  golden: GoldenEntry,
  candidate: Record<string, GoldenTier>,
): { regressions: string[]; lines: string[] } => {
  const regressions: string[] = [];
  const lines: string[] = [];
  for (const tier of QUERY_TIERS) {
    const g = golden.per_tier[tier];
    const c = candidate[tier];
    if (!g || !c) continue;
    for (const metric of GATED_METRICS) {
      if (tier === "T5" && metric.retrievalOnly) continue;
      const gm = g[metric.key];
      const cm = c[metric.key];
      const delta = cm.point - gm.point;
      const beyondFloor = delta < -golden.noise_floor;
      const confident = cm.ci_high < gm.ci_low; // candidate's best case below golden's worst case
      const regressed = beyondFloor && confident;
      const detail =
        `${tier} ${metric.label}: ${pct(gm.point)} → ${pct(cm.point)} (Δ ${pp(delta)}; ` +
        `cand CI [${pct(cm.ci_low)}, ${pct(cm.ci_high)}] vs golden [${pct(gm.ci_low)}, ${pct(gm.ci_high)}])`;
      lines.push(`  ${detail}${regressed ? "  ✗ REGRESSION" : ""}`);
      if (regressed) regressions.push(detail);
    }
  }
  return { regressions, lines };
};

/**
 * Cross-judge guard. Returns a human message when the candidate's judge differs
 * from the golden's (model OR prompt hash) — those verdicts aren't comparable —
 * or `null` when they match.
 */
export const judgeMismatch = (
  golden: GoldenEntry["judge"],
  candidate: { model: string; prompt_template_hash: string },
): string | null => {
  if (golden.model !== candidate.model) {
    return `judge model differs: golden pinned with "${golden.model}", candidate used "${candidate.model}". Re-pin under the candidate's judge, or judge with the golden's model.`;
  }
  if (golden.prompt_template_hash !== candidate.prompt_template_hash) {
    return `judge PROMPT differs (golden ${golden.prompt_template_hash.slice(0, 12)}… vs candidate ${candidate.prompt_template_hash.slice(0, 12)}…). A changed judge prompt shifts the verdict distribution — re-pin the golden.`;
  }
  return null;
};

const assertControl = (results: ResultsFile, verb: string): void => {
  if (results.manifest.mode !== "control") {
    throw new UsageError(
      `${verb} requires a CONTROL run (gemma4:26b), but this run is mode="${results.manifest.mode}". ` +
        `Only --mode control runs are authoritative. See src/lib/modes.ts.`,
    );
  }
};

const assertCompleted = (results: ResultsFile, verb: string): void => {
  if (results.run_status !== "completed") {
    throw new UsageError(
      `${verb} requires a COMPLETED run, but run_status="${results.run_status}". ` +
        (results.run_status === "awaiting_verdicts"
          ? "Judge it and finalize with `june-eval score <run_dir> --verdicts <file>` first."
          : "This run aborted; re-run it."),
    );
  }
};

/**
 * Resolves the noise floor for `control-pin` from MEASUREMENT, not a guess
 * (Phase 2, the audit's gap #2). Order:
 *  1. `--accept-floor <0..1>` — an explicit, deliberately-flagged typed override
 *     ("I know this is unmeasured"). The only way to pin without a measured file.
 *  2. otherwise a measured `noise-floor.json` (`--noise-floor-file`, default the
 *     package-root file `measure-*` writes) whose `fixture_hash` matches this run
 *     AND whose `consistency` block is present (the gated correct% floor must be
 *     measured) — its `recommended_noise_floor` is used.
 * A bare run with neither is refused, with the commands to produce a floor.
 */
export const resolveNoiseFloor = async (
  flags: Record<string, string | boolean>,
  fixture_hash: string,
): Promise<{ noise_floor: number; source: string }> => {
  const acceptStr = flagString(flags, "accept-floor");
  if (acceptStr !== undefined) {
    const noise_floor = Number(acceptStr);
    if (!Number.isFinite(noise_floor) || noise_floor < 0 || noise_floor > 1) {
      throw new UsageError(`--accept-floor must be in [0,1]; got "${acceptStr}".`);
    }
    logger.warn("control.noise_floor_unmeasured", {
      noise_floor,
      note: "pinned with a typed --accept-floor, not a measured noise-floor.json",
    });
    return { noise_floor, source: `--accept-floor ${noise_floor} (UNMEASURED)` };
  }

  const filePath = resolve(flagString(flags, "noise-floor-file") ?? DEFAULT_NOISE_FLOOR_PATH);
  if (!(await fileExists(filePath))) {
    throw new UsageError(
      `control-pin needs a measured noise floor. No noise-floor.json at ${filePath}.\n` +
        `  Measure it: \`june-eval measure-noise-floor <run_dir...>\` (retrieval determinism) AND\n` +
        `             \`june-eval measure-consistency <run_dir> <verdicts.json...>\` (judge variance).\n` +
        `  Or override deliberately with \`--accept-floor <0..1>\` (records the floor as UNMEASURED).`,
    );
  }
  const parsed = NoiseFloorFileSchema.safeParse(await readJson(filePath));
  if (!parsed.success) {
    throw new UsageError(`control-pin: ${filePath} is not a valid noise-floor.json (${parsed.error.issues[0]?.message}).`);
  }
  const file: NoiseFloorFile = parsed.data;
  if (file.fixture_hash !== fixture_hash) {
    throw new UsageError(
      `control-pin: ${filePath} was measured on fixture ${file.fixture_hash}, but this run is fixture ${fixture_hash}. ` +
        `Re-measure the noise floor on this fixture.`,
    );
  }
  if (!file.consistency) {
    throw new UsageError(
      `control-pin: ${filePath} has no measured judge consistency (reader_correct_pct is gated, so its floor must be ` +
        `measured). Run \`june-eval measure-consistency ${"<run_dir> <verdicts.json...>"}\`, or override with --accept-floor.`,
    );
  }
  return {
    noise_floor: file.recommended_noise_floor,
    source: `measured ${filePath} (det ${file.determinism ? `${(file.determinism.max_drift * 100).toFixed(4)}pp` : "—"}, judge ${(file.consistency.max_drift * 100).toFixed(2)}pp)`,
  };
};

/**
 * `june-eval control-pin <run_dir>` — pins a control run as the golden baseline.
 * The noise floor comes from a MEASURED `noise-floor.json` (run
 * `measure-noise-floor` + `measure-consistency` first), or an explicit
 * `--accept-floor <0..1>` override — never a hidden default (Phase 2).
 */
export const runControlPin = async (argv: readonly string[]): Promise<void> => {
  const { positionals, flags } = parseArgv(argv);
  if (positionals.includes("--help") || positionals.length < 1) {
    process.stderr.write(CONTROL_PIN_HELP);
    if (positionals.length < 1) throw new UsageError("Missing <run_dir>");
    return;
  }
  await bootstrap(flags);
  const results = (await readJson(
    join(resolve(positionals[0]!), "results.json"),
  )) as ResultsFile;
  assertControl(results, "control-pin");
  assertCompleted(results, "control-pin");

  const { noise_floor, source } = await resolveNoiseFloor(flags, results.manifest.fixture_hash);

  const judge = results.manifest.roles.judge;
  const entry: GoldenEntry = {
    schema_version: 2,
    run_id: results.run_id,
    fixture_hash: results.manifest.fixture_hash,
    noise_floor,
    judge: {
      provider: judge.provider,
      model: judge.model,
      prompt_template_hash: judge.prompt_template_hash,
    },
    per_tier: perTierMetrics(results),
    note: "Pinned gemma4:26b control baseline — the bar for 'expected results'. See packages/mcp/bench/CLAUDE.md.",
  };
  const registry = await loadRegistry();
  registry[entry.fixture_hash] = entry;
  await writeFile(GOLDEN_PATH, `${JSON.stringify(registry, null, 2)}\n`, "utf-8");
  logger.info("control.pinned", {
    run_id: results.run_id,
    fixture_hash: entry.fixture_hash,
    judge_model: judge.model,
    noise_floor,
    noise_floor_source: source,
  });
  process.stderr.write(
    `Pinned golden for fixture ${entry.fixture_hash} = ${results.run_id} ` +
      `(noise_floor ${noise_floor.toFixed(4)} from ${source}, judge ${judge.model}). Wrote ${GOLDEN_PATH}\n`,
  );
};

/**
 * `june-eval control-check <run_dir>` — fails (exit 3) if a control run
 * confidently regresses any gated metric (correct%, recall@1, recall@5, MRR)
 * vs the golden: point drop beyond the noise floor AND non-overlapping CIs.
 */
export const runControlCheck = async (argv: readonly string[]): Promise<void> => {
  const { positionals, flags } = parseArgv(argv);
  if (positionals.includes("--help") || positionals.length < 1) {
    process.stderr.write(CONTROL_CHECK_HELP);
    if (positionals.length < 1) throw new UsageError("Missing <run_dir>");
    return;
  }
  await bootstrap(flags);
  const results = (await readJson(
    join(resolve(positionals[0]!), "results.json"),
  )) as ResultsFile;
  assertControl(results, "control-check");
  assertCompleted(results, "control-check");

  const registry = await loadRegistry();
  const golden = registry[results.manifest.fixture_hash];
  if (!golden) {
    process.stderr.write(
      `No golden baseline pinned for fixture ${results.manifest.fixture_hash} yet. Pin this run with:\n  june-eval control-pin ${positionals[0]}\n`,
    );
    return;
  }

  // Cross-judge guard — verdicts judged differently aren't comparable.
  const mismatch = judgeMismatch(golden.judge, {
    model: results.manifest.roles.judge.model,
    prompt_template_hash: results.manifest.roles.judge.prompt_template_hash,
  });
  if (mismatch) {
    throw new UsageError(`control-check ABORTED — ${mismatch}`);
  }

  const candidate = perTierMetrics(results);
  const { regressions, lines } = detectRegressions(golden, candidate);
  process.stderr.write(
    `control-check: ${results.run_id} vs golden ${golden.run_id} ` +
      `(noise floor ${(golden.noise_floor * 100).toFixed(1)}pp, judge ${golden.judge.model})\n${lines.join("\n")}\n`,
  );
  if (regressions.length > 0) {
    throw new OperatorAbortError(
      `control-check FAILED — ${regressions.length} metric(s) confidently regressed (point past floor AND non-overlapping CI):\n  ${regressions.join("\n  ")}`,
    );
  }
  process.stderr.write(`control-check PASSED — no gated metric confidently regressed.\n`);
};

const CONTROL_PIN_HELP = `june-eval control-pin — pin a control run as the golden baseline.

USAGE
  june-eval control-pin <run_dir> [--noise-floor-file <path>] [--accept-floor <0..1>] [--config <path>]

Only a COMPLETED --mode control (gemma4:26b) run can be pinned. Records per-tier
correct% + recall@1/@5 + MRR (each with its CI) and the judge identity.

The noise floor is MEASURED, not guessed (Phase 2):
  --noise-floor-file <path>  a noise-floor.json from \`measure-noise-floor\` +
                             \`measure-consistency\`. Default: package-root
                             noise-floor.json. Must match this run's fixture and
                             carry a measured judge-consistency block.
  --accept-floor <0..1>      deliberate typed override when no measured file
                             exists — recorded as UNMEASURED in the logs.
A bare control-pin with neither is refused (it points you at the measure commands).
`;

const CONTROL_CHECK_HELP = `june-eval control-check — fail if a control run regresses vs the golden baseline.

USAGE
  june-eval control-check <run_dir> [--config <path>]

Exits non-zero if any gated metric (correct%, recall@1, recall@5, MRR) confidently
regresses: its point estimate drops more than the golden noise floor AND its 95%
CI does not overlap the golden's. Aborts if the candidate's judge (model or prompt
hash) differs from the golden's — those verdicts aren't comparable.
`;
