// author: Claude
/**
 * Query tier. Each tier probes a different retrieval + reading capability;
 * scoring rules are tier-dispatched (§13, §23).
 *
 * - T1 lexical — content words overlap heavily with the surface hint.
 * - T2 paraphrase — same fact, different vocabulary.
 * - T3 conceptual — scenario frame; retriever must infer the fact.
 * - T4 multi-hop — two facts chained; top-K must contain BOTH.
 * - T5 negative — no fact exists; correct behavior is refusal.
 * - T6 three-hop — three facts chained (2 relational + 1 atomic); top-K must contain ALL.
 * - T7 four-hop — four facts chained (3 relational + 1 atomic); top-K must contain ALL.
 */
export type QueryTier = "T1" | "T2" | "T3" | "T4" | "T5" | "T6" | "T7";

/** All query tiers in canonical order — the single source for tier iteration. */
export const QUERY_TIERS: readonly QueryTier[] = ["T1", "T2", "T3", "T4", "T5", "T6", "T7"];

/**
 * Tiers whose recall requires ALL expected chunks in top-K (multi-hop composition):
 * T4 (2-hop), T6 (3-hop), T7 (4-hop). Single-fact tiers (T1-T3) need only one chunk and
 * T5 (negative) has none — so scoring dispatch keys on this set rather than on `=== "T4"`.
 */
export const MULTI_HOP_TIERS: readonly QueryTier[] = ["T4", "T6", "T7"];
export const isMultiHopTier = (tier: QueryTier): boolean => MULTI_HOP_TIERS.includes(tier);

/**
 * Canonical query record — the shape that lives in `queries.json`.
 *
 * Per-tier LLM outputs are reshaped into this shape in Stage 3 (§17); the
 * reshape is load-bearing because the LLM doesn't see the canonical tier
 * string in its prompt.
 */
export type Query = {
  id: string;
  tier: QueryTier;
  text: string;
  /**
   * Facts this query expects in top-K.
   *
   * - T1 / T2 — exactly one id.
   * - T3 — one or more (the "any" scoring rule applies; §13).
   * - T4 — exactly two ids (the "all" scoring rule applies; §13).
   * - T6 / T7 — three / four ids (the "all" scoring rule; multi-hop chains).
   * - T5 — empty (no answer exists in the fixture).
   */
  expected_fact_ids: string[];
  /**
   * Jaccard content-word overlap with the expected facts' surface hints (§12).
   *
   * - T1 — null (lexical overlap is the point).
   * - T5 — null (no expected fact to compare against).
   * - T2 / T3 / T4 — number in [0, 1]; queries above the configured threshold
   *   are regenerated up to max_retries.
   */
  anti_leakage_score: number | null;
  /** 1 on a first-attempt accept, up to max_retries on anti-leakage retries (§17). */
  generation_attempts: number;
};

/** On-disk shape of `queries.json`. */
export type QueriesFile = {
  fixture_id: string;
  schema_version: 1;
  query_author: { provider: string; model: string };
  queries: Query[];
};
