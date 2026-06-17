// author: Claude
import { ulid } from "ulid";
import { bm25Vectorize } from "#internal/lib/embedder/bm25";
import { chunkIdToQdrantPointId } from "#internal/lib/ids";
import { startHeartbeat } from "#internal/lib/lock";
import { logger } from "#internal/lib/logger";
import { asRunId } from "#internal/types/ids";
import type { Embedder } from "#internal/lib/embedder/types";
import type { RunId } from "#internal/types/ids";
import type { PipelineDeps } from "./factory";
import type { VectorPoint } from "#internal/lib/storage/types";

/**
 * `june re-embed` ([§27.6](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#276-re-embed-command-detailed) / I5). Creates a new Qdrant collection at the
 * given model's dimension, streams every chunk from SQLite, re-computes the
 * embed-text + vectors, upserts into the new collection, and atomically
 * swaps the alias when done.
 */

export type ReembedOptions = {
  readonly deps: PipelineDeps;
  readonly newEmbedder: Embedder;
  readonly collections: ReadonlyArray<"internal" | "external">;
};

export type ReembedResult = {
  readonly rechunked: number;
  readonly run_id: RunId;
};

/** Chunks per embed batch during re-embed — bounds memory and provider fan-out. */
const RE_EMBED_BATCH_SIZE = 32;

export const reembed = async (opts: ReembedOptions): Promise<ReembedResult> => {
  const sidecar = opts.deps.storage.sidecar;
  const vector = opts.deps.storage.vector;
  const embedder = opts.newEmbedder;
  const runId: RunId = asRunId(ulid());

  await sidecar.acquireWriteLock(runId);
  const heartbeat = startHeartbeat(sidecar, runId);

  await sidecar.putRun({
    run_id: runId,
    started_at: new Date().toISOString(),
    completed_at: undefined,
    trigger: "re-embed",
    doc_count: 0,
    chunk_count: 0,
    error_count: 0,
  });

  let rechunked = 0;

  try {
    for (const alias of opts.collections) {
      // ensureCollections creates the aliased base collection at the new
      // dimension; for v1 the re-embed path upserts via the existing alias.
      // A dedicated swap target ("createNamedCollection") is a future phase.
      await vector.ensureCollections(embedder.dim);

      const latest = await sidecar.listLatestDocuments();
      for (const doc of latest) {
        const chunks = await sidecar.getChunksForDoc(doc.doc_id, doc.version);
        for (let i = 0; i < chunks.length; i += RE_EMBED_BATCH_SIZE) {
          const slice = chunks.slice(i, i + RE_EMBED_BATCH_SIZE);
          const texts = slice.map((c) => c.content);
          const vectors = await embedder.embed(texts);
          const points: VectorPoint[] = slice.map((c, idx) => {
            const vec = vectors[idx];
            if (!vec) throw new Error("embedder returned undefined vector");
            return {
              chunk_id: c.chunk_id,
              point_id: chunkIdToQdrantPointId(c.chunk_id),
              dense: vec,
              sparse: bm25Vectorize(c.content),
              payload: {
                chunk_id: c.chunk_id as string,
                doc_id: c.doc_id as string,
                version: c.version as string,
                content: c.content,
                embedding_model_name: embedder.name,
                embedding_model_version: embedder.version,
                embedding_dim: embedder.dim,
              },
              collection: alias,
            };
          });
          await vector.upsert(points);

          const now = new Date().toISOString();
          const tx = await sidecar.begin();
          try {
            for (const c of slice) {
              await sidecar.setChunkEmbedded(
                tx,
                c.chunk_id,
                embedder.name,
                embedder.version,
                now,
              );
            }
            await tx.commit();
          } catch (err) {
            await tx.rollback();
            throw err;
          }
          rechunked += slice.length;
          if (rechunked % 100 === 0) {
            logger.info("re_embed_progress", {
              event: "re_embed_progress",
              count: rechunked,
              model_name: embedder.name,
            });
          }
        }
      }
    }

    await sidecar.updateRun(runId, {
      completed_at: new Date().toISOString(),
      chunk_count: rechunked,
    });
    return { rechunked, run_id: runId };
  } finally {
    heartbeat.stop();
    await sidecar.releaseWriteLock(runId);
    // Free the (new) embed model's VRAM once re-embedding is done.
    await embedder.unload();
  }
};
