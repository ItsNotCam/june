// author: Claude

/**
 * Runs `fn` over `items` with at most `concurrency` calls in flight, preserving
 * input order in the returned array.
 *
 * Lightweight replacement for `p-limit` — no dependency, no queue class, just an
 * index counter that each worker advances. Use for independent async work (e.g.
 * per-chunk LLM calls) instead of a serial `for ... await`, which leaves the
 * provider idle between every round-trip.
 *
 * @param items - the inputs to process
 * @param concurrency - maximum number of in-flight calls (clamped to >= 1)
 * @param fn - async mapper; receives the item and its original index
 */
export const mapConcurrent = async <T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const out: R[] = new Array(items.length);
  let nextIdx = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const idx = nextIdx++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]!, idx);
    }
  };

  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    () => worker(),
  );
  await Promise.all(workers);
  return out;
};
