// author: Claude
/**
 * Runs `tasks` with at most `concurrency` in flight, preserving input order
 * in the output array.
 *
 * Lightweight replacement for `p-limit` — no dependency, no queue class, just
 * an index counter. Each worker pulls the next unstarted task until the
 * array is exhausted.
 */
export const mapConcurrent = async <T, R>(
  tasks: readonly T[],
  concurrency: number,
  fn: (task: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const out: R[] = new Array(tasks.length);
  let nextIdx = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const idx = nextIdx++;
      if (idx >= tasks.length) return;
      out[idx] = await fn(tasks[idx]!, idx);
    }
  };

  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, tasks.length)) },
    () => worker(),
  );
  await Promise.all(workers);
  return out;
};
