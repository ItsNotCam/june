// author: Claude
import { z } from "zod";
import { getConfig } from "@/lib/config";
import { getEnv } from "@/lib/env";
import {
  EmbeddingDimensionMismatchError,
  OllamaModelNotFoundError,
  OllamaTimeoutError,
  OllamaUnavailableError,
} from "@/lib/errors";
import { logger } from "@/lib/logger";
import { sleepWithJitter } from "@/lib/retry";
import type { Embedder } from "./types";

/**
 * Ollama-backed dense embedder ([§22](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#22-stage-9--embedding-generation)). Uses `/api/embed` (not the deprecated
 * `/api/embeddings`). Retries per [§22.2](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#222-retry-timeout-and-ollama-specific-behavior); first call uses a longer timeout to
 * absorb model-load.
 */

const EmbedResponseSchema = z.object({
  embeddings: z.array(z.array(z.number())),
});

const ShowResponseSchema = z.object({
  digest: z.string().optional(),
});

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

const probeDigest = async (url: string, model: string): Promise<string> => {
  const res = await fetch(`${url}/api/show`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: model }),
  });
  if (!res.ok) return "";
  const json = await res.json().catch(() => ({}));
  const parsed = ShowResponseSchema.safeParse(json);
  return parsed.success ? (parsed.data.digest ?? "").slice(0, 12) : "";
};

const embedOnce = async (
  url: string,
  model: string,
  texts: ReadonlyArray<string>,
  timeoutMs: number,
): Promise<ReadonlyArray<ReadonlyArray<number>>> => {
  const res = await postWithTimeout(
    `${url}/api/embed`,
    { model, input: [...texts] },
    timeoutMs,
  );
  if (res.status === 404) {
    throw new OllamaModelNotFoundError(model);
  }
  if (!res.ok) {
    throw new Error(`Ollama embed HTTP ${res.status}`);
  }
  const json = await res.json();
  const parsed = EmbedResponseSchema.parse(json);
  return parsed.embeddings;
};

/**
 * Run one embed call with full retry policy. First call of a process gets
 * the longer `first_call_timeout_ms`; subsequent calls use `embed_timeout_ms`.
 */
const embedWithRetry = async (
  state: { firstCallDone: boolean },
  texts: ReadonlyArray<string>,
): Promise<ReadonlyArray<ReadonlyArray<number>>> => {
  const env = getEnv();
  const cfg = getConfig();
  const attempts = cfg.ollama.embed_retry_max_attempts;
  const base = cfg.ollama.retry.base_ms;
  const timeoutMs = state.firstCallDone
    ? cfg.ollama.embed_timeout_ms
    : cfg.ollama.first_call_timeout_ms;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await embedOnce(env.OLLAMA_URL, env.OLLAMA_EMBED_MODEL, texts, timeoutMs);
      state.firstCallDone = true;
      return result;
    } catch (err) {
      if (err instanceof OllamaModelNotFoundError) throw err;
      logger.warn("embedder_retry", {
        event: "embedder_retry",
        error_type: err instanceof Error ? err.name : "unknown",
        attempt,
      });
      if (attempt < attempts) {
        await sleepWithJitter(base * 2 ** (attempt - 1));
      }
    }
  }
  throw new OllamaUnavailableError(env.OLLAMA_URL, attempts);
};

/**
 * Factory — returns a configured Ollama embedder. The `dim` is probed once at
 * construction by calling the model with a single "dim-probe" string; the
 * result is cached on the returned object.
 */
export const createOllamaEmbedder = async (): Promise<Embedder> => {
  const env = getEnv();
  const cfg = getConfig();
  const state = { firstCallDone: false };
  const probeVec = await embedWithRetry(state, ["dim-probe"]);
  const probe = probeVec[0];
  if (!probe) {
    throw new OllamaUnavailableError(env.OLLAMA_URL, 1);
  }
  const fullDim = probe.length;
  const dim = cfg.embedding.matryoshka_dim ?? fullDim;
  if (cfg.embedding.matryoshka_dim && cfg.embedding.matryoshka_dim > fullDim) {
    throw new EmbeddingDimensionMismatchError(fullDim, cfg.embedding.matryoshka_dim);
  }
  const digest = await probeDigest(env.OLLAMA_URL, env.OLLAMA_EMBED_MODEL);
  return {
    name: env.OLLAMA_EMBED_MODEL,
    version: digest || "unknown",
    dim,
    max_input_chars: cfg.embedding.max_input_chars,
    embed: async (texts) => {
      if (texts.length === 0) return [];
      const raw = await embedWithRetry(state, texts);
      if (cfg.embedding.matryoshka_dim) {
        return raw.map((v) => truncateAndNormalize(v, cfg.embedding.matryoshka_dim as number));
      }
      return raw;
    },
  };
};

const truncateAndNormalize = (
  v: ReadonlyArray<number>,
  to: number,
): ReadonlyArray<number> => {
  const head = v.slice(0, to);
  let sumSq = 0;
  for (const x of head) sumSq += x * x;
  const norm = Math.sqrt(sumSq) || 1;
  return head.map((x) => x / norm);
};
