// author: Claude
import { z } from "zod";
import { getConfig } from "@/lib/config";
import { getEnv } from "@/lib/env";
import {
  ClassifierJsonError,
  OllamaModelNotFoundError,
  OllamaTimeoutError,
} from "@/lib/errors";
import type { ChunkId } from "@/types/ids";
import { logger } from "@/lib/logger";
import { sleepWithJitter } from "@/lib/retry";
import { ClassifierOutputSchema, type ClassifierOutputJson } from "@/schemas/classifier";
import {
  ANSWER_SHAPE_VALUES,
  AUDIENCE_VALUES,
  CATEGORY_VALUES,
  LIFECYCLE_VALUES,
  SECTION_ROLE_VALUES,
  SENSITIVITY_VALUES,
  STABILITY_VALUES,
  TEMPORAL_VALUES,
  TRUST_TIER_VALUES,
} from "@/types/vocab";
import { buildClassifierPrompt } from "./prompt";
import { buildFallbackClassifierJson, toChunkClassification } from "./fallback";
import type { Classifier, ClassifierInput } from "./types";

/**
 * Ollama-backed classifier ([§18.1](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#181-classifier-model-choice)–18.6). Uses a grammar-constrained JSON
 * Schema as `format` so the sampler cannot produce enum values outside the
 * controlled vocabularies. Validates the response against
 * `ClassifierOutputSchema`; on failure applies `config.classifier.fallbacks`.
 *
 * Retries follow the Ollama taxonomy ([§25.3](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#253-ollama-failure-modes-dedicated-subsection)):
 *   - timeout / unreachable / 5xx → exponential backoff to max attempts.
 *   - 404 model-not-found → fatal-fast.
 *   - invalid JSON or schema violation → one repair attempt, then fallback.
 */

/**
 * JSON Schema passed to Ollama's `format` field. Grammar-constrained sampling
 * prevents the model from producing enum values outside the controlled
 * vocabularies, eliminating the most common source of ClassifierJsonError.
 */
const CLASSIFIER_FORMAT_SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string", enum: [...CATEGORY_VALUES] },
    section_role: { type: "string", enum: [...SECTION_ROLE_VALUES] },
    answer_shape: { type: "string", enum: [...ANSWER_SHAPE_VALUES] },
    audience: {
      type: "array",
      items: { type: "string", enum: [...AUDIENCE_VALUES] },
      minItems: 1,
      maxItems: 3,
    },
    audience_technicality: { type: "integer", minimum: 1, maximum: 5 },
    sensitivity: { type: "string", enum: [...SENSITIVITY_VALUES] },
    lifecycle_status: { type: "string", enum: [...LIFECYCLE_VALUES] },
    stability: { type: "string", enum: [...STABILITY_VALUES] },
    temporal_scope: { type: "string", enum: [...TEMPORAL_VALUES] },
    source_trust_tier: { type: "string", enum: [...TRUST_TIER_VALUES] },
    prerequisites: { type: "array", items: { type: "string" }, maxItems: 10 },
    self_contained: { type: "boolean" },
    negation_heavy: { type: "boolean" },
    tags: { type: "array", items: { type: "string" }, maxItems: 10 },
  },
  required: [
    "category",
    "section_role",
    "answer_shape",
    "audience",
    "audience_technicality",
    "sensitivity",
    "lifecycle_status",
    "stability",
    "temporal_scope",
    "source_trust_tier",
    "prerequisites",
    "self_contained",
    "negation_heavy",
    "tags",
  ],
} as const;

const GenerateResponseSchema = z.object({
  response: z.string(),
  done: z.boolean().optional(),
});

const ShowResponseSchema = z.object({
  digest: z.string().optional(),
});

