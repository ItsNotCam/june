// author: Claude
import type { RunId } from "@/types/ids";
import type { SidecarStorage } from "./storage/types";

/**
 * 30-second heartbeat task for the active ingest lock (I2). Runs for the
 * lifetime of a run; must be cancelled before `releaseWriteLock` on clean
 * shutdown ([§24.5](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#245-graceful-shutdown-per-i8)).
 */

const HEARTBEAT_INTERVAL_MS = 30_000;

export type Heartbeat = {
  stop: () => void;
};

/** Start a timer that calls `sidecar.heartbeat(run_id)` every 30s. */
export const startHeartbeat = (
  sidecar: SidecarStorage,
  run_id: RunId,
): Heartbeat => {
  const timer = setInterval(() => {
    sidecar.heartbeat(run_id).catch(() => {
      // Heartbeat failures are non-fatal — the next successful tick catches
      // up. A persistently failing heartbeat surfaces as a stale-lock break
      // in the next ingest attempt.
    });
  }, HEARTBEAT_INTERVAL_MS);
  // `setInterval`'s Timer type on Bun is NodeJS.Timer; `unref` so the
  // heartbeat doesn't keep the process alive past shutdown.
  if (typeof (timer as { unref?: () => void }).unref === "function") {
    (timer as { unref: () => void }).unref();
  }
  return {
    stop: () => clearInterval(timer),
  };
};

export const _internal = { HEARTBEAT_INTERVAL_MS } as const;
