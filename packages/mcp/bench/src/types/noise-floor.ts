// author: Claude
import { z } from "zod";

/**
 * `noise-floor.json` — the MEASURED noise floor for one fixture (§ RSI Phase 2).
 *
 * The audit's gap #2 was a hand-typed `--noise-floor 0.05` guess: a wrong floor
 * compounds false accepts/rejects every RSI iteration. This artifact replaces
 * the guess with measurement. It carries two independent blocks, each produced
 * by its own `june-eval measure-*` command:
 *
 *  - `determinism` (`measure-noise-floor`): re-run retrieval N times against ONE
 *    frozen ingest and report the spread of recall@k/MRR. These are LLM-free, so
 *    the spread MUST be ≈0 — the command asserts it (a non-zero spread on a
 *    shared ingest is a real bug, e.g. an unstable RRF tie-break). This block is
 *    the *proof* that the retrieval metrics can be gated tightly.
 *  - `consistency` (`measure-consistency`): re-judge ONE run's tasks N times with
 *    the agents and report the spread of reader_correct_pct. The judge is the
 *    only non-deterministic stage, so this block is where a real (non-zero) floor
 *    comes from.
 *
 * `recommended_noise_floor` is the max spread observed across whichever blocks
 * are present — the conservative scalar `control-pin` stamps into the golden so
 * the regression gate trips only on a move larger than measured noise.
 */

/** On-disk mirror of `VarianceStats` (src/lib/variance.ts). */
const VarianceStatsSchema = z.object({
  n: z.number().int().nonnegative(),
  mean: z.number(),
  stddev: z.number(),
  min: z.number(),
  max: z.number(),
  range: z.number(),
});

/** metric label (e.g. `recall_at_5`) → its spread across the repeats. */
const TierVarianceSchema = z.record(z.string(), VarianceStatsSchema);
/** tier (e.g. `T1`) → per-metric spread. */
const PerTierVarianceSchema = z.record(z.string(), TierVarianceSchema);

/**
 * Determinism: retrieval recall@k/MRR spread across N retrieval re-runs.
 * `shared_ingest` is true when every source run reused the SAME june ingest —
 * the only configuration under which a ≈0 spread is *asserted* (fresh-ingest
 * repeats legitimately vary via summarizer non-determinism and are reported,
 * not asserted).
 */
const DeterminismBlockSchema = z.object({
  runs: z.number().int().positive(),
  source_run_ids: z.array(z.string()),
  ingest_run_ids: z.array(z.string()),
  shared_ingest: z.boolean(),
  per_tier: PerTierVarianceSchema,
  /** Max `range` over every gated retrieval metric × tier. ≈0 on a shared ingest. */
  max_drift: z.number().nonnegative(),
  /** Tolerance the assertion used; `max_drift <= epsilon` ⇒ deterministic. */
  epsilon: z.number().nonnegative(),
  deterministic: z.boolean(),
  measured_at: z.string(),
});
export type DeterminismBlock = z.infer<typeof DeterminismBlockSchema>;

/**
 * Consistency: reader_correct_pct spread across N independent re-judges of one
 * run's `judge_tasks.json`. `judge` is the identity all the verdict sets shared
 * (a re-judge under a different model/prompt is a different distribution — the
 * command refuses to mix them).
 */
const ConsistencyBlockSchema = z.object({
  runs: z.number().int().positive(),
  source_run_id: z.string(),
  source_verdicts: z.array(z.string()),
  judge: z.object({
    model: z.string(),
    prompt_template_hash: z.string(),
  }),
  per_tier: PerTierVarianceSchema,
  /** Max `range` of reader_correct_pct over every tier — the real noise floor. */
  max_drift: z.number().nonnegative(),
  measured_at: z.string(),
});
export type ConsistencyBlock = z.infer<typeof ConsistencyBlockSchema>;

export const NoiseFloorFileSchema = z.object({
  schema_version: z.literal(1),
  /** The fixture these measurements were taken on — `control-pin` cross-checks it. */
  fixture_hash: z.string(),
  determinism: DeterminismBlockSchema.nullable(),
  consistency: ConsistencyBlockSchema.nullable(),
  /** Max measured spread across present blocks — the floor `control-pin` consumes. */
  recommended_noise_floor: z.number().min(0).max(1),
});
export type NoiseFloorFile = z.infer<typeof NoiseFloorFileSchema>;

/**
 * Recomputes `recommended_noise_floor` from whichever blocks are present — the
 * conservative max so the floor covers both the retrieval and the judge spread.
 */
export const recommendedFloor = (file: {
  determinism: DeterminismBlock | null;
  consistency: ConsistencyBlock | null;
}): number =>
  Math.max(file.determinism?.max_drift ?? 0, file.consistency?.max_drift ?? 0);
