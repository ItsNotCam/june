import { z } from "zod";
import { getConfig } from "@/lib/config";
import { getEnv } from "@/lib/env";
import {
  OllamaModelNotFoundError,
  OllamaTimeoutError,
} from "@/lib/errors";
import { logger } from "@/lib/logger";
import { sleepWithJitter } from "@/lib/retry";
import { DocumentOutlineSchema, type DocumentOutline } from "@/schemas/classifier";
import {
  buildFitsPrompt,
  buildLongDocChunkPrompt,
  buildLongDocOutlinePrompt,
} from "./prompt";
import type { Summarizer, SummarizerInput } from "./types";

/**
 * Ollama-backed summarizer ([§19](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#19-stage-6--contextual-summary-generation)). Same retry behavior as the classifier;
 * length / format validation per [§19.5](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#195-output-validation-and-bounds) with a deterministic heading-path
 * fallback.
 */

const GenerateResponseSchema = z.object({
  response: z.string(),
  done: z.boolean().optional(),
});

const MIN_SUMMARY_CHARS = 50;
const MAX_SUMMARY_CHARS = 1200;

const postWithTimeout = async (
  url: string,
  body: unknown,
  timeoutMs: number,
): Promise<Response> => {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new OllamaTimeoutError(url, timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

const generate = async (
  url: string,
  model: string,
  prompt: string,
  timeoutMs: number,
  jsonMode = false,
): Promise<string> => {
  const res = await postWithTimeout(
    `${url}/api/generate`,
    { model, prompt, stream: false, ...(jsonMode ? { format: "json" } : {}) },
    timeoutMs,
  );
  if (res.status === 404) throw new OllamaModelNotFoundError(model);
  if (!res.ok) throw new Error(`Ollama summarizer HTTP ${res.status}`);
  const json = await res.json().catch(() => null);
  const parsed = GenerateResponseSchema.safeParse(json);
  if (!parsed.success) return "";
  return parsed.data.response.trim();
};

const validSummary = (s: string): boolean => {
  const trimmed = s.trim();
  if (trimmed.length < MIN_SUMMARY_CHARS) return false;
  if (trimmed.length > MAX_SUMMARY_CHARS) return false;
  // Reject JSON-looking, code-fenced, or heading-heavy outputs ([§19.5](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#195-output-validation-and-bounds)).
  if (/^[\[{]/.test(trimmed)) return false;
  if (/^```/.test(trimmed)) return false;
  if (/^#+\s/m.test(trimmed)) return false;
  return true;
};

const fallbackSummary = (input: SummarizerInput): string => {
  const path = input.heading_path.join(" > ");
  const firstSentence = input.chunk_content
    .trim()
    .split(/[.!?]\s/)[0]
    ?.slice(0, 160) ?? "";
  return `This excerpt is from the section '${path}' of ${input.document_title}, covering ${firstSentence}.`;
};

const MAX_DOC_INPUT_CHARS = 60_000;

export const createOllamaSummarizer = (): Summarizer => {
  const env = getEnv();
  const model = env.OLLAMA_SUMMARIZER_MODEL;
  const state = { firstCallDone: false };

  const timeoutFor = (): number => {
    const cfg = getConfig();
    return state.firstCallDone
      ? cfg.ollama.summarizer_timeout_ms
      : cfg.ollama.first_call_timeout_ms;
  };

  const retryLoop = async <T>(
    label: string,
    attempt: () => Promise<T>,
  ): Promise<T> => {
    const cfg = getConfig();
    const attempts = cfg.ollama.summarizer_retry_max_attempts;
    const baseMs = cfg.ollama.retry.base_ms;
    let lastErr: unknown = null;
    for (let i = 1; i <= attempts; i++) {
      try {
        const res = await attempt();
        state.firstCallDone = true;
        return res;
      } catch (err) {
        if (err instanceof OllamaModelNotFoundError) throw err;
        lastErr = err;
        logger.warn("summarizer_retry", {
          event: "summarizer_retry",
          error_type: err instanceof Error ? err.name : "unknown",
          attempt: i,
          stage: label,
        });
        if (i < attempts) await sleepWithJitter(baseMs * 2 ** (i - 1));
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error(`summarizer exhausted retries`);
  };

  const summarizeChunk: Summarizer["summarizeChunk"] = async (input) => {
    const prompt =
      input.outline !== undefined
        ? buildLongDocChunkPrompt({
            outline: input.outline,
            local_section: input.containing_text,
            chunk_content: input.chunk_content,
          })
        : buildFitsPrompt({
            document_body: input.containing_text,
            chunk_content: input.chunk_content,
          });
    try {
      const raw = await retryLoop("chunk", () =>
        generate(env.OLLAMA_URL, model, prompt, timeoutFor()),
      );
      if (validSummary(raw)) {
        return {
          chunk_id: input.chunk_id,
          contextual_summary: raw.trim(),
          used_long_doc_path: input.outline !== undefined,
        };
      }
      // Try one stricter prompt before falling back ([§19.5](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#195-output-validation-and-bounds)).
      const stricter = prompt + "\n\nYour previous output was invalid; respond with at most 2 sentences.";
      const retry = await retryLoop("chunk-strict", () =>
        generate(env.OLLAMA_URL, model, stricter, timeoutFor()),
      );
      if (validSummary(retry)) {
        return {
          chunk_id: input.chunk_id,
          contextual_summary: retry.trim(),
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
    const prompt = buildLongDocOutlinePrompt({ document_body_truncated: truncated });
    const raw = await retryLoop("outline", () =>
      generate(env.OLLAMA_URL, model, prompt, timeoutFor(), true),
    );
    try {
      const json = JSON.parse(raw);
      return DocumentOutlineSchema.parse(json);
    } catch {
      // Graceful fallback: one-line outline derived from the title.
      return {
        title: input.document_title,
        purpose: "Outline generation failed; using title-only fallback.",
        sections: [{ heading_path: [input.document_title], one_line: "document" }],
      } as DocumentOutline;
    }
  };

  return {
    name: model,
    version: "unknown",
    summarizeChunk,
    summarizeDocument,
  };
};
