// author: Claude
import { z } from "zod";
import { BaseEnvSchema, createEnv } from "@june/shared";

/**
 * Bench environment schema (§29.1).
 *
 * Extends `BaseEnvSchema` per the CLAUDE.md pattern — `NODE_ENV`, `LOG_LEVEL`,
 * and `CONFIG_PATH` are always present. Bench-specific additions:
 *
 * - `ANTHROPIC_API_KEY` — required (the judge is always Anthropic Batch, so
 *   even a pure-Ollama config needs this key).
 * - `OLLAMA_URL` — required (Tier-2 resolver always uses the Ollama embedder).
 * - `QDRANT_URL` — required (resolver + retriever read from it).
 * - `JUNE_BIN` — required, the path or command name for `june ingest`.
 * - `OPENAI_API_KEY` — optional; required only when any role is configured
 *   for openai (checked post-config-load, not in this schema).
 * - `BENCH_SCRATCH_ROOT` — optional; overrides `config.ingest.scratch_root`.
 */
const EnvSchema = BaseEnvSchema.extend({
  ANTHROPIC_API_KEY: z.string().min(1),
  OLLAMA_URL: z.string().url(),
  QDRANT_URL: z.string().url(),
  JUNE_BIN: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1).optional(),
  QDRANT_API_KEY: z.string().min(1).optional(),
  BENCH_SCRATCH_ROOT: z.string().min(1).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Returns the validated environment, parsing `process.env` on first call.
 *
 * Lazy singleton — safe to import at module level. Throws a Zod error on
 * first call if any required variable is missing or invalid. Never call
 * `process.env` directly anywhere in the bench.
 */
export const getEnv = createEnv(EnvSchema);
