// author: Claude
import type { Verdict } from "./verdict";

/**
 * Namespacing prefix applied to baseline-answer `query_id`s so the judge can
 * grade reader and baseline streams in a single batch and Stage 9 can split
 * them back apart. Stage 8 prepends it; Stage 9 strips it.
 */
export const BASELINE_QUERY_PREFIX = "baseline_";

/** Per-query verdict recorded in `judge_results.json` (§22). */
export type VerdictRecord = {
  query_id: string;
  verdict: Verdict;
  rationale: string;
  /** Populated only when `verdict === "UNJUDGED"`. Captures the parse / batch-error reason. */
  unjudged_reason: string | null;
};

/** On-disk shape of `judge_results.json`. */
export type JudgeResultsFile = {
  fixture_id: string;
  judge: {
    provider: "anthropic-batch" | "deepseek";
    model: string;
    /** True for the Anthropic Batch path; false for the sync deepseek path. */
    batch_api: boolean;
  };
  /** Present only for the batch path — sync judging has no batch to track. */
  batch?: { batch_id: string; submitted_at: string; retrieved_at: string };
  verdicts: VerdictRecord[];
};

/** On-disk shape of `batch_submission.json` — the resume checkpoint for Stage 8b (§32). */
export type BatchSubmissionFile = {
  fixture_id: string;
  run_id: string;
  batch_id: string;
  submitted_at: string;
  /** Which logical stream each custom_id belongs to — "reader" or "baseline" per §23. */
  request_streams: { reader: string[]; baseline: string[] };
};
