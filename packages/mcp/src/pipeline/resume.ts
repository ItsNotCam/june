import { ulid } from "ulid";
import { logger } from "@/lib/logger";
import { startHeartbeat } from "@/lib/lock";
import { asRunId, asVersion } from "@/types/ids";
import { ingestPath } from "./ingest";
import type { Embedder } from "@/lib/embedder/types";
import type { ProgressReporter } from "@/lib/progress";
import type { RunId } from "@/types/ids";
import type { IngestionRun } from "@/types/run";
import type { PipelineDeps } from "./factory";

/**
 * Resume orchestrator ([§24](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#24-resume-semantics)). Walks every document whose status is not
 * terminal and re-ingests it from its `source_uri`. The pipeline's
 * idempotency guarantees (deterministic IDs, INSERT OR REPLACE, status-gated
 * UPDATEs) make per-stage replay safe — resume is effectively "call
 * `ingestPath` on each non-terminal document, trusting stage idempotency to
 * absorb the repetition."
 */

const TERMINAL: ReadonlySet<string> = new Set([
  "stored",
  "failed",
  "skipped_empty",
  "skipped_metadata_only",
  "deleted",
]);

export type ResumeOptions = {
  readonly deps: PipelineDeps;
  /**
   * Optional probe for the current embedding model. When provided, resume
   * performs the [§24.6](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#246-resume-across-embedding-model-changes) model-mismatch check before replaying documents.
   */
  readonly embedder?: Embedder;
  readonly progress?: ProgressReporter;
};

export type ResumeResult = {
  readonly run: IngestionRun;
  readonly resumed: number;
  readonly embedding_model_mismatch_count: number;
};

/**
 * [§24.6](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#246-resume-across-embedding-model-changes) — log a warning if chunks already embedded under a different model
 * exist in the sidecar. Resume does NOT automatically re-embed them; the
 * operator must run `june re-embed` explicitly.
 */
const checkEmbeddingModelMismatch = async (
  opts: ResumeOptions,
): Promise<number> => {
  if (!opts.embedder) return 0;
  const count = await opts.deps.storage.sidecar.countChunksWithDifferentEmbeddingModel(
    opts.embedder.name,
  );
  if (count > 0) {
    logger.warn("embedding_model_mismatch", {
      event: "embedding_model_mismatch",
      model_name: opts.embedder.name,
      count,
      error_type: "embedding_model_mismatch",
    });
    process.stderr.write(
      `june: warning — ${count} chunks were embedded with a different model. ` +
        `Run 'june re-embed --embedding-model ${opts.embedder.name}' to migrate.\n`,
    );
  }
  return count;
};

export const resumeRun = async (opts: ResumeOptions): Promise<ResumeResult> => {
  const sidecar = opts.deps.storage.sidecar;
  const runId: RunId = asRunId(ulid());
  const startedAt = new Date().toISOString();

  await sidecar.acquireWriteLock(runId);
  const heartbeat = startHeartbeat(sidecar, runId);

  const run: IngestionRun = {
    run_id: runId,
    started_at: startedAt,
    completed_at: undefined,
    trigger: "cli",
    doc_count: 0,
    chunk_count: 0,
    error_count: 0,
  };
  await sidecar.putRun(run);

  let resumed = 0;
  const mismatch = await checkEmbeddingModelMismatch(opts);
  try {
    const latest = await sidecar.listLatestDocuments();
    const inFlight = latest.filter((d) => !TERMINAL.has(d.status));
    // Release the lock before the per-doc ingest invocations; they each
    // acquire the lock themselves. This keeps the resume orchestrator
    // lockless and avoids the "lock held by own runId" self-block.
    heartbeat.stop();
    await sidecar.releaseWriteLock(runId);

    for (const doc of inFlight) {
      try {
        // `ingestPath` by source_uri resolves the existing doc via Stage 1
        // and continues from the right status.
        const fsPath = new URL(doc.source_uri).pathname;
        await ingestPath({
          path: fsPath,
          deps: opts.deps,
          cliVersion: asVersion(doc.version as string),
          trigger: "cli",
          ...(opts.progress ? { progress: opts.progress } : {}),
        });
        resumed++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("resume_doc_failed", {
          event: "resume_doc_failed",
          doc_id: doc.doc_id as string,
          source_uri: doc.source_uri,
          error_message: message,
        });
      }
    }

    const completedAt = new Date().toISOString();
    await sidecar.updateRun(runId, {
      completed_at: completedAt,
      doc_count: resumed,
    });
    return {
      run: { ...run, completed_at: completedAt, doc_count: resumed },
      resumed,
      embedding_model_mismatch_count: mismatch,
    };
  } finally {
    // Ensure we don't leave state dangling even on failure paths above.
    try {
      heartbeat.stop();
    } catch {
      // stopping an already-stopped heartbeat is fine
    }
  }
};
