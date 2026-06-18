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
 * the balanced-brace extraction below. `attempt` (0-based) lets the validation
 * loop request a *different* sampling on a re-roll — Ollama offsets its seed by
 * it so a degenerate greedy loop on attempt 0 doesn't recur identically; other
 * backends may ignore it.
 */
export type GenerateFn = (
  prompt: string,
  jsonMode: boolean,
  attempt?: number,
) => Promise<string>;

/**
 * Max generate+validate attempts for one chunk before the template fallback.
 * Re-rolls use a varied seed (see GenerateFn.attempt) so a deterministic
 * degeneration on the first pass gets a genuinely different decode.
 */
const SUMMARY_VALIDATION_ATTEMPTS = 3;

export type SummarizerCoreOptions = {
  readonly name: string;
  readonly version?: string;
  readonly generate: GenerateFn;
  /**
   * Backend-supplied model eviction. Local backends (Ollama) inject a real
   * impl that frees VRAM; API backends omit it and get a no-op (no local model
   * to unload).
   */
  readonly unload?: () => Promise<void>;
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

/** Why a model summary was rejected — surfaced in the `summarizer_rejected` log. */
type SummaryRejection =
  | "too_short"
  | "too_long"
  | "leading_json"
  | "code_fence"
  | "heading_line";

type SummaryCheck = { ok: true } | { ok: false; reason: SummaryRejection };

/**
 * Validates a model summary against the [§19.5](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#195-output-validation-and-bounds) bounds, returning the
 * failing reason so the caller can log *why* a chunk fell back (the failure was
 * historically silent). Acceptance behaviour is unchanged from the prior boolean.
 */
const checkSummary = (s: string): SummaryCheck => {
  const trimmed = s.trim();
  if (trimmed.length < MIN_SUMMARY_CHARS) return { ok: false, reason: "too_short" };
  if (trimmed.length > MAX_SUMMARY_CHARS) return { ok: false, reason: "too_long" };
  // Reject JSON-looking, code-fenced, or heading-heavy outputs ([§19.5](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#195-output-validation-and-bounds)).
  if (/^[[{]/.test(trimmed)) return { ok: false, reason: "leading_json" };
  if (/^```/.test(trimmed)) return { ok: false, reason: "code_fence" };
  if (/^#+\s/m.test(trimmed)) return { ok: false, reason: "heading_line" };
  return { ok: true };
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
    for (let attempt = 0; attempt < SUMMARY_VALIDATION_ATTEMPTS; attempt++) {
      try {
        const raw = await generate(prompt, true, attempt);
        const summary = extractSummary(raw);
        if (summary === null) {
          // Generation succeeded but the output isn't a `{"summary": string}`
          // object (e.g. a degenerate repetition loop leaves the JSON unclosed).
          // Historically a SILENT fallback — log it and re-roll with a new seed.
          logger.warn("summarizer_rejected", {
            event: "summarizer_rejected",
            chunk_id: input.chunk_id as string,
            reason: "extract_null",
            attempt,
            raw_preview: raw.trim().slice(0, 200),
          });
          continue;
        }
        const check = checkSummary(summary);
        if (check.ok) {
          return {
            chunk_id: input.chunk_id,
            contextual_summary: summary,
            used_long_doc_path: input.outline !== undefined,
          };
        }
        // Parsed a summary but it failed §19.5 validation — also historically
        // silent. Snippet is the rejected summary itself (the useful artifact).
        logger.warn("summarizer_rejected", {
          event: "summarizer_rejected",
          chunk_id: input.chunk_id as string,
          reason: check.reason,
          attempt,
          raw_preview: summary.slice(0, 200),
        });
      } catch (err) {
        // Transport failure — the backend already retried timeouts internally,
        // so a re-roll won't help. Log and fall straight through to the template.
        logger.warn("summarizer_failure", {
          event: "summarizer_failure",
          chunk_id: input.chunk_id as string,
          error_type: err instanceof Error ? err.name : "unknown",
          attempt,
        });
        break;
      }
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

  return {
    name,
    version,
    summarizeChunk,
    summarizeDocument,
    unload: opts.unload ?? (async () => {}),
  };
};

/** Exported for the deterministic core test. */
export const __test__ = {
  extractJsonObject,
  extractSummary,
  checkSummary,
  fallbackSummary,
  MIN_SUMMARY_CHARS,
  MAX_SUMMARY_CHARS,
};
