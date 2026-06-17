// author: Claude
import { join, resolve } from "path";
import { startDashboardServer } from "@/dashboard/server";
import { logger } from "@/lib/logger";
import { parseArgv, flagString } from "./shared";

const HELP = `june-eval dashboard — local web dashboard for bench runs over time.

Serves a read-only dashboard (trend charts, per-run drill-down, golden gate,
live in-flight progress) over the runs in state/runs. Plain HTML/CSS/JS on a
zero-dependency Bun.serve backend.

USAGE
  june-eval dashboard [--port <n>] [--host <h>] [--runs <dir>] [--golden <file>]

FLAGS
  --port <n>      port to bind (default 4317, or $PORT)
  --host <h>      hostname to bind (default localhost)
  --runs <dir>    runs directory (default <pkg>/state/runs)
  --golden <file> golden registry (default <pkg>/golden.json)
`;

/**
 * `june-eval dashboard` — boot the dashboard server and block forever.
 *
 * Returns a never-resolving promise so the top-level `await dispatch()` in
 * `bench.ts` keeps the process (and the server) alive until Ctrl-C.
 */
export const runDashboard = async (argv: readonly string[]): Promise<void> => {
  const { flags } = parseArgv(argv);
  if (flags["help"] === true || flags["h"] === true) {
    process.stderr.write(HELP);
    return;
  }

  const pkgRoot = join(import.meta.dir, "..");
  const port = Number(flagString(flags, "port") ?? process.env["PORT"] ?? "4317");
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    process.stderr.write(`Invalid --port "${flagString(flags, "port")}".\n`);
    process.exitCode = 64;
    return;
  }
  const hostname = flagString(flags, "host") ?? "localhost";
  const runsRoot = resolve(flagString(flags, "runs") ?? join(pkgRoot, "state", "runs"));
  const goldenPath = resolve(flagString(flags, "golden") ?? join(pkgRoot, "golden.json"));

  const server = startDashboardServer({ port, hostname, runsRoot, goldenPath });
  const url = `http://${hostname}:${server.port}`;
  logger.info("dashboard.listening", { message: url, run_dir: runsRoot, fixture_dir: goldenPath });
  process.stderr.write(`\njune-eval dashboard → ${url}\n  runs:   ${runsRoot}\n  golden: ${goldenPath}\n\nCtrl-C to stop.\n`);

  // Block forever — the server stays up until the process is killed.
  await new Promise<void>(() => {});
};
