import type { ErrorType } from "@/lib/error-types";
import type { ChunkId, DocId, RunId, Version } from "./ids";
import type { IngestStage, ReconcileEventType, ReconcileReason, RunTrigger } from "./vocab";

/**
 * One ingest / reconcile / re-embed invocation. A new row is inserted at run
 * start with `completed_at = null`; closed out with counts at run end.
 * Orphaned rows (completed_at still null after the run crashed) are observable
 * via `june status` ([§26.6](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#266-june-status-as-the-operator-front-door)).
 */
export type IngestionRun = {
  run_id: RunId;
  started_at: string;
  completed_at: string | undefined;
  trigger: RunTrigger;
  doc_count: number | undefined;
  chunk_count: number | undefined;
  error_count: number | undefined;
};

/**
 * Append-only failure audit row ([§10.4](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#ddl), [§25.5](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#255-offline-invariant-enforcement)). `error_message` must NEVER
 * contain raw chunk content (I7); short first-200-char previews of LLM output
 * are acceptable for debugging classifier drift.
 */
export type IngestionError = {
  id: number;
  run_id: RunId;
  doc_id: DocId | undefined;
  version: Version | undefined;
  chunk_id: ChunkId | undefined;
  stage: IngestStage;
  error_type: ErrorType;
  error_message: string;
  occurred_at: string;
};

/**
 * Append-only reconcile audit row ([§10.4](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#ddl), [§27.5](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#275-reconcile-command-detailed)). Distinct table from
 * `ingestion_errors` because compliance queries (which documents did we
 * delete?) are distinct from operational ones (which classifier retries?).
 */
export type ReconcileEvent = {
  id: number;
  run_id: RunId;
  event_type: ReconcileEventType;
  doc_id: DocId | undefined;
  version: Version | undefined;
  chunk_id: ChunkId | undefined;
  source_uri: string | undefined;
  reason: ReconcileReason;
  occurred_at: string;
};
