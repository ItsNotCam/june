// author: Claude
import { logger } from "@/lib/logger";
import {
  buildFallbackClassifierJson,
  filterTags,
  toChunkClassification,
} from "@/lib/classifier/fallback";
import type { Classifier } from "@/lib/classifier/types";
import type { SidecarStorage } from "@/lib/storage/types";
import type { ChunkClassification } from "@/types/chunk";
import type { RunId } from "@/types/ids";
import type { UnclassifiedChunk } from "@/types/pipeline";

/**
 * Stage 5 — Classifier pass ([§18](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#18-stage-5--classifier-pass-model-driven-metadata)).
 *
 * For each chunk, call the configured classifier; on failure, the classifier
 * impl itself returns fallback-populated output ([§18.6](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#186-failure-handling-and-fallbacks)) — Stage 5's job is
 * to merge `namespace` / `project` from the document's source binding and
 * record any `vocab_unknown_tag` drops to `ingestion_errors`.
 */

export type Stage5Input = {
  readonly chunks: ReadonlyArray<UnclassifiedChunk>;
  readonly classifier: Classifier;
  readonly sidecar: SidecarStorage;
  readonly runId: RunId;
  readonly binding: { namespace: string; project: string | undefined };
};

export type ClassifiedChunk = UnclassifiedChunk & {
  classification: ChunkClassification;
};

export type Stage5Result = {
  readonly chunks: ReadonlyArray<ClassifiedChunk>;
};

export const runStage5 = async (input: Stage5Input): Promise<Stage5Result> => {
  const out: ClassifiedChunk[] = [];
  for (let i = 0; i < input.chunks.length; i++) {
    const c = input.chunks[i]!;
    logger.debug("chunk_classify_start", {
      chunk_id: c.chunk_id as string,
      status: `${i + 1}/${input.chunks.length}`,
    });
    try {
      const result = await input.classifier.classify({
        chunk_id: c.chunk_id,
        chunk_content: c.content,
        document_title: c.document_title,
        heading_path: c.heading_path,
      });
      const classification: ChunkClassification = {
        ...result.classification,
        namespace: input.binding.namespace,
        project: input.binding.project,
      };
      // Audit dropped tags ([§18.5](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#185-vocab-filtering-for-tags)). `filterTags` re-runs here so we see the
      // pre-filter proposal; implementers of `Classifier` already drop them,
      // so in practice this is usually a no-op.
      const { dropped } = filterTags(result.classification.tags);
      if (dropped.length > 0) {
        await input.sidecar.recordError({
          run_id: input.runId,
          doc_id: c.doc_id,
          version: c.version,
          chunk_id: c.chunk_id,
          stage: "5",
          error_type: "vocab_unknown_tag",
          error_message: `dropped tags: ${dropped.join(", ")}`,
          occurred_at: new Date().toISOString(),
        });
      }
      logger.debug("chunk_classified", { chunk_id: c.chunk_id as string });
      out.push({ ...c, classification });
    } catch (err) {
      // [§18.6](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#186-failure-handling-and-fallbacks): classifier failure → fall back + advance chunk normally.
      // Even if a custom Classifier impl throws (contract violation), the
      // pipeline applies the configured fallback values. Full halt of the
      // doc only on catastrophic / unreachable-host failures, which bubble
      // up as exceptions from the orchestrator's transaction layer.
      const message = err instanceof Error ? err.message : String(err);
      logger.warn("classifier_fallback", {
        event: "classifier_fallback",
        chunk_id: c.chunk_id as string,
        error_type: "classifier_fallback",
        error_message: message.slice(0, 200),
      });
      await input.sidecar.recordError({
        run_id: input.runId,
        doc_id: c.doc_id,
        version: c.version,
        chunk_id: c.chunk_id,
        stage: "5",
        error_type: "classifier_fallback",
        error_message: message.slice(0, 200),
        occurred_at: new Date().toISOString(),
      });
      const classification: ChunkClassification = toChunkClassification(
        buildFallbackClassifierJson(),
        input.binding,
      );
      out.push({ ...c, classification });
    }
  }
  return { chunks: out };
};