const stripFences = (raw: string): string =>
  raw
    .replace(/^\s*```(?:json)?\s*\n/, "")
    .replace(/\n\s*```\s*$/, "")
    .trim();

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
  try {
    const res = await fetch(`${url}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: model }),
    });
    if (!res.ok) return "";
    const json = await res.json().catch(() => ({}));
    const parsed = ShowResponseSchema.safeParse(json);
    return parsed.success ? (parsed.data.digest ?? "").slice(0, 12) : "";
  } catch {
    return "";
  }
};

const callOnce = async (
  url: string,
  model: string,
  prompt: string,
  timeoutMs: number,
): Promise<string> => {
  const res = await postWithTimeout(
    `${url}/api/generate`,
    { model, prompt, format: CLASSIFIER_FORMAT_SCHEMA, stream: false },
    timeoutMs,
  );
  if (res.status === 404) throw new OllamaModelNotFoundError(model);
  if (!res.ok) throw new Error(`Ollama classifier HTTP ${res.status}`);
  const json = await res.json().catch(() => null);
  const parsed = GenerateResponseSchema.safeParse(json);
  if (!parsed.success) return "";
  return parsed.data.response;
};

const parseAndValidate = (
  raw: string,
  chunk_id: ChunkId,
): ClassifierOutputJson => {
  const tryParse = (text: string): ClassifierOutputJson => {
    const obj = JSON.parse(text);
    return ClassifierOutputSchema.parse(obj);
  };
  try {
    return tryParse(raw);
  } catch {
    try {
      return tryParse(stripFences(raw));
    } catch {
      throw new ClassifierJsonError(chunk_id, raw.slice(0, 200));
    }
  }
};

/**
 * Run the classifier with exponential backoff. Retries on timeouts / network
 * errors up to `classifier_retry_max_attempts`. Grammar-constrained sampling
 * via `CLASSIFIER_FORMAT_SCHEMA` eliminates enum-value violations; Zod
 * validation is a second safety net for unexpected model behaviour.
 * On every-attempt failure, falls back per [§18.6](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#186-failure-handling-and-fallbacks).
 */
export const createOllamaClassifier = async (): Promise<Classifier> => {
  const env = getEnv();
  const cfg = getConfig();
  const model = env.OLLAMA_CLASSIFIER_MODEL;
  const digest = await probeDigest(env.OLLAMA_URL, model);
  const state = { firstCallDone: false };

  const classify: Classifier["classify"] = async (input: ClassifierInput) => {
    const prompt = buildClassifierPrompt({
      chunk_content: input.chunk_content,
      document_title: input.document_title,
      heading_path: input.heading_path,
    });
    const attempts = cfg.ollama.classifier_retry_max_attempts;
    const baseMs = cfg.ollama.retry.base_ms;
    const timeoutMs = state.firstCallDone
      ? cfg.ollama.classifier_timeout_ms
      : cfg.ollama.first_call_timeout_ms;

    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const raw = await callOnce(env.OLLAMA_URL, model, prompt, timeoutMs);
        state.firstCallDone = true;
        const parsed = parseAndValidate(raw, input.chunk_id);
        return {
          chunk_id: input.chunk_id,
          classification: toChunkClassification(parsed, {
            namespace: "personal",
            project: undefined,
          }),
          raw_response: raw.slice(0, 200),
        };
      } catch (err) {
        if (err instanceof OllamaModelNotFoundError) throw err;
        lastErr = err;
        logger.warn("classifier_retry", {
          event: "classifier_retry",
          chunk_id: input.chunk_id as string,
          error_type: err instanceof Error ? err.name : "unknown",
          raw_preview: err instanceof ClassifierJsonError ? err.raw_preview : undefined,
          attempt,
        });
        if (attempt < attempts) {
          await sleepWithJitter(baseMs * 2 ** (attempt - 1));
        }
      }
    }

    // Fallback path — all retries exhausted.
    const fallbackJson = buildFallbackClassifierJson();
    logger.warn("classifier_fallback", {
      event: "classifier_fallback",
      chunk_id: input.chunk_id as string,
      error_type:
        lastErr instanceof Error ? lastErr.name : "classifier_unreachable",
    });
    return {
      chunk_id: input.chunk_id,
      classification: toChunkClassification(fallbackJson, {
        namespace: "personal",
        project: undefined,
      }),
      raw_response: "",
    };
  };

  return {
    name: model,
    version: digest || "unknown",
    classify,
  };
};
