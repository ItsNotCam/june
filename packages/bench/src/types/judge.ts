// author: Claude
import type { Verdict } from "./verdict";

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
  judge: { provider: "anthropic-batch"; model: string; batch_api: true };
  batch: { batch_id: string; submitted_at: string; retrieved_at: string };
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
