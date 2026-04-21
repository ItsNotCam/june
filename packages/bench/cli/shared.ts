// author: Claude
import type { LogLevel } from "@june/shared";
import { getEnv } from "@/lib/env";
import { loadConfig, getConfig } from "@/lib/config";
import { setLogLevel, setPrettyMode } from "@/lib/logger";
import { UsageError } from "@/lib/errors";

/**
 * Shared CLI boot-up (§28).
 *
 * Parses common flags, loads the bench config, returns the leftover positional
 * arguments for subcommands to consume. Never call `process.argv` directly
 * outside this file.
 */
export type ParsedArgs = {
  positionals: string[];
  flags: Record<string, string | boolean>;
};

export const parseArgv = (argv: readonly string[]): ParsedArgs => {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
};

/**
 * Common startup — resolve config path, load config, return config and env.
 *
 * `--config <path>` overrides `CONFIG_PATH` env which overrides `./config.yaml`.
 * Exit codes per §28: unknown subcommand is `64`, env-var missing is `1`.
 */
export const bootstrap = async (flags: Record<string, string | boolean>): Promise<void> => {
  const env = getEnv();
  const configPath = flagString(flags, "config") ?? env.CONFIG_PATH;
  const cfg = await loadConfig(configPath);
  // Env LOG_LEVEL wins over config; default chain handled by zod.
  setLogLevel((env.LOG_LEVEL ?? cfg.log.level) as LogLevel);
  // --log-json forces JSON regardless of `log.pretty: true` in config —
  // operator override is louder than the config preference.
  setPrettyMode(!flagBool(flags, "log-json") && cfg.log.pretty);
};

export const flagString = (
  flags: Record<string, string | boolean>,
  name: string,
): string | undefined => {
  const v = flags[name];
  return typeof v === "string" ? v : undefined;
};

export const flagBool = (
  flags: Record<string, string | boolean>,
  name: string,
): boolean => flags[name] === true;

export const requirePositional = (
  positionals: readonly string[],
  n: number,
  usage: string,
): string[] => {
  if (positionals.length < n) {
    throw new UsageError(`Missing arguments.\n\nUsage: ${usage}`);
  }
  return positionals.slice(0, n);
};

/**
 * Emits a single stderr progress line in the `[i/9] stage-name    ok    (duration)` shape (§28).
 *
 * No terminal-control codes — `--quiet` suppresses progress entirely,
 * `--log-json` routes progress through the structured logger instead.
 */
export const stageProgress = (args: {
  quiet: boolean;
  json_log: boolean;
  stage_num: number;
  stage_name: string;
  duration_ms: number;
  detail?: string;
}): void => {
  if (args.quiet) return;
  if (args.json_log) return; // logger handles structured events
  const stagePrefix = `[${args.stage_num}/9]`;
  const padded = args.stage_name.padEnd(28, " ");
  const duration = `(${(args.duration_ms / 1000).toFixed(1)}s${args.detail ? `, ${args.detail}` : ""})`;
  process.stderr.write(`${stagePrefix} ${padded} ok         ${duration}\n`);
};

export const confirmPrompt = async (message: string): Promise<boolean> => {
  process.stderr.write(`${message} [y/N] `);
  for await (const chunk of Bun.stdin.stream()) {
    const answer = new TextDecoder().decode(chunk).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  }
  return false;
};

export { getConfig };
