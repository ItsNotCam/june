// author: Claude
import { ulid } from "ulid";
import { logger } from "@/lib/logger";
import { startHeartbeat } from "@/lib/lock";
import { asRunId } from "@/types/ids";
import type { DocId, RunId } from "@/types/ids";
import type { PipelineDeps } from "./factory";

/**
 * Hard-delete the latest version (or every version with `allVersions=true`)
 * of a document ([§27.1](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#271-commands)). Removes Qdrant points + SQLite rows + writes a
 * `hard_delete_chunks` reconcile_events row.
 */

export type PurgeOptions = {
  readonly deps: PipelineDeps;
  readonly doc_id: DocId;
  readonly allVersions: boolean;
};

export type PurgeResult = {
  readonly purgedVersions: number;
  readonly purgedChunks: number;
};

export const purge = async (opts: PurgeOptions): Promise<PurgeResult> => {
  const sidecar = opts.deps.storage.sidecar;
  const vector = opts.deps.storage.vector;
  const runId: RunId = asRunId(ulid());

  await sidecar.acquireWriteLock(runId);
  const heartbeat = startHeartbeat(sidecar, runId);

  await sidecar.putRun({
    run_id: runId,
    started_at: new Date().toISOString(),
    completed_at: undefined,
    trigger: "cli",
    doc_count: 0,
    chunk_count: 0,
    error_count: 0,
  });

  let purgedVersions = 0;
  let purgedChunks = 0;

  try {
    const versions = await sidecar.listVersionsForDoc(opts.doc_id);
    const toPurge = opts.allVersions
      ? versions
      : versions.filter((v) => v.is_latest);

    for (const v of toPurge) {
      const chunks = await sidecar.getChunksForDoc(v.doc_id, v.version);
      for (const coll of ["internal", "external"] as const) {
        if (chunks.length === 0) continue;
        await vector.deletePointsByChunkIds(
          coll,
          chunks.map((c) => c.chunk_id),
        );
      }
      await sidecar.recordReconcileEvent({
        run_id: runId,
        event_type: "hard_delete_chunks",
        doc_id: v.doc_id,
        version: v.version,
        chunk_id: undefined,
        source_uri: v.source_uri,
        reason: "manual_purge",
        occurred_at: new Date().toISOString(),
      });
      purgedVersions++;
      purgedChunks += chunks.length;
    }

    await sidecar.updateRun(runId, {
      completed_at: new Date().toISOString(),
      doc_count: purgedVersions,
      chunk_count: purgedChunks,
    });
    logger.info("purge_complete", {
      event: "purge_complete",
      doc_id: opts.doc_id as string,
      count: purgedChunks,
    });
    return { purgedVersions, purgedChunks };
  } finally {
    heartbeat.stop();
    await sidecar.releaseWriteLock(runId);
  }
};
