// author: Claude
import type { MetricWithCi } from "@/types/results";
import { getConfig } from "@/lib/config";
import { seededRng, seedFromString } from "@/lib/rng";

/** One per-query contribution to an aggregate — its numeric value and the query id for provenance. */
export type PerQueryValue = { query_id: string; value: number };

/**
 * Computes a point estimate and a 95% bootstrap CI for a metric whose per-
 * query values are supplied as bounded indicators (0/1 for recalls /
 * correctness) or floats (MRR) (Appendix G).
 *
 * Recipe: resample `values` with replacement `bootstrap_iterations` times,
 * take the mean of each resample, percentile-slice at `ci_percentiles`. This
 * is the right tool because the metrics are means of bounded indicators —
 * parametric CIs would either underestimate variance for small N or produce
 * intervals outside [0, 1].
 *
 * The seed is derived from the caller-supplied key (e.g.
 * `${run_id}:recall_at_5:T3`) so regenerating the report from `results.json`
 * reproduces the same CI — `report` is idempotent.
 */
export const computeBootstrapCi = (
  values: readonly PerQueryValue[],
  seedKey: string,
): MetricWithCi => {
  const cfg = getConfig().scoring;
  const n = values.length;

  if (n === 0) {
    return { point: 0, ci_low: 0, ci_high: 0, query_ids: [] };
  }

  const rng = seededRng(seedFromString(seedKey));
  const point = mean(values.map((v) => v.value));
  const resampledMeans: number[] = new Array(cfg.bootstrap_iterations);

  for (let i = 0; i < cfg.bootstrap_iterations; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      const idx = Math.floor(rng() * n);
      sum += values[idx]!.value;
    }
    resampledMeans[i] = sum / n;
  }

  resampledMeans.sort((a, b) => a - b);
  const [lowPct, highPct] = cfg.ci_percentiles;
  const lowIdx = clampIdx(
    Math.floor((lowPct / 100) * cfg.bootstrap_iterations),
    cfg.bootstrap_iterations,
  );
  const highIdx = clampIdx(
    Math.floor((highPct / 100) * cfg.bootstrap_iterations),
    cfg.bootstrap_iterations,
  );

  return {
    point,
    ci_low: resampledMeans[lowIdx]!,
    ci_high: resampledMeans[highIdx]!,
    query_ids: values.map((v) => v.query_id),
  };
};

const mean = (xs: readonly number[]): number => {
  if (xs.length === 0) return 0;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
};

const clampIdx = (idx: number, n: number): number =>
  Math.min(Math.max(idx, 0), n - 1);
