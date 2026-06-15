// author: Cam
import { z } from "zod";
import { BaseEnvSchema, createEnv } from "@june/shared";

const EnvSchema = BaseEnvSchema.extend({
  QDRANT_URL: z.url(),
  OLLAMA_URL: z.url(),
  // Optional Qdrant auth — forwarded to @june/mcp-ingest via process.env.
  QDRANT_API_KEY: z.string().optional(),
  // Ollama model vars required by @june/mcp-ingest's buildDeps(). Validated here
  // so a misconfigured server fails fast with a clear error rather than deep
  // inside the ingest pipeline. Both packages read the same process.env.
  OLLAMA_EMBED_MODEL: z.string().min(1),
  OLLAMA_CLASSIFIER_MODEL: z.string().min(1),
  OLLAMA_SUMMARIZER_MODEL: z.string().min(1),
  // Path to @june/mcp-ingest's config.yaml. Optional — when unset, ingest falls
  // back to its own discovery chain (./config.yaml, ~/.config/june, defaults).
  INGEST_CONFIG_PATH: z.string().optional(),
});

/** Inferred from EnvSchema — never define manually. */
export type Env = z.infer<typeof EnvSchema>;

/**
 * Returns the validated environment, parsing process.env on first call.
 *
 * Extends BaseEnvSchema from @june/shared — NODE_ENV, LOG_LEVEL, and CONFIG_PATH
 * are always present. Add package-specific vars above via BaseEnvSchema.extend().
 * Never call process.env directly — always go through getEnv().
 */
export const getEnv = createEnv(EnvSchema);
