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
 * Fixed seed for the summarizer. Reproducibility comes from the **seed** (not
 * from `temperature: 0`): given the same seed, prompt, and host, Ollama's sampler
 * draws identically, so re-ingesting a corpus yields byte-identical contextual
 * summaries (and therefore identical embeddings / retrieval) on the BYO host.
 */
const SUMMARIZER_SEED = 42;

/**
 * Anti-degeneration decoding. Pure greedy decoding (`temperature: 0`) makes
 * gemma4:26b fall into token-repetition loops on some chunks ("…the and the…",
 * collapsing into "fulfulful…" until the token cap) — the JSON string then never
 * closes, fails to parse, and silently falls back to the template. On the real-doc
 * holdout this hit ~11% of chunks, and a repetition penalty alone only halved it
 * (the worst chunks loop under greedy regardless). A **low non-zero temperature**
 * gives the sampler enough freedom to escape the loop, while the fixed seed keeps
 * it reproducible; the repetition penalty (with a widened `repeat_last_n` window)
 * further discourages phrase-level repeats.
 */
const SUMMARIZER_TEMPERATURE = 0.5;
const SUMMARIZER_REPEAT_PENALTY = 1.3;
const SUMMARIZER_REPEAT_LAST_N = 256;

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
  attempt = 0,
): Promise<string> => {
  const res = await postWithTimeout(
    `${url}/api/generate`,
    {
      model,
      prompt,
      stream: false,
      // Reproducible (seeded) + anti-degeneration decoding — see
      // SUMMARIZER_SEED / SUMMARIZER_TEMPERATURE / SUMMARIZER_REPEAT_PENALTY.
      // `attempt` offsets the seed so a re-roll after an unparseable output
      // decodes differently (escaping a deterministic degeneration) while each
      // attempt stays individually reproducible.
      options: {
        temperature: SUMMARIZER_TEMPERATURE,
        seed: SUMMARIZER_SEED + attempt,
        repeat_penalty: SUMMARIZER_REPEAT_PENALTY,
        repeat_last_n: SUMMARIZER_REPEAT_LAST_N,
      },
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
 * Best-effort eviction of the summarizer model from Ollama's VRAM. Posts a
 * trivial `/api/generate` (the SAME endpoint the model is loaded on — `/api/embed`
 * would load the *embed* model instead) with `keep_alive: 0`, which loads-then-
 * immediately-unloads. Never throws: a failed unload just leaves the model to its
 * normal keep-alive, not an error. This is what lets the two-phase ingest free the
 * gemma summarizer before the embedder needs the GPU.
 */
const unloadOllamaSummarizer = async (url: string, model: string): Promise<void> => {
  try {
    await fetch(`${url}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt: ".", stream: false, keep_alive: 0 }),
    });
    logger.info("summarizer_unloaded", { event: "summarizer_unloaded", model_name: model });
  } catch (err) {
    logger.warn("summarizer_unload_failed", {
      event: "summarizer_unload_failed",
      model_name: model,
      error_message: err instanceof Error ? err.message : String(err),
    });
  }
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
    generate: (prompt, jsonMode, attempt) =>
      retryLoop("generate", () =>
        generate(env.OLLAMA_URL, model, prompt, timeoutFor(), jsonMode, attempt),
      ),
    unload: () => unloadOllamaSummarizer(env.OLLAMA_URL, model),
  });
};
