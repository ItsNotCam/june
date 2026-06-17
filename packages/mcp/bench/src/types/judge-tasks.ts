// author: Claude
import type { QueryTier } from "./query";
import type { VerdictRecord } from "./judge";

/**
 * The externalized judge contract (§22, RSI re-architecture).
 *
 * The bench no longer calls an LLM judge. Instead it emits a self-contained
 * `judge_tasks.json` — everything an external judge (the Claude Code RSI
 * orchestrator's Sonnet sub-agents) needs to grade one reader answer WITHOUT
 * re-opening june.db or touching Qdrant — and later ingests a `verdicts.json`
 * produced by that judge. This keeps the bench a deterministic, zero-API
 * measurement instrument: the only LLM call in the eval path (correctness
 * judging) happens outside it.
 *
 * See `JUDGE-RUNNER.md` for the protocol the orchestrator follows.
 */

/**
 * One self-contained grading task. Mirrors the in-bench `JudgeRequest`
 * (`src/judge/types.ts`) plus the fields an out-of-process judge needs:
 * `is_baseline` and a stable `query_id` (baseline tasks carry the
 * `BASELINE_QUERY_PREFIX` so verdicts map back exactly as Stage 9 expects).
 */
export type JudgeTask = {
  /** Reader tasks use the bare query id; baseline tasks use `baseline_<id>`. */
  query_id: string;
  query_text: string;
  tier: QueryTier;
  /** The minimum facts the answer must convey (surface hints only — no chunk ids). */
  expected_facts: Array<{ surface_hint: string }>;
  reader_answer: string;
  /**
   * The retrieved chunk text the reader saw, PRE-RENDERED as `<chunk id="…">`
   * blocks (empty string for the no-RAG baseline pass). Pre-rendering is the
   * whole point: the external judge grades against this verbatim and never
   * needs database access.
   */
  retrieved_context: string;
  /** True for the no-RAG baseline pass; false for the RAG reader pass. */
  is_baseline: boolean;
};

/** On-disk shape of `judge_tasks.json` — the bench's hand-off to the judge. */
export type JudgeTasksFile = {
  fixture_id: string;
  run_id: string;
  schema_version: 1;
  /** The prompt template name the judge MUST run (e.g. `"judge"`). */
  prompt_template: string;
  /** SHA-256 of `prompts/<prompt_template>.md` — stamped into verdicts for the cross-judge guard. */
  prompt_template_hash: string;
  tasks: JudgeTask[];
};

/**
 * Identity of whatever produced a set of verdicts. The regression gate
 * (`control-check`) refuses to compare a candidate against a golden pinned
 * under a different judge identity — different model OR different prompt hash
 * means the verdict distribution is not comparable.
 */
export type JudgeProvenance = {
  /** `claude-code-agent` for the RSI path; the in-bench providers keep their own names. */
  kind: "claude-code-agent" | "anthropic-batch" | "deepseek";
  /** e.g. `claude-sonnet-4-6`. */
  model: string;
  /** SHA-256 of the judge prompt the verdicts were produced under. */
  prompt_template_hash: string;
  /** ISO-8601 timestamp the verdicts were finalized. */
  judged_at: string;
};

/**
 * On-disk shape of `verdicts.json` — the judge's reply, consumed by
 * `june-eval score`. `verdicts` carries reader AND baseline outcomes; baseline
 * verdicts keep the `BASELINE_QUERY_PREFIX` so Stage 9 splits the streams.
 */
export type VerdictsFile = {
  fixture_id: string;
  run_id: string;
  schema_version: 1;
  judge: JudgeProvenance;
  verdicts: VerdictRecord[];
};
