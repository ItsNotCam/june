// author: Claude
import { ulid } from "ulid";
import { fileURLToPath } from "node:url";
import { logger } from "@/lib/logger";
import { startHeartbeat } from "@/lib/lock";
import { asRunId } from "@/types/ids";
import type { PipelineDeps } from "./factory";
import type { IngestionRun } from "@/types/run";
import type { RunId } from "@/types/ids";

/**
 * Reconciliation ([§27.5](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#275-reconcile-command-detailed)). A compliance / drift-cleanup pass:
 *
 *   1. Forward scan — soft-delete documents whose `source_uri` no longer
 *      exists on disk. `--purge` escalates to chunk hard-delete.
 *   2. Reverse scan — delete Qdrant points whose `chunk_id` has no matching
 *      SQLite row (orphans).
 *
 * Every action writes a `reconcile_events` row for audit.
 */

export type ReconcileOptions = {
  readonly deps: PipelineDeps;
  readonly dryRun: boolean;
  readonly purge: boolean;
};

export type ReconcileResult = {
  readonly run: IngestionRun;
  readonly softDeleted: number;
  readonly hardDeleted: number;
  readonly orphansDeleted: number;
};

const fsExists = async (path: string): Promise<boolean> => {
  try {
    const file = Bun.file(path);
    return await file.exists();
  } catch {
    return false;
  }
};

export const reconcile = async (opts: ReconcileOptions): Promise<ReconcileResult> => {
  const sidecar = opts.deps.storage.sidecar;
  const vector = opts.deps.storage.vector;
  const runId: RunId = asRunId(ulid());
  const startedAt = new Date().toISOString();

  await sidecar.acquireWriteLock(runId);
  const heartbeat = startHeartbeat(sidecar, runId);

  await sidecar.putRun({
    run_id: runId,
    started_at: startedAt,
    completed_at: undefined,
    trigger: "reconcile",
    doc_count: 0,
    chunk_count: 0,
    error_count: 0,
  });

  let softDeleted = 0;
  let hardDeleted = 0;
  let orphansDeleted = 0;

  try {
    const latest = await sidecar.listLatestDocuments();
    for (const doc of latest) {
      let fsPath: string;
      try {
        fsPath = fileURLToPath(doc.source_uri);
      } catch {
        continue;
      }
      if (await fsExists(fsPath)) continue;

      if (opts.dryRun) {
        await sidecar.recordReconcileEvent({
          run_id: runId,
          event_type: "dry_run_would_delete",
          doc_id: doc.doc_id,
          version: doc.version,
          chunk_id: undefined,
          source_uri: doc.source_uri,
          reason: "file_vanished",
          occurred_at: new Date().toISOString(),
        });
        continue;
      }

      const tx = await sidecar.begin();
      try {
        // Soft-delete every version row for this doc.
        const versions = await sidecar.listVersionsForDoc(doc.doc_id);
        const now = new Date().toISOString();
        for (const v of versions) {
          await sidecar.upsertDocument(tx, {
            ...v,
            deleted_at: now,
            status: "deleted",
          });
        }
        await sidecar.recordReconcileEvent({
          run_id: runId,
          event_type: "soft_delete_document",
          doc_id: doc.doc_id,
          version: doc.version,
          chunk_id: undefined,
          source_uri: doc.source_uri,
          reason: "file_vanished",
          occurred_at: now,
        });
        await tx.commit();
        softDeleted++;
      } catch (err) {
        await tx.rollback();
        throw err;
      }

      if (opts.purge) {
        // Delete chunks from Qdrant for both collections (we don't know up
        // front which the doc lives in).
        for (const coll of ["internal", "external"] as const) {
          await vector.deletePointsByDocId(coll, doc.doc_id);
        }
        await sidecar.recordReconcileEvent({
          run_id: runId,
          event_type: "hard_delete_chunks",
          doc_id: doc.doc_id,
          version: doc.version,
          chunk_id: undefined,
          source_uri: doc.source_uri,
          reason: "manual_purge",
          occurred_at: new Date().toISOString(),
        });
        hardDeleted++;
      }
    }

    // Reverse scan — orphan chunks in Qdrant.
    for (const coll of ["internal", "external"] as const) {
      for await (const batch of vector.scrollAllChunkIds(coll, 1000)) {
        for (const chunkId of batch) {
          const exists = await sidecar.chunkExistsInSidecar(chunkId);
          if (exists) continue;
          if (opts.dryRun) {
            await sidecar.recordReconcileEvent({
              run_id: runId,
              event_type: "dry_run_would_delete",
              doc_id: undefined,
              version: undefined,
              chunk_id: chunkId,
              source_uri: undefined,
              reason: "qdrant_orphan",
              occurred_at: new Date().toISOString(),
            });
            continue;
          }
          await vector.deletePointsByChunkIds(coll, [chunkId]);
          await sidecar.recordReconcileEvent({
            run_id: runId,
            event_type: "qdrant_orphan_deleted",
            doc_id: undefined,
            version: undefined,
            chunk_id: chunkId,
            source_uri: undefined,
            reason: "qdrant_orphan",
            occurred_at: new Date().toISOString(),
          });
          orphansDeleted++;
        }
      }
    }

    const completedAt = new Date().toISOString();
    await sidecar.updateRun(runId, {
      completed_at: completedAt,
      doc_count: softDeleted,
      chunk_count: hardDeleted + orphansDeleted,
    });
    logger.info("reconcile_complete", {
      event: "reconcile_complete",
      run_id: runId as string,
      count: softDeleted + hardDeleted + orphansDeleted,
    });
    return {
      run: {
        run_id: runId,
        started_at: startedAt,
        completed_at: completedAt,
        trigger: "reconcile",
        doc_count: softDeleted,
        chunk_count: hardDeleted + orphansDeleted,
        error_count: 0,
      },
      softDeleted,
      hardDeleted,
      orphansDeleted,
    };
  } finally {
    heartbeat.stop();
    await sidecar.releaseWriteLock(runId);
  }
};
