// author: Claude
import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import type { SidecarStorage } from "@/lib/storage/types";
import type { RunId } from "@/types/ids";
import type { SummarizedChunk } from "./06-summarize";

/**
 * Stage 8 — Embed-Text Construction ([§21](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#21-stage-8--embed-text-construction)).
 *
 * Compose the single string fed to both the dense embedder and the sparse
 * BM25 tokenizer. Order: title, heading_path, contextual_summary, content
 * ([§21.1](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#211-the-composed-string)). Applies the protected-field truncation hierarchy when the total
 * exceeds `config.embedding.max_input_chars`.
 */

export type Stage8Input = {
  readonly chunks: ReadonlyArray<SummarizedChunk>;
  readonly sidecar: SidecarStorage;
  readonly runId: RunId;
};

export type EmbedReadyChunk = SummarizedChunk & { embed_text: string };

export type Stage8Result = {
  readonly chunks: ReadonlyArray<EmbedReadyChunk>;
};

const MAX_TITLE_CHARS = 100;
const MIN_HEADING_PATH_KEEP = 2;
const SUMMARY_HARD_CAP = 500;
const SUMMARY_FALLBACK_CAP = 200;

const truncateTitle = (title: string): string =>
  title.length <= MAX_TITLE_CHARS ? title : title.slice(0, MAX_TITLE_CHARS);

const truncateHeadingPath = (
  path: ReadonlyArray<string>,
  keep: number,
): ReadonlyArray<string> => {
  if (path.length <= keep) return path;
  return path.slice(path.length - keep);
};

const truncateSummaryAtSentence = (s: string, max: number): string => {
  if (s.length <= max) return s;
  const slice = s.slice(0, max);
  const lastStop = Math.max(
    slice.lastIndexOf("."),
    slice.lastIndexOf("!"),
    slice.lastIndexOf("?"),
  );
  if (lastStop > Math.floor(max / 2)) {
    return slice.slice(0, lastStop + 1);
  }
  return slice;
};

const truncateContent = (c: string, max: number): string => {
  if (c.length <= max) return c;
  const slice = c.slice(0, max);
  // Prefer a paragraph / sentence boundary within 200 chars of the cap.
  const windowStart = Math.max(0, slice.length - 200);
  const window = slice.slice(windowStart);
  const markers = [
    window.lastIndexOf("\n\n"),
    window.lastIndexOf("."),
    window.lastIndexOf("!"),
    window.lastIndexOf("?"),
  ];
  const rel = Math.max(...markers);
  if (rel > 0) return slice.slice(0, windowStart + rel + 1);
  return slice;
};

/** Compose one chunk's embed-text respecting the [§21.3](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#213-length-management) truncation hierarchy. */
export const composeEmbedText = (input: {
  document_title: string;
  heading_path: ReadonlyArray<string>;
  contextual_summary: string;
  content: string;
  maxChars: number;
}): { text: string; truncated: boolean } => {
  let title = input.document_title;
  let path = input.heading_path;
  let summary = input.contextual_summary.slice(0, SUMMARY_HARD_CAP);
  let content = input.content;

  const joinAll = (): string =>
    [title, path.join(" > "), summary, content]
      .map((s) => s ?? "")
      .join("\n\n");

  let text = joinAll();
  if (text.length <= input.maxChars) {
    return { text, truncated: false };
  }

  title = truncateTitle(title);
  text = joinAll();
  if (text.length <= input.maxChars) return { text: joinAll(), truncated: true };

  while (path.length > MIN_HEADING_PATH_KEEP && joinAll().length > input.maxChars) {
    path = truncateHeadingPath(path, path.length - 1);
  }
  text = joinAll();
  if (text.length <= input.maxChars) return { text, truncated: true };

  summary = truncateSummaryAtSentence(summary, SUMMARY_FALLBACK_CAP);
  text = joinAll();
  if (text.length <= input.maxChars) return { text, truncated: true };

  const fixedBytes =
    title.length + path.join(" > ").length + summary.length + 3 * 2; // three "\n\n"
  const contentBudget = Math.max(0, input.maxChars - fixedBytes);
  content = truncateContent(content, contentBudget);
  text = joinAll();
  return { text, truncated: true };
};

export const runStage8 = async (input: Stage8Input): Promise<Stage8Result> => {
  const cfg = getConfig();
  const maxChars = cfg.embedding.max_input_chars;
  const out: EmbedReadyChunk[] = [];
  for (const c of input.chunks) {
    const { text, truncated } = composeEmbedText({
      document_title: c.document_title,
      heading_path: c.heading_path,
      contextual_summary: c.contextual_summary,
      content: c.content,
      maxChars,
    });
    if (truncated) {
      logger.warn("embed_text_truncated", {
        event: "embed_text_truncated",
        chunk_id: c.chunk_id as string,
        size_chars: text.length,
      });
      await input.sidecar.recordError({
        run_id: input.runId,
        doc_id: c.doc_id,
        version: c.version,
        chunk_id: c.chunk_id,
        stage: "8",
        error_type: "embed_text_truncated",
        error_message: `truncated to ${text.length} chars`,
        occurred_at: new Date().toISOString(),
      });
    }
    out.push({ ...c, embed_text: text });
  }
  return { chunks: out };
};
