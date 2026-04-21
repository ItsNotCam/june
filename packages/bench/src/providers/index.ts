// author: Claude
import type { BatchLlmProvider, LlmProvider } from "./types";
import { createOllamaProvider } from "./ollama";
import { createAnthropicProvider } from "./anthropic";
import { createAnthropicBatchProvider } from "./anthropic-batch";
import { createOpenAIProvider } from "./openai";
import { getEnv } from "@/lib/env";

export type ProviderRegistry = {
  ollama: LlmProvider;
  anthropic: LlmProvider;
  openai: LlmProvider | null;
  "anthropic-batch": BatchLlmProvider;
};

/**
 * Constructs every provider the bench might need for a run.
 *
 * `openai` is null when `OPENAI_API_KEY` is unset — the config-load step
 * checks whether any role is configured for openai and hard-fails at that
 * point if the key is missing, so callers pulling the openai entry out of
 * this registry can safely assume it exists when their config called for it.
 *
 * The judge provider is always constructed — the spec mandates Anthropic
 * Batch for role 4, and `ANTHROPIC_API_KEY` is required at env validation.
 */
export const buildProviders = (): ProviderRegistry => {
  const env = getEnv();
  return {
    ollama: createOllamaProvider(env.OLLAMA_URL),
    anthropic: createAnthropicProvider(env.ANTHROPIC_API_KEY),
    openai: env.OPENAI_API_KEY
      ? createOpenAIProvider(env.OPENAI_API_KEY)
      : null,
    "anthropic-batch": createAnthropicBatchProvider(env.ANTHROPIC_API_KEY),
  };
};

/**
 * Resolves a sync provider by name, throwing if the requested provider is
 * not configured. Used when a role's `provider` key is consumed at runtime.
 */
export const resolveSyncProvider = (
  registry: ProviderRegistry,
  name: "ollama" | "anthropic" | "openai",
): LlmProvider => {
  if (name === "openai") {
    if (!registry.openai) {
      throw new Error(
        "Role is configured for openai but OPENAI_API_KEY is not set",
      );
    }
    return registry.openai;
  }
  return registry[name];
};

export type { LlmProvider, BatchLlmProvider } from "./types";
