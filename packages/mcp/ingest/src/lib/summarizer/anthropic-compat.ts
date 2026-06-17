// author: Claude
import Anthropic from "@anthropic-ai/sdk";
import { getConfig } from "#internal/lib/config";
import { getEnv } from "#internal/lib/env";
import { MissingSummarizerApiKeyError } from "#internal/lib/errors";
import { createSummarizerFromGenerate, type GenerateFn } from "./core";
import type { Summarizer } from "./types";

/**
 * Anthropic-Messages transport for the Stage 6 summarizer. Backs **both** the
 * `anthropic` (Claude) and `deepseek` backends — DeepSeek exposes an
 * Anthropic-compatible endpoint, so the only difference is the `baseURL`, model
 * id, and API key. All orchestration / validation / fallback lives in `./core`.
 *
 * Determinism: `temperature: 0` and thinking **disabled** (DeepSeek-v4 defaults
 * thinking on; greedy non-thinking decoding keeps summaries fast, cheap, and
 * reproducible, matching the Ollama backend's pinned decoding).
 */

/** DeepSeek's Anthropic-format endpoint (OpenAI-format would be the bare host). */
export const DEEPSEEK_ANTHROPIC_BASE_URL = "https://api.deepseek.com/anthropic";

/** Built-in SDK retries for 429 / 5xx / connection errors. */
const API_MAX_RETRIES = 3;

/**
 * Neither backend has a native JSON-only mode, so we steer via the system
 * prompt; the core's balanced-brace extractor recovers the object from any
 * stray prose. Mirrors the bench Anthropic provider.
 */
const JSON_SYSTEM =
  "Respond with a single JSON object and nothing else. No prose, no Markdown fences, no explanatory text before or after.";

type ContentBlock = { type: string; text?: string };

/**
 * Concatenates the `text` across all `{type: "text"}` blocks, ignoring any
 * non-text blocks (e.g. a stray thinking block) rather than including them.
 */
const extractText = (content: unknown): string => {
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const block of content as ContentBlock[]) {
    if (block.type === "text" && typeof block.text === "string") out += block.text;
  }
  return out;
};

export type ApiSummarizerOptions = {
  readonly apiKey: string;
  readonly model: string;
  readonly maxTokens: number;
  /** Omit for Anthropic's default endpoint; set for DeepSeek. */
  readonly baseURL?: string;
  /** Injectable transport for tests; defaults to the SDK's built-in fetch. */
  readonly fetch?: typeof fetch;
};

/**
 * Builds a summarizer over the Anthropic Messages API. The `generate` closure
 * sends a single deterministic request; the SDK's built-in retry covers
 * transient failures.
 */
export const createApiSummarizer = (opts: ApiSummarizerOptions): Summarizer => {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    baseURL: opts.baseURL,
    maxRetries: API_MAX_RETRIES,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });

  const generate: GenerateFn = async (prompt) => {
    const res = await client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens,
      temperature: 0,
      thinking: { type: "disabled" },
      system: JSON_SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
    return extractText(res.content);
  };

  return createSummarizerFromGenerate({ name: opts.model, generate });
};

/**
 * DeepSeek backend (`config.summarizer.implementation = "deepseek"`), default
 * model `deepseek-v4-flash`. Requires `DEEPSEEK_API_KEY`.
 */
export const createDeepseekSummarizer = (): Summarizer => {
  const env = getEnv();
  if (!env.DEEPSEEK_API_KEY) {
    throw new MissingSummarizerApiKeyError("deepseek", "DEEPSEEK_API_KEY");
  }
  const cfg = getConfig();
  return createApiSummarizer({
    apiKey: env.DEEPSEEK_API_KEY,
    baseURL: DEEPSEEK_ANTHROPIC_BASE_URL,
    model: cfg.summarizer.deepseek_model,
    maxTokens: cfg.summarizer.api_max_tokens,
  });
};

/**
 * Anthropic backend (`config.summarizer.implementation = "anthropic"`), default
 * model `claude-haiku-4-5`. Requires `ANTHROPIC_API_KEY`.
 */
export const createAnthropicSummarizer = (): Summarizer => {
  const env = getEnv();
  if (!env.ANTHROPIC_API_KEY) {
    throw new MissingSummarizerApiKeyError("anthropic", "ANTHROPIC_API_KEY");
  }
  const cfg = getConfig();
  return createApiSummarizer({
    apiKey: env.ANTHROPIC_API_KEY,
    model: cfg.summarizer.anthropic_model,
    maxTokens: cfg.summarizer.api_max_tokens,
  });
};
