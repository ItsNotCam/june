// author: Claude
/**
 * Canonical filenames a holdout run writes into its run-dir (§ RSI Phase 4).
 *
 * Kept in a tiny standalone module so `control.ts` can detect a holdout run-dir
 * (and refuse to pin/gate it) WITHOUT importing the holdout CLI — the structural
 * guarantee that a sealed holdout can never become a golden. A holdout writes
 * `holdout_results.json`, never the `results.json` that `control-*` consume.
 */
export const HOLDOUT_RESULTS_FILENAME = "holdout_results.json";
export const HOLDOUT_SUMMARY_FILENAME = "holdout_summary.md";
export const HOLDOUT_JUDGE_TASKS_FILENAME = "holdout_judge_tasks.json";
