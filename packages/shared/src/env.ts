// author: Cam
import { z } from "zod";
import { NODE_ENV_VALUES, LOG_LEVEL_VALUES } from "./types.ts";

/**
 * Base Zod schema every package's env must extend via BaseEnvSchema.extend({...}).
 * Contains the three fields required by all packages: NODE_ENV, LOG_LEVEL, CONFIG_PATH.
 * Never instantiate this directly — use createEnv() with an extended schema.
 */
export const BaseEnvSchema = z.object({
  // NODE_ENV and LOG_LEVEL types are defined in shared/types.ts and sourced here directly
  NODE_ENV: z.enum(NODE_ENV_VALUES).default("development"),
  LOG_LEVEL: z.enum(LOG_LEVEL_VALUES).default("info"),
  // CONFIG_PATH is always present — used by the startup sequence to call loadConfig()
  CONFIG_PATH: z.string(),
});

export type BaseEnv = z.infer<typeof BaseEnvSchema>;

/**
 * Creates a lazy singleton getEnv() for the given Zod schema.
 *
 * The schema must be produced via BaseEnvSchema.extend({...}) to guarantee
 * NODE_ENV, LOG_LEVEL, and CONFIG_PATH are always present.
 * Parses process.env on first call and caches the result — safe to import at module level.
 * Throws a Zod error on first call if any required variable is missing or invalid.
 * Never call process.env directly — always go through the returned getEnv().
 */
export const createEnv = <T extends z.ZodObject<z.ZodRawShape>>(schema: T): () => z.infer<T> => {
  let _env: z.infer<T> | null = null;
  return (): z.infer<T> => {
    if (_env) return _env;
    _env = schema.parse(process.env);
    return _env;
  };
};
