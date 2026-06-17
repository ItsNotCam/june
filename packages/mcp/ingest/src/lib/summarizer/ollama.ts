// author: Claude
import { z } from "zod";
import { getConfig } from "#internal/lib/config";
import { getEnv } from "#internal/lib/env";
import { OllamaModelNotFoundError, OllamaTimeoutError } from "#internal/lib/errors";
import { logger } from "#internal/lib/logger";
import { sleepWithJitter } from "#internal/lib/retry";
import { createSummarizerFromGenerate } from "./core";
import type { Summarizer } from "./types";

/**
 * Ollama transport for the Stage 6 summarizer ([§19](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#19-stage-6--contextual-summary-generation)). All
 * orchestration / validation / fallback lives in `./core`; this module only
 * owns the `/api/generate` call, its retry, and **deterministic decoding**
 * (`temperature: 0` + fixed `seed`) — Stage 6 is the sole source of ingest
 * non-determinism, so pinning it makes the whole pipeline reproducible.
 */

const GenerateResponseSchema = z.object({
  response: z.string(),
  done: z.boolean().optional(),
});

/**
 * Fixed seed for the summarizer. Combined with `temperature: 0` it makes Ollama
 * decode greedily and reproducibly, so re-ingesting a corpus yields byte-identical
 * contextual summaries (and therefore identical embeddings / retrieval).
 */
const SUMMARIZER_SEED = 42;

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
    {
      model,
      prompt,
      stream: false,
      // Deterministic decoding — see SUMMARIZER_SEED.
      options: { temperature: 0, seed: SUMMARIZER_SEED },
      ...(jsonMode ? { format: "json" } : {}),
    },
    timeoutMs,
  );
  if (res.status === 404) throw new OllamaModelNotFoundError(model);
  if (!res.ok) throw new Error(`Ollama summarizer HTTP ${res.status}`);
  const json = await res.json().catch(() => null);
  const parsed = GenerateResponseSchema.safeParse(json);
  if (!parsed.success) return "";
  return parsed.data.response.trim();
};

/**
 * Ollama-backed summarizer. Builds a deterministic `generate` closure (with the
 * classifier-style retry) and delegates all shared behaviour to the core.
 */
export const createOllamaSummarizer = (): Summarizer => {
  const env = getEnv();
  // Config wins when set; OLLAMA_SUMMARIZER_MODEL env is the fallback.
  const model = getConfig().summarizer.ollama_model ?? env.OLLAMA_SUMMARIZER_MODEL;
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

  return createSummarizerFromGenerate({
    name: model,
    generate: (prompt, jsonMode) =>
      retryLoop("generate", () =>
        generate(env.OLLAMA_URL, model, prompt, timeoutFor(), jsonMode),
      ),
  });
};
