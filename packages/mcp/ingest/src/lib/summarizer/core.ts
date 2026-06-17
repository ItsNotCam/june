// author: Claude
import { z } from "zod";
import { logger } from "#internal/lib/logger";
import { DocumentOutlineSchema, type DocumentOutline } from "#internal/schemas/classifier";
import {
  buildFitsPrompt,
  buildLongDocChunkPrompt,
  buildLongDocOutlinePrompt,
} from "./prompt";
import type { Summarizer, SummarizerInput } from "./types";

/**
 * Transport-agnostic Stage 6 summarizer core ([§19](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#19-stage-6--contextual-summary-generation)).
 *
 * The two-pass orchestration, length/format validation ([§19.5](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#195-output-validation-and-bounds)), JSON
 * extraction, and deterministic fallback are identical across every backend
 * (Ollama, DeepSeek, Anthropic) — only the raw text generation differs. Each
 * backend supplies a `generate` closure (which owns its own retry/timeout) and
 * delegates everything else here, so the validation contract can never drift
 * between backends.
 */

/** Min/max bounds on a contextual summary ([§19.5](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#195-output-validation-and-bounds)). */
const MIN_SUMMARY_CHARS = 50;
const MAX_SUMMARY_CHARS = 1200;

/** Outline pass truncates very large documents before the prompt. */
const MAX_DOC_INPUT_CHARS = 60_000;

/**
 * Every backend is instructed to emit `{"summary": "..."}`. The structural
 * constraint is what stops the historical failure mode where the model echoed
 * prompt instructions instead of summarizing — echoes can't satisfy this shape.
 */
const ChunkSummaryJsonSchema = z.object({
  summary: z.string(),
});

/**
 * Generates raw model text for a built prompt. Implementations own their
 * transport, retry, and timeout; `jsonMode` lets a backend opt into a native
 * JSON-only decode mode (Ollama) — backends without one ignore it and rely on
 * the balanced-brace extraction below.
 */
export type GenerateFn = (prompt: string, jsonMode: boolean) => Promise<string>;

export type SummarizerCoreOptions = {
  readonly name: string;
  readonly version?: string;
  readonly generate: GenerateFn;
};

/**
 * Extracts the substring spanning the first balanced `{...}` object in `text`,
 * skipping braces inside string literals. Returns null when the first `{` has
 * no matching close. Handles backends that wrap JSON in prose (Anthropic /
 * DeepSeek have no native JSON-only mode).
 */
const extractBalancedJsonObject = (text: string): string | null => {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
};

/**
 * Parses a JSON object out of raw model text, tolerating code fences and
 * trailing/leading prose. Returns null when no candidate parses.
 */
const extractJsonObject = (raw: string): unknown => {
  const trimmed = raw.trim();
  const candidates = [trimmed];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence && fence[1]) candidates.push(fence[1].trim());
  const balanced = extractBalancedJsonObject(trimmed);
  if (balanced) candidates.push(balanced);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next candidate
    }
  }
  return null;
};

/**
 * Extracts and trims the summary string from raw model output. Returns null
 * when the text isn't a `{"summary": string}` object — caller falls back.
 */
const extractSummary = (raw: string): string | null => {
  const json = extractJsonObject(raw);
  if (json === null) return null;
  const parsed = ChunkSummaryJsonSchema.safeParse(json);
  if (!parsed.success) return null;
  return parsed.data.summary.trim();
};

const validSummary = (s: string): boolean => {
  const trimmed = s.trim();
  if (trimmed.length < MIN_SUMMARY_CHARS) return false;
  if (trimmed.length > MAX_SUMMARY_CHARS) return false;
  // Reject JSON-looking, code-fenced, or heading-heavy outputs ([§19.5](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#195-output-validation-and-bounds)).
  if (/^[[{]/.test(trimmed)) return false;
  if (/^```/.test(trimmed)) return false;
  if (/^#+\s/m.test(trimmed)) return false;
  return true;
};

/**
 * Deterministic fallback summary per [§19.5](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#195-output-validation-and-bounds) — used when the
 * backend throws or produces no valid output. Preserves heading-path context
 * so retrieval still has a situating blurb.
 */
const fallbackSummary = (input: SummarizerInput): string => {
  const path = input.heading_path.join(" > ");
  const firstSentence =
    input.chunk_content.trim().split(/[.!?]\s/)[0]?.slice(0, 160) ?? "";
  return `This excerpt is from the section '${path}' of ${input.document_title}, covering ${firstSentence}.`;
};

/**
 * Builds a `Summarizer` from a backend-supplied `generate` closure. All
 * shared behaviour — prompt selection, JSON extraction, [§19.5](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#195-output-validation-and-bounds) validation,
 * and the heading-path fallback — lives here so every backend behaves
 * identically. Under deterministic decoding a same-prompt re-roll is identical,
 * so a single generate+extract then fallback is correct (the backend's own
 * retry handles transient/network errors).
 */
export const createSummarizerFromGenerate = (
  opts: SummarizerCoreOptions,
): Summarizer => {
  const { name, generate } = opts;
  const version = opts.version ?? "unknown";

  const summarizeChunk: Summarizer["summarizeChunk"] = async (input) => {
    const prompt =
      input.outline !== undefined
        ? await buildLongDocChunkPrompt({
            outline: input.outline,
            local_section: input.containing_text,
            chunk_content: input.chunk_content,
          })
        : await buildFitsPrompt({
            document_body: input.containing_text,
            chunk_content: input.chunk_content,
          });
    try {
      const raw = await generate(prompt, true);
      const summary = extractSummary(raw);
      if (summary !== null && validSummary(summary)) {
        return {
          chunk_id: input.chunk_id,
          contextual_summary: summary,
          used_long_doc_path: input.outline !== undefined,
        };
      }
    } catch (err) {
      logger.warn("summarizer_failure", {
        event: "summarizer_failure",
        chunk_id: input.chunk_id as string,
        error_type: err instanceof Error ? err.name : "unknown",
      });
    }
    return {
      chunk_id: input.chunk_id,
      contextual_summary: fallbackSummary(input),
      used_long_doc_path: input.outline !== undefined,
    };
  };

  const summarizeDocument: Summarizer["summarizeDocument"] = async (input) => {
    const truncated = input.document_body.slice(0, MAX_DOC_INPUT_CHARS);
    const prompt = await buildLongDocOutlinePrompt({
      document_body_truncated: truncated,
    });
    const raw = await generate(prompt, true);
    const json = extractJsonObject(raw);
    const parsed = DocumentOutlineSchema.safeParse(json);
    if (parsed.success) return parsed.data;
    // Graceful fallback: one-line outline derived from the title.
    return {
      title: input.document_title,
      purpose: "Outline generation failed; using title-only fallback.",
      sections: [{ heading_path: [input.document_title], one_line: "document" }],
    } as DocumentOutline;
  };

  return { name, version, summarizeChunk, summarizeDocument };
};

/** Exported for the deterministic core test. */
export const __test__ = {
  extractJsonObject,
  extractSummary,
  validSummary,
  fallbackSummary,
  MIN_SUMMARY_CHARS,
  MAX_SUMMARY_CHARS,
};
