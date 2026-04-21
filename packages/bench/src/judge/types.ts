// author: Claude
import type { Verdict } from "@/types/verdict";
import type { QueryTier } from "@/types/query";

/**
 * Per-query input to the judge (§35).
 *
 * The judge is tier-agnostic (see Appendix D.8); the tier is passed so the
 * prompt can mention it in the rubric, but the scoring layer — not the judge
 * — maps tier+verdict to "correct". T5+REFUSED is correct; that mapping
 * lives in Stage 9.
 */
export type JudgeRequest = {
  query_id: string;
  query_text: string;
  expected_facts: Array<{ surface_hint: string }>;
  reader_answer: string;
  tier: QueryTier;
};

/** Per-query output from the judge — one verdict per request. */
export type JudgeOutcome = {
  query_id: string;
  verdict: Verdict;
  rationale: string;
  /** Non-null only for `UNJUDGED` — what specifically failed (zod, parse, batch error). */
  unjudged_reason: string | null;
};

/**
 * The pluggable `Judge` interface (§35).
 *
 * `judge_all` takes every request and returns every outcome — the judge
 * implementation owns batching and async details. v1 ships `LLMJudge`
 * (Anthropic Batch). A v2 `ProgrammaticJudge` could short-circuit T1/T2
 * without calling the API at all.
 */
export type Judge = {
  name: string;
  judge_all: (requests: JudgeRequest[]) => Promise<JudgeOutcome[]>;
};
