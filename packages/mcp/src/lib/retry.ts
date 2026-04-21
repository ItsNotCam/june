// author: Claude
/**
 * Exponential backoff with jitter ([§25.2](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#252-retry-policy)).
 *
 * Delay formula: `base * 2^attempt + random(0, 500)`. Returns a promise that
 * resolves after the computed wait. Callers implement the retry loop; this
 * module is deliberately just the wait.
 */
export const sleepWithJitter = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, ms + Math.floor(Math.random() * 500))));

/**
 * Compute the delay for attempt N (0-indexed) given a base (ms).
 * Exposed separately for tests.
 */
export const backoffDelayMs = (attempt: number, baseMs: number): number =>
  baseMs * 2 ** attempt;
