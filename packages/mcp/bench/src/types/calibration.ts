// author: Claude
/**
 * Judge calibration types (§ RSI Phase 5, audit "harden the single judge").
 *
 * A committed **gold set** of human-labeled `(judge task, canonical verdict)`
 * cases is the ground truth the LLM judge is measured against. `validate-judge`
 * emits the tasks (agents judge them, no API), then scores the agent verdicts vs
 * the human labels into a **calibration record** (Cohen's κ + agreement +
 * confusion). A judge identity (model + prompt hash) is "licensed" to certify a
 * run only when its record passes (κ ≥ threshold) against the CURRENT gold set —
 * `control-pin` enforces that precondition.
 */

import type { QueryTier } from "@/types/query";
import type { Verdict } from "@/types/verdict";

/** A verdict an agent can return — the 5 judge classes plus the bench's UNJUDGED fallback. */
export type AgentVerdict = Verdict; // "CORRECT"|"PARTIAL"|"INCORRECT"|"REFUSED"|"HALLUCINATED"|"UNJUDGED"

/**
 * One human-labeled gold case. Mirrors a `JudgeTask` (so it is judged by the
 * exact same agent path as a real run) plus the human label(s):
 * `human_verdict` is the canonical label κ is computed against;
 * `acceptable_verdicts` is the set a careful human would also accept (for the
 * lenient-agreement diagnostic — genuinely ambiguous cases carry more than one).
 */
export type GoldCase = {
  id: string;
  tier: QueryTier;
  query_text: string;
  expected_surface_hints: string[];
  retrieved_context: string;
  reader_answer: string;
  /** True for a no-RAG baseline-style case (empty retrieved_context). Default false. */
  is_baseline?: boolean;
  /** The canonical human verdict — one of the 5 judge classes (never UNJUDGED). */
  human_verdict: Verdict;
  /** Verdicts a careful human would accept (must include `human_verdict`). */
  acceptable_verdicts: Verdict[];
  /** Why this verdict — keeps the gold auditable. */
  rationale?: string;
  /** Who/what produced the label (e.g. "human", "orchestrator-construction"). */
  labeler?: string;
};

/** On-disk shape of the committed gold set. */
export type GoldSetFile = {
  schema_version: 1;
  description?: string;
  cases: GoldCase[];
};

/** Per-class breakdown — support (# gold cases with this canonical label) + exact agreements. */
export type ClassStat = { support: number; agree: number };

/**
 * The calibration record for one judge identity — written by `validate-judge
 * score`, consumed by the `control-pin` gate. Self-contained (carries the gold
 * hash + threshold) so it survives independently of any run.
 */
export type CalibrationRecord = {
  schema_version: 1;
  judge: { kind: string; model: string; prompt_template_hash: string };
  /** SHA-256 of the gold cases this κ was measured against — a stale gold invalidates the license. */
  gold_set_hash: string;
  /** Number of gold cases scored. */
  n: number;
  /** PRIMARY metric — Cohen's κ of agent verdicts vs canonical human verdicts. Gated. */
  cohens_kappa: number;
  /** Fraction where the agent's verdict exactly equals the canonical human verdict. */
  raw_agreement: number;
  /** Fraction where the agent's verdict is within the human's acceptable set (lenient). */
  lenient_agreement: number;
  /** The κ threshold this record was scored against (recorded so the gate reads `passed`). */
  min_kappa: number;
  /** κ ≥ min_kappa AND every gold case was judged (no UNJUDGED / missing). */
  passed: boolean;
  per_class: Partial<Record<Verdict, ClassStat>>;
  /** Confusion cells `{a: human, b: agent, count}` — off-diagonal = disagreements. */
  confusion: Array<{ a: string; b: string; count: number }>;
  judged_at: string;
  note?: string;
};

/** On-disk `judge-calibration.json` — a registry keyed by `${model}::${prompt_template_hash}`. */
export type CalibrationRegistry = Record<string, CalibrationRecord>;
