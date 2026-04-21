// author: Claude
/**
 * Mulberry32 — a small, handwritten seeded PRNG (§15).
 *
 * No external dependency. Fact generation, fact-chain selection, bootstrap
 * resampling, and the "ten verdicts to eyeball" sampler all feed through here
 * so regenerating from the same seed produces byte-identical artifacts.
 *
 * Not cryptographic. Not a substitute for crypto.randomUUID(). The bench only
 * needs reproducible sequences.
 */
export type Rng = () => number;

/**
 * Returns a deterministic PRNG from a 32-bit integer seed.
 *
 * Calling the returned function yields a float in [0, 1). State is closed
 * over — each Rng carries its own progression.
 */
export const seededRng = (seed: number): Rng => {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * Derives a 32-bit seed from a string key via FNV-1a.
 *
 * Used by callers that want a deterministic PRNG keyed off something like
 * `${run_id}:${metric_name}` (Appendix G) or `fixture_hash + run_id`
 * (§30.2's "ten verdicts to eyeball").
 */
export const seedFromString = (key: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

/** Pops a random integer in `[0, n)` from the given Rng. */
export const randInt = (rng: Rng, n: number): number => Math.floor(rng() * n);

/**
 * Picks one element uniformly at random.
 *
 * Returns `undefined` only if the input array is empty — callers who pass a
 * non-empty array can safely narrow with a `!` assertion.
 */
export const pick = <T>(rng: Rng, arr: readonly T[]): T | undefined => {
  if (arr.length === 0) return undefined;
  return arr[randInt(rng, arr.length)];
};

/**
 * Returns a new array shuffled in Fisher–Yates order using the given Rng.
 *
 * Does not mutate the input. Runs in O(n) time with one Rng draw per element.
 */
export const shuffle = <T>(rng: Rng, arr: readonly T[]): T[] => {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    const ai = out[i]!;
    const aj = out[j]!;
    out[i] = aj;
    out[j] = ai;
  }
  return out;
};
