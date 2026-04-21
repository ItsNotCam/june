// author: Claude
import { createLogger, type Logger } from "@june/shared";

/**
 * Typed logger surface every module imports. Per I7 ([§26.2](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#262-the-type-level-content-block-per-i7)) the permitted
 * field set is closed — there is no `content`, `text`, `body`, `chunk`, or
 * `markdown` key. Adding a field requires editing `LogFields` (and passing PR
 * review on whether the new field could hold raw document content).
 *
 * Raw chunk/section/document markdown cannot reach the logger by construction.
 */
export type LogFields = {
  doc_id?: string;
  chunk_id?: string;
  section_id?: string;
  run_id?: string;
  stage?: string;
  count?: number;
  duration_ms?: number;
  error_type?: string;
  error_message?: string;
  field_names?: ReadonlyArray<string>;
  whitelist?: ReadonlyArray<string>;
  signal?: string;
  event?: string;
  status?: string;
  source_uri?: string;
  model_name?: string;
  model_version?: string;
  heartbeat_age_s?: number;
  attempt?: number;
  size_chars?: number;
  reason?: string;
  batch_size?: number;
  raw_preview?: string;
};

/**
 * Shared logger. Import this — not `winston` — everywhere in `src/`, `cli/`,
 * and `benchmark/`. The `LogFields` type forbids raw-content fields at the
 * type layer ([§26.2](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#262-the-type-level-content-block-per-i7) / I7).
 */
const handle = createLogger<LogFields>();

export const logger = handle.logger;
export const setLogLevel = handle.setLogLevel;
export const setPrettyMode = handle.setPrettyMode;

export type { Logger };
