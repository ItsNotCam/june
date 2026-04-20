import { BaseEnvSchema, createEnv } from "@june/shared";
import { z } from "zod";

/**
 * MCP-package environment schema.
 *
 * Extends `BaseEnvSchema` from `@june/shared` — `NODE_ENV`, `LOG_LEVEL`, and
 * `CONFIG_PATH` are inherited. Required secrets + service endpoints
 * ([§29.1](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#291-environment-variables), I13) live here; never add tunables (those belong in `config.yaml`).
 */
const EnvSchema = BaseEnvSchema.extend({
  // CONFIG_PATH is listed as optional in SPEC [§29.1](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#291-environment-variables) (fresh install with no
  // config.yaml must work on shipped defaults, [§29.2](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#292-the-configyaml-reference)). The shared
  // BaseEnvSchema makes it required; we override here.
  CONFIG_PATH: z.string().min(1).optional(),
  OLLAMA_URL: z.url(),
  QDRANT_URL: z.url(),
  OLLAMA_EMBED_MODEL: z.string().min(1),
  OLLAMA_CLASSIFIER_MODEL: z.string().min(1),
  OLLAMA_SUMMARIZER_MODEL: z.string().min(1),
  QDRANT_API_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Returns the validated environment, parsing `process.env` on first call.
 *
 * Hard-fails at startup if any required variable is missing or invalid.
 * Callers never read `process.env` directly — always go through `getEnv()`.
 */
export const getEnv = createEnv(EnvSchema);
