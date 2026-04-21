// author: Claude
import { getConfig } from "@/lib/config";
import { bm25Vectorize, type SparseVector } from "@/lib/embedder/bm25";
import { logger } from "@/lib/logger";
import type { Embedder } from "@/lib/embedder/types";
import type { SidecarStorage, Tx } from "@/lib/storage/types";
import type { Document } from "@/types/document";
import type { RunId } from "@/types/ids";
import type { EmbedReadyChunk } from "./08-embed-text";

/**
 * Stage 9 — Embedding Generation ([§22](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#22-stage-9--embedding-generation)).
 *
 * Batches chunks through the `Embedder` for dense vectors; computes BM25
 * sparse vectors client-side from the same `embed_text`. Persists embedding
 * model identity + `embedded_at` and advances `chunks.status = 'embedded'`.
 */

export type Stage9Input = {
  readonly document: Document;
  readonly chunks: ReadonlyArray<EmbedReadyChunk>;
  readonly embedder: Embedder;
  readonly sidecar: SidecarStorage;
  readonly tx: Tx;
  readonly runId: RunId;
};

export type EmbeddedChunk = EmbedReadyChunk & {
  dense: ReadonlyArray<number>;
  sparse: SparseVector;
  embedding_model_name: string;
  embedding_model_version: string;
  embedding_dim: number;
  embedded_at: string;
};

export type Stage9Result = {
  readonly chunks: ReadonlyArray<EmbeddedChunk>;
};

const inBatches = <T>(items: ReadonlyArray<T>, n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) {
    out.push(items.slice(i, i + n) as T[]);
  }
  return out;
};

export const runStage9 = async (input: Stage9Input): Promise<Stage9Result> => {
  const cfg = getConfig();
  const batchSize = cfg.embedding.batch_size;
  const out: EmbeddedChunk[] = [];
  const batches = inBatches(input.chunks, batchSize);

  const now = new Date().toISOString();

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi]!;
    const texts = batch.map((c) => c.embed_text);
    logger.debug("embed_batch_start", {
      count: batch.length,
      status: `${bi + 1}/${batches.length}`,
    });
    let vectors: ReadonlyArray<ReadonlyArray<number>>;
    try {
      vectors = await input.embedder.embed(texts);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("embedder_error", {
        event: "embedder_error",
        doc_id: input.document.doc_id as string,
        batch_size: batch.length,
        error_message: message,
      });
      await input.sidecar.recordError({
        run_id: input.runId,
        doc_id: input.document.doc_id,
        version: input.document.version,
        chunk_id: undefined,
        stage: "9",
        error_type: "embedder_unreachable",
        error_message: message.slice(0, 200),
        occurred_at: new Date().toISOString(),
      });
      throw err;
    }
    for (let i = 0; i < batch.length; i++) {
      const chunk = batch[i]!;
      const vec = vectors[i];
      if (!vec) {
        throw new Error(
          `embedder returned undefined vector for chunk ${chunk.chunk_id as string}`,
        );
      }
      const sparse = bm25Vectorize(chunk.embed_text);
      await input.sidecar.setChunkEmbedded(
        input.tx,
        chunk.chunk_id,
        input.embedder.name,
        input.embedder.version,
        now,
      );
      out.push({
        ...chunk,
        dense: vec,
        sparse,
        embedding_model_name: input.embedder.name,
        embedding_model_version: input.embedder.version,
        embedding_dim: input.embedder.dim,
        embedded_at: now,
      });
    }
  }

  await input.sidecar.setDocumentStatus(
    input.tx,
    input.document.doc_id,
    input.document.version,
    "embedded",
  );

  logger.info("doc_embedded", {
    event: "doc_embedded",
    doc_id: input.document.doc_id as string,
    count: out.length,
    model_name: input.embedder.name,
  });

  return { chunks: out };
};
