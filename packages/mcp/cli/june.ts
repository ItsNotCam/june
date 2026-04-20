#!/usr/bin/env bun
import { logger } from "@/lib/logger";
import { installSignalHandlers } from "@/lib/shutdown";
import { runBench } from "./bench";
import { runHealth } from "./health";
import { runIngest } from "./ingest";
import { runInit } from "./init";
import { runPurge } from "./purge";
import { runReconcile } from "./reconcile";
import { runReEmbed } from "./re-embed";
import { runReindex } from "./reindex";
import { runResume } from "./resume";
import { runStatus } from "./status";

/**
 * june CLI dispatcher ([§27](../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#27-cli)). Argv routing is hand-rolled — no commander, no
 * yargs (gate I14, and the surface is small enough to not warrant a dep).
 *
 * Exit codes per [§27.3](../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#273-exit-codes):
 *    0 = success
 *    1 = generic / fatal configuration error
 *    2 = another ingest is running
 *    3 = health check failed
 *    4 = user aborted
 *   64 = usage error (unknown command, missing required argument)
 */

const HELP = `june — markdown ingestion pipeline

Usage:
  june init
  june ingest <path> [--version <s>] [--verify-offline]
  june status [<doc_id>]
  june resume
  june reindex <doc_id>
  june purge <doc_id> [--all-versions] [--yes]
  june reconcile [--dry-run] [--purge]
  june re-embed --embedding-model <name> [--collection internal|external|all] [--yes]
  june health
  june bench <corpus-path> [--out <file>] [--no-store]
  june --help | --version

Flags (apply to most commands):
  --config <path>   Path to config.yaml
  --quiet           Suppress stderr progress
  --json-log        Single-line JSON log output
`;

const VERSION = "0.1.0";

type CommandFn = (argv: ReadonlyArray<string>) => Promise<number>;

const commands: Readonly<Record<string, CommandFn>> = {
  init: async (argv) => {
    await runInit(argv);
    return 0;
  },
  ingest: runIngest,
  status: runStatus,
  resume: runResume,
  reindex: runReindex,
  purge: runPurge,
  reconcile: runReconcile,
  "re-embed": runReEmbed,
  health: runHealth,
  bench: runBench,
};

/**
 * Programmatic CLI entry point. Accepts the same argv slice the `june` binary
 * receives (everything after the binary name) and returns the exit code.
 *
 * Unlike running the binary, this never calls `process.exit` — the caller's
 * process stays alive and can inspect the return value.
 *
 * @example
 * ```ts
 * import { runCli } from "mcp";
 *
 * const code = await runCli(["ingest", "./docs", "--config", "./config.yaml"]);
 * if (code !== 0) throw new Error(`june exited with code ${code}`);
 * ```
 *
 * Exit codes:
 *  - `0`  — success
 *  - `1`  — fatal / configuration error
 *  - `2`  — another ingest is already running (lock held)
 *  - `3`  — health check failed
 *  - `4`  — user confirmation required (`--yes` not passed)
 *  - `64` — usage error (unknown command or missing required argument)
 *
 * @param argv - Command + flags, e.g. `["ingest", "./docs", "--force"]`
 */
export const runCli = async (argv: ReadonlyArray<string>): Promise<number> => {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(HELP);
    return 0;
  }
  if (argv[0] === "--version") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const [cmd, ...rest] = argv;
  if (!cmd) {
    process.stderr.write(HELP);
    return 64;
  }
  const fn = commands[cmd];
  if (!fn) {
    process.stderr.write(`june: unknown command '${cmd}'.\n${HELP}`);
    return 64;
  }

  try {
    return await fn(rest);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("cli_fatal", { event: "cli_fatal", error_message: msg });
    process.stderr.write(`june: ${msg}\n`);
    return 1;
  }
};

const main = async (): Promise<void> => {
  // [§24.5](../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#245-graceful-shutdown-per-i8) / I8: SIGINT + SIGTERM flip the shutdown flag; pipeline workers
  // drain at the next stage boundary before the process exits.
  installSignalHandlers();
  const code = await runCli(Bun.argv.slice(2));
  process.exit(code);
};

void main();
