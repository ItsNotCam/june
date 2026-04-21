// author: Cam
import { readFile } from "fs/promises";
import { parse } from "yaml";
import { z } from "zod";

/**
 * Thrown by getConfig() when called before loadConfig().
 * Catch this at the top level to give a clear startup error.
 */
export class ConfigNotInitializedError extends Error {
  constructor() {
    super("Config has not been loaded — call loadConfig(path) before getConfig()");
    this.name = "ConfigNotInitializedError";
  }
}

/**
 * Creates a { loadConfig, getConfig } pair for the given Zod schema.
 *
 * Call loadConfig(getEnv().CONFIG_PATH) once at startup; use getConfig() everywhere else.
 * loadConfig always overwrites — safe to call again for hot-reload or test reset.
 * getConfig throws ConfigNotInitializedError if loadConfig has not been called yet.
 */
export const createConfig = <T extends z.ZodTypeAny>(
  schema: T
): {
  loadConfig: (path: string) => Promise<z.infer<T>>;
  getConfig: () => z.infer<T>;
} => {
  let _config: z.infer<T> | null = null;

  const loadConfig = async (path: string): Promise<z.infer<T>> => {
    const raw = await readFile(path, "utf-8");
    _config = schema.parse(parse(raw));
    return _config;
  };

  const getConfig = (): z.infer<T> => {
    if (_config === null) throw new ConfigNotInitializedError();
    return _config;
  };

  return { loadConfig, getConfig };
};
