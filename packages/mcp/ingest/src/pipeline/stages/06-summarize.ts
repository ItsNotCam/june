// author: Claude
import { getConfig } from "#internal/lib/config";
import { logger } from "#internal/lib/logger";
import { mapConcurrent } from "#internal/lib/concurrency";
import { approximateTokens } from "#internal/lib/tokenize";
import type { Summarizer } from "#internal/lib/summarizer/types";
import type { SidecarStorage, Tx } from "#internal/lib/storage/types";
import type { DocumentOutline } from "#internal/schemas/classifier";
import type { Document } from "#internal/types/document";
import type { RunId } from "#internal/types/ids";
import type { Section } from "#internal/types/section";
import type { UnclassifiedChunk } from "#internal/types/pipeline";

/**
 * Deterministic fallback summary per [§19.5](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#195-output-validation-and-bounds) — used when the summarizer impl
 * throws (contract violation) or produces no valid output. Preserves
 * heading-path context so retrieval still has a situating blurb.
 */
const buildFallbackSummary = (
  document_title: string,
  heading_path: ReadonlyArray<string>,
  content: string,
): string => {
  const path = heading_path.join(" > ");
  const firstSentence =
    content.trim().split(/[.!?]\s/)[0]?.slice(0, 160) ?? "";
  return `This excerpt is from the section '${path}' of ${document_title}, covering ${firstSentence}.`;
};

/**
 * Stage 6 — Contextual Summary Generation ([§19](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#19-stage-6--contextual-summary-generation)).
 *
 * For each chunk, produce a 50–150 token blurb that situates it in the
 * document. Below the long-doc threshold: single pass with the full body.
 * Above: two-pass (outline, then per-chunk prompt with outline + containing
 * section). Persists the summary to `chunks.contextual_summary` and advances
 * `chunks.status = 'contextualized'`.
 */

export type Stage6Input = {
  readonly document: Document;
  readonly body: string;
  readonly sections: ReadonlyArray<Section>;
  readonly chunks: ReadonlyArray<UnclassifiedChunk>;
  readonly summarizer: Summarizer;
  readonly sidecar: SidecarStorage;
  readonly tx: Tx;
  readonly runId: RunId;
};

export type SummarizedChunk = UnclassifiedChunk & { contextual_summary: string };

export type Stage6Result = {
  readonly chunks: ReadonlyArray<SummarizedChunk>;
};

const sectionIndex = (
  sections: ReadonlyArray<Section>,
): ReadonlyMap<string, Section> => {
  const m = new Map<string, Section>();
  for (const s of sections) m.set(s.section_id as string, s);
  return m;
};

export const runStage6 = async (input: Stage6Input): Promise<Stage6Result> => {
  const cfg = getConfig();
  const isLongDoc =
    approximateTokens(input.body) > cfg.summarizer.long_doc_threshold_tokens;

  let outline: DocumentOutline | undefined;
  if (isLongDoc) {
    try {
      outline = await input.summarizer.summarizeDocument({
        document_title: input.document.document_title,
        document_body: input.body,
      });
    } catch (err) {
      if (cfg.summarizer.on_failure === "error") {
        // No fallback — a degraded title-only outline would muddy a cert corpus.
        logger.error("summarizer_hard_failure", {
          event: "summarizer_hard_failure",
          doc_id: input.document.doc_id as string,
          error_message: (err instanceof Error ? err.message : String(err)).slice(0, 300),
        });
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      logger.warn("summarizer_outline_failed", {
        event: "summarizer_outline_failed",
        doc_id: input.document.doc_id as string,
        error_message: message,
      });
      await input.sidecar.recordError({
        run_id: input.runId,
        doc_id: input.document.doc_id,
        version: input.document.version,
        chunk_id: undefined,
        stage: "6",
        error_type: "summarizer_outline_failed",
        error_message: message,
        occurred_at: new Date().toISOString(),
      });
    }
  }

  const byId = sectionIndex(input.sections);

  // Phase 1 — generate summaries. The per-chunk calls are independent LLM
  // round-trips, so run them with bounded concurrency rather than serially;
  // a serial loop leaves the summarizer idle between every request. No sidecar
  // writes happen here — the shared `tx` is single-threaded and is only touched
  // in the serial Phase 2 below.
  type ChunkOutcome = {
    readonly chunk: UnclassifiedChunk;
    readonly summary: string;
    readonly fallback_error: string | undefined;
  };

  const outcomes = await mapConcurrent(
    input.chunks,
    cfg.summarizer.concurrency,
    async (c, i): Promise<ChunkOutcome> => {
      const parentSection = byId.get(c.section_id as string);
      const containing = isLongDoc
        ? (parentSection?.content ?? c.content)
        : input.body;
      logger.debug("chunk_summarize_start", {
        chunk_id: c.chunk_id as string,
        status: `${i + 1}/${input.chunks.length}`,
      });
      try {
        const result = await input.summarizer.summarizeChunk({
          chunk_id: c.chunk_id,
          chunk_content: c.content,
          document_title: c.document_title,
          heading_path: c.heading_path,
          containing_text: containing,
          outline,
        });
        logger.debug("chunk_summarized", { chunk_id: c.chunk_id as string });
        return { chunk: c, summary: result.contextual_summary, fallback_error: undefined };
      } catch (err) {
        // "error" mode: no fallback. A chunk that can't be summarized aborts the
        // whole ingest (cert/baseline cleanliness) — mapConcurrent uses
        // Promise.all, so this rejection propagates and stops Stage 6.
        if (cfg.summarizer.on_failure === "error") {
          logger.error("summarizer_hard_failure", {
            event: "summarizer_hard_failure",
            chunk_id: c.chunk_id as string,
            error_message: (err instanceof Error ? err.message : String(err)).slice(0, 300),
          });
          throw err;
        }
        // [§19.5](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#195-output-validation-and-bounds): summarizer failure → deterministic heading-path blurb.
        // Advance the chunk so the pipeline isn't blocked by a flaky impl.
        const message = err instanceof Error ? err.message : String(err);
        logger.warn("summarizer_fallback", {
          event: "summarizer_fallback",
          chunk_id: c.chunk_id as string,
          error_type: "summarizer_unreachable",
          error_message: message.slice(0, 200),
        });
        const fallback = buildFallbackSummary(
          c.document_title,
          c.heading_path,
          c.content,
        );
        return { chunk: c, summary: fallback, fallback_error: message.slice(0, 200) };
      }
    },
  );

  // Phase 2 — persist serially on the shared `tx`, preserving input order.
  const out: SummarizedChunk[] = [];
  for (const o of outcomes) {
    if (o.fallback_error !== undefined) {
      await input.sidecar.recordError({
        run_id: input.runId,
        doc_id: o.chunk.doc_id,
        version: o.chunk.version,
        chunk_id: o.chunk.chunk_id,
        stage: "6",
        error_type: "summarizer_unreachable",
        error_message: o.fallback_error,
        occurred_at: new Date().toISOString(),
      });
    }
    await input.sidecar.setChunkSummary(input.tx, o.chunk.chunk_id, o.summary);
    out.push({ ...o.chunk, contextual_summary: o.summary });
  }

  // Document-level status fires once every chunk has advanced.
  await input.sidecar.setDocumentStatus(
    input.tx,
    input.document.doc_id,
    input.document.version,
    "contextualized",
  );

  logger.info("doc_contextualized", {
    event: "doc_contextualized",
    doc_id: input.document.doc_id as string,
    count: out.length,
  });

  return { chunks: out };
};
