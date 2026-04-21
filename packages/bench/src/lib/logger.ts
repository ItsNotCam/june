// author: Claude
import { createLogger, type Logger } from "@june/shared";

/**
 * Bench-specific log fields. Broader than mcp's `LogFields` because the
 * bench logs different telemetry (cost, batch ids, stage timings) — but
 * still a closed set so log consumers can key off known names.
 *
 * Not an I7-style content-safety boundary the way mcp's is: the bench writes
 * reader answers and judge rationales to `results.json`, not to logs. Add
 * fields here as new telemetry surfaces emerge.
 */
export type BenchLogFields = {
  fixture_id?: string;
  run_id?: string;
  ingest_run_id?: string;
  stage?: number | string;
  duration_ms?: number;
  query_count?: number;
  document_count?: number;
  total_retries?: number;
  leakage_warnings?: number;
  unresolved_pct?: number;
  embedding_pct?: number;
  unresolved?: number;
  resolved_substring?: number;
  resolved_embedding?: number;
  reader_verdicts?: number;
  baseline_verdicts?: number;
  unjudged?: number;
  unjudged_pct?: number;
  chunk_count?: number;
  embedding_model?: string;
  adapter?: string;
  atomic_count?: number;
  relational_count?: number;
  seed?: number;
  domain?: string;
  run_status?: string;
  run_dir?: string;
  total_cost_usd?: number;
  reader_answers?: number;
  baseline_answers?: number;
  batch_id?: string;
  request_count?: number;
  provider?: string;
  attempt?: number;
  delay_ms?: number;
  june_bin?: string;
  subcommand?: string;
  cwd?: string;
  line?: string;
  message?: string;
  name?: string;
  exit_code?: number;
  fixture_dir?: string;
};

/**
 * Lazy singleton. Import this — never `winston` directly. `setLogLevel` and
 * `setPrettyMode` are called by `cli/shared.ts` after env + config load;
 * tests can call them directly. Pretty mode wraps level in a colored emoji
 * prefix; JSON mode emits structured records for log aggregators.
 */
const handle = createLogger<BenchLogFields>();

export const logger = handle.logger;
export const setLogLevel = handle.setLogLevel;
export const setPrettyMode = handle.setPrettyMode;

export type { Logger };
