// author: Claude
import { createHash } from "crypto";
import { mkdir } from "fs/promises";
import { join } from "path";
import type { LlmCallRequest, LlmCallResponse } from "@/providers/types";
import { fileExists, readJson, writeJsonAtomic } from "@/lib/artifacts";

/**
 * On-disk cache of LLM responses keyed by request content (§37 — local
 * iteration aid, opt-in via `caching.enabled`).
 *
 * Why this exists: re-running a bench iteration with the same reader/judge
 * inputs is common (debugging Stage 9 scoring, comparing retrieval tweaks
 * that don't change reader text, etc.). Without caching, every re-run pays
 * the Anthropic Batch judge cost (~$0.20 per 180-query run) and the wall-
 * clock submit/poll cost (~5 min). With caching, identical inputs hit a
 * disk read instead.
 *
 * Storage layout: `<root>/<provider>/<key>.json`. One file per request, so
 * inspection and selective eviction (`rm bench-cache/llm/anthropic/<hash>.json`)
 * are trivial. The cache is an iteration aid, NOT load-bearing — anything
 * stored here can be deleted at any time and the next run will repopulate it.
 *
 * The cache key is content-only: provider, model, system, messages, max_tokens,
 * temperature, response_format, disable_thinking. `custom_id` is deliberately
 * excluded from batch-request keys (it's an arbitrary routing tag, not part of
 * the model's input) — see `cacheKeyForBatchRequest`.
 */

export type CacheableRequest = {
  provider_name: string;
  model: string;
  system?: string;
  messages: ReadonlyArray<{ role: string; content: string }>;
  max_tokens: number;
  temperature: number;
  response_format?: "text" | "json";
  disable_thinking?: boolean;
};

export type CacheEntry = {
  schema_version: 1;
  cached_at: string;
  request_summary: {
    provider: string;
    model: string;
    max_tokens: number;
    temperature: number;
    first_user_chars: string;
  };
  response: {
    text: string;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    /**
     * The original `cost_usd` from the live call. Preserved for accounting —
     * the cache wrapper returns `cost_usd: 0` to the caller (the run didn't
     * pay for it), but the historical cost is here if needed.
     */
    original_cost_usd: number;
  };
};

/**
 * Computes a SHA-256 hex digest over the canonicalized request shape.
 *
 * Stability requirements:
 * - Field order must be canonical (we manually order in `serialize`) so the
 *   hash is stable across JS object insertion-order quirks.
 * - Optional fields default to deterministic placeholders, not absent, so
 *   `disable_thinking: undefined` and `disable_thinking: false` collide
 *   intentionally (the call itself behaves the same).
 */
export const cacheKeyFor = (req: CacheableRequest): string => {
  const canonical = serialize(req);
  return createHash("sha256").update(canonical).digest("hex");
};

const serialize = (req: CacheableRequest): string => {
  const obj = {
    provider_name: req.provider_name,
    model: req.model,
    max_tokens: req.max_tokens,
    temperature: req.temperature,
    response_format: req.response_format ?? "text",
    disable_thinking: req.disable_thinking === true,
    system: req.system ?? "",
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
  };
  return JSON.stringify(obj);
};

/**
 * Returns the cached entry for `key` under `provider`, or `null` if absent
 * or unreadable. Read failures (missing file, malformed JSON) are silent
 * misses — the cache is non-load-bearing.
 */
export const cacheRead = async (args: {
  cache_root: string;
  provider: string;
  key: string;
}): Promise<CacheEntry | null> => {
  const path = entryPath(args);
  if (!(await fileExists(path))) return null;
  try {
    return (await readJson(path)) as CacheEntry;
  } catch {
    return null;
  }
};

/**
 * Persists `entry` for `key` under `provider`. Creates the per-provider
 * directory on first write. Failures bubble — an unwritable cache directory
 * usually means the operator's filesystem is broken and they want to know.
 */
export const cacheWrite = async (args: {
  cache_root: string;
  provider: string;
  key: string;
  entry: CacheEntry;
}): Promise<void> => {
  await mkdir(join(args.cache_root, args.provider), { recursive: true });
  await writeJsonAtomic(entryPath(args), args.entry);
};

/**
 * Builds a `CacheEntry` from the live LLM response. Truncates the user-prompt
 * preview at 200 chars so the entry stays compact and inspectable but still
 * lets a human eyeball "is this the right entry" without reading the full prompt.
 */
export const buildEntry = (args: {
  provider: string;
  model: string;
  max_tokens: number;
  temperature: number;
  first_user_message: string;
  response: LlmCallResponse;
}): CacheEntry => ({
  schema_version: 1,
  cached_at: new Date().toISOString(),
  request_summary: {
    provider: args.provider,
    model: args.model,
    max_tokens: args.max_tokens,
    temperature: args.temperature,
    first_user_chars: args.first_user_message.slice(0, 200),
  },
  response: {
    text: args.response.text,
    prompt_tokens: args.response.prompt_tokens,
    completion_tokens: args.response.completion_tokens,
    original_cost_usd: args.response.cost_usd,
  },
});

/**
 * Constructs the cache key for a `LlmCallRequest` used by sync providers.
 * Pulls only the fields that affect the model's output.
 */
export const keyForLlmCall = (
  provider_name: string,
  req: LlmCallRequest,
): string =>
  cacheKeyFor({
    provider_name,
    model: req.model,
    system: req.system,
    messages: req.messages,
    max_tokens: req.max_tokens,
    temperature: req.temperature,
    response_format: req.response_format,
    disable_thinking: req.disable_thinking,
  });

/**
 * Constructs the cache key for a single batch-request entry. `custom_id` is
 * stripped — it's a routing tag, not model input, and would prevent reuse
 * across runs that assign different custom_ids to the same prompt.
 *
 * Batch judging always sends `messages: [{role: "user", content}]` so a
 * one-element array is the canonical shape here.
 */
export const keyForBatchRequest = (args: {
  provider_name: "anthropic-batch";
  model: string;
  max_tokens: number;
  temperature: number;
  system?: string;
  user_content: string;
}): string =>
  cacheKeyFor({
    provider_name: args.provider_name,
    model: args.model,
    max_tokens: args.max_tokens,
    temperature: args.temperature,
    system: args.system,
    messages: [{ role: "user", content: args.user_content }],
    response_format: "text",
    disable_thinking: false,
  });

const entryPath = (args: {
  cache_root: string;
  provider: string;
  key: string;
}): string => join(args.cache_root, args.provider, `${args.key}.json`);
