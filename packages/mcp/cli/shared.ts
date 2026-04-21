// author: Claude
import { loadConfig, getConfig } from "@/lib/config";
import { getEnv } from "@/lib/env";
import { setLogLevel, setPrettyMode } from "@/lib/logger";
import { computeWhitelist, installOfflineGuard, verifyOffline } from "@/lib/offline-guard";

/**
 * Common CLI flag parsing + startup. Every command calls `bootstrap(argv)`
 * to:
 *   - parse the common flags (`--config`, `--quiet`, `--json-log`, `--verify-offline`),
 *   - install the offline guard with the env-var-derived whitelist,
 *   - load the YAML config,
 *   - set the log level.
 *
 * Returns a `{ positional, flags }` tuple for the calling command to
 * interpret positional args and command-specific flags.
 */

export type CommonFlags = {
  configPath: string | undefined;
  quiet: boolean;
  jsonLog: boolean;
  verifyOffline: boolean;
  yes: boolean;
};

export type ParsedCli = {
  positional: ReadonlyArray<string>;
  flags: CommonFlags;
  remaining: ReadonlyArray<string>;
};

export const parseCommonFlags = (argv: ReadonlyArray<string>): ParsedCli => {
  const positional: string[] = [];
  const remaining: string[] = [];
  const flags: CommonFlags = {
    configPath: undefined,
    quiet: false,
    jsonLog: false,
    verifyOffline: false,
    yes: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case "--config":
        flags.configPath = argv[++i];
        break;
      case "--quiet":
        flags.quiet = true;
        break;
      case "--json-log":
        flags.jsonLog = true;
        break;
      case "--verify-offline":
        flags.verifyOffline = true;
        break;
      case "--yes":
      case "-y":
        flags.yes = true;
        break;
      default:
        if (a.startsWith("--")) remaining.push(a);
        else positional.push(a);
    }
  }
  return { positional, flags, remaining };
};

/**
 * Load env + config, install offline guard. Must be called before any
 * command does real work ([§25.5](../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#255-offline-invariant-enforcement) / I10).
 */
export const bootstrap = async (flags: CommonFlags): Promise<void> => {
  const env = getEnv();
  await loadConfig(flags.configPath ?? env.CONFIG_PATH);
  const cfg = getConfig();
  setLogLevel(env.LOG_LEVEL ?? cfg.log.level);
  setPrettyMode(!flags.jsonLog && cfg.log.pretty);

  const whitelist = computeWhitelist([env.OLLAMA_URL, env.QDRANT_URL]);
  installOfflineGuard(whitelist);

  if (flags.verifyOffline) {
    await verifyOffline(whitelist, [
      `${env.OLLAMA_URL}/api/tags`,
      `${env.QDRANT_URL}/collections`,
    ]);
  }
};
