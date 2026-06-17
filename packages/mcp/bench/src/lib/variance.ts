// author: Claude
/**
 * Variance summary for a set of repeated measurements of one metric (§ RSI
 * Phase 2, the measured noise floor).
 *
 * The bench is non-deterministic in exactly one place now — the external judge
 * (agents, no `temperature=0` lever) — and provably deterministic everywhere
 * else (retrieval recall@k/MRR are pure math). To trust a delta we must *measure*
 * the noise instead of guessing it (the audit's gap #2: a hand-typed `0.05`
 * floor). This computes the per-metric spread across N repeats; `range`
 * (max − min) is the conservative noise floor — the worst run-to-run swing a
 * change must clear to count as real.
 */
export type VarianceStats = {
  /** Number of observations (repeats). */
  n: number;
  /** Arithmetic mean of the observations. */
  mean: number;
  /**
   * Sample standard deviation (Bessel's n−1 correction). 0 when n < 2 — a
   * single observation has no spread to estimate.
   */
  stddev: number;
  min: number;
  max: number;
  /**
   * `max − min` — the full observed spread. This is what feeds the noise
   * floor: a metric whose worst repeat differs from its best by `range` cannot
   * distinguish a real `range`-sized change from pure run-to-run noise.
   */
  range: number;
};

/**
 * Computes {@link VarianceStats} over `values`. Empty input yields all-zero
 * stats (n=0) rather than throwing — callers measuring a tier with no queries
 * get a benign zero contribution to the floor.
 */
export const computeVariance = (values: readonly number[]): VarianceStats => {
  const n = values.length;
  if (n === 0) {
    return { n: 0, mean: 0, stddev: 0, min: 0, max: 0, range: 0 };
  }
  let sum = 0;
  let min = values[0]!;
  let max = values[0]!;
  for (const v of values) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = sum / n;
  let sumSq = 0;
  for (const v of values) {
    const d = v - mean;
    sumSq += d * d;
  }
  // Sample (n−1) variance — we treat the N repeats as a sample of the
  // measurement's distribution, not the whole population.
  const stddev = n < 2 ? 0 : Math.sqrt(sumSq / (n - 1));
  return { n, mean, stddev, min, max, range: max - min };
};

/**
 * The largest `range` across many per-metric variance stats — the single
 * scalar noise floor for a measurement (gate every metric by its worst-spread
 * sibling). Returns 0 for an empty set.
 */
export const maxRange = (stats: Iterable<VarianceStats>): number => {
  let m = 0;
  for (const s of stats) {
    if (s.range > m) m = s.range;
  }
  return m;
};
