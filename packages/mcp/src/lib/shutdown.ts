import { logger } from "./logger";

/**
 * Process-level cancellation token for graceful shutdown ([§24.5](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#245-graceful-shutdown-per-i8) / I8).
 *
 * The CLI entry point registers SIGINT / SIGTERM handlers that call `request`,
 * flipping the flag and logging `shutdown_signal_received`. Pipeline workers
 * check `isRequested()` between stage boundaries — once a stage completes for
 * a chunk, the worker does not start the next stage for any chunk in the
 * batch. The current in-flight stage for one chunk is allowed to finish; this
 * is a clean drain, not a forced abort.
 *
 * Module-level singleton. A long-running pipeline invocation shares it; tests
 * import `_reset` to isolate runs.
 */

let _requested = false;
let _signal: NodeJS.Signals | undefined = undefined;

export const isShutdownRequested = (): boolean => _requested;

export const requestShutdown = (signal: NodeJS.Signals): void => {
  if (_requested) return;
  _requested = true;
  _signal = signal;
  logger.info("shutdown_signal_received", {
    event: "shutdown_signal_received",
    signal,
  });
};

export const signalReceived = (): NodeJS.Signals | undefined => _signal;

/**
 * Install SIGINT + SIGTERM handlers. Returns a restore() that unhooks them —
 * the CLI doesn't usually need restore, but tests do.
 */
export const installSignalHandlers = (): (() => void) => {
  const handler = (signal: NodeJS.Signals): void => {
    requestShutdown(signal);
  };
  const sigint = (): void => handler("SIGINT");
  const sigterm = (): void => handler("SIGTERM");
  process.on("SIGINT", sigint);
  process.on("SIGTERM", sigterm);
  return () => {
    process.off("SIGINT", sigint);
    process.off("SIGTERM", sigterm);
  };
};

/** Test-only reset — flip the flag back off. Not exported through `src/index.ts`. */
export const _resetShutdown = (): void => {
  _requested = false;
  _signal = undefined;
};
