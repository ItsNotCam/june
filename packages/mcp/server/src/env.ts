// author: Cam
import { z } from "zod";
import { BaseEnvSchema, createEnv } from "@june/shared";

const EnvSchema = BaseEnvSchema.extend({
  QDRANT_URL: z.url(),
  OLLAMA_URL: z.url()
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
