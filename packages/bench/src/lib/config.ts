// author: Claude
import { createConfig } from "@june/shared";
import { BenchConfigSchema, type BenchConfig } from "@/schemas/config";

/**
 * Lazy singleton `{ loadConfig, getConfig }` for `config.yaml` (§29.3).
 *
 * Call `loadConfig(getEnv().CONFIG_PATH)` once at startup. Use `getConfig()`
 * everywhere else. `loadConfig` overwrites — safe to call again in tests.
 *
 * Throws `ConfigNotInitializedError` (from `@june/shared`) if accessed before
 * load.
 */
const { loadConfig, getConfig } = createConfig(BenchConfigSchema);
export { loadConfig, getConfig };
export type { BenchConfig };
