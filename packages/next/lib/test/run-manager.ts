// author: Claude
/**
 * Single-run manager for the `/test` pipeline UI (server-only).
 *
 * Owns at most one live bench child process. The `POST /test/api` handler asks
 * it to start a run; the `GET /test/api` SSE handler subscribes for live updates.
 * It folds the child's NDJSON progress (stdout) into a `RunSnapshot` and
 * broadcasts each delta, so any number of browsers — including one that connects
 * mid-run — can render current progress from the latest message alone.
 *
 * The instance is stashed on `globalThis` so Next's dev HMR doesn't spawn a
 * second manager (and thus allow a second concurrent run) on module reload.
 */
import { spawn } from "child_process";
import { createInterface } from "readline";
import { createWriteStream, mkdirSync, writeFileSync, type WriteStream } from "fs";
import { join } from "path";
import { getTestConfig } from "./env";
import { deriveRunArgs, loadTestConfig } from "./config";
import {
  TestEventSchema,
  type RunMessage,
  type RunSnapshot,
  type StageState,
  type TestEvent,
} from "./events";

/** Thrown by `startRun` when a run is already in flight (mapped to HTTP 409). */
export class RunInProgressError extends Error {
  constructor() {
    super("A bench run is already in progress");
    this.name = "RunInProgressError";
  }
}

/** Flags the runner always appends — non-interactive, clean stdout, events on. */
const FORCED_FLAGS = ["--yes", "--quiet", "--progress-ndjson"] as const;
/** Cap on retained child stderr (chars) used to explain a non-zero exit. */
const STDERR_TAIL_LIMIT = 4000;

type RunManager = {
  startRun: () => Promise<RunSnapshot>;
  subscribe: (cb: (msg: RunMessage) => void) => () => void;
  getSnapshot: () => RunSnapshot;
};

const idleSnapshot = (): RunSnapshot => ({ status: "idle", stages: [] });

const createRunManager = (): RunManager => {
  let snapshot: RunSnapshot = idleSnapshot();
  let stderrTail = "";
  let stderrAll = "";
  let logStream: WriteStream | undefined;
  const subscribers = new Set<(msg: RunMessage) => void>();

  const broadcast = (event?: TestEvent): void => {
    const msg: RunMessage = { snapshot, ...(event ? { event } : {}) };
    for (const cb of subscribers) {
      try {
        cb(msg);
      } catch {
        // A subscriber whose SSE stream has closed throws on enqueue — drop it
        // rather than letting one dead client break the broadcast for others.
        subscribers.delete(cb);
      }
    }
  };

  const stageBy = (num: number): StageState | undefined =>
    snapshot.stages.find((s) => s.num === num);

  const applyEvent = (event: TestEvent): void => {
    switch (event.type) {
      case "run_start":
        snapshot.runId = event.run_id;
        snapshot.fixtureId = event.fixture_id;
        snapshot.stages = event.stages.map((s) => ({
          num: s.num,
          name: s.name,
          status: "pending",
        }));
        break;
      case "stage_start": {
        const st = stageBy(event.stage);
        if (st) {
          st.status = "running";
          st.total = event.total;
          st.done = event.total !== undefined ? 0 : st.done;
        }
        break;
      }
      case "tick": {
        const st = stageBy(event.stage);
        if (st) {
          st.done = event.done;
          st.total = event.total;
        }
        break;
      }
      case "poll": {
        const st = stageBy(event.stage);
        if (st) {
          st.elapsedMs = event.elapsed_ms;
          st.detail = event.status;
        }
        break;
      }
      case "stage_end": {
        const st = stageBy(event.stage);
        if (st) {
          st.status = "done";
          st.elapsedMs = event.duration_ms;
          if (event.detail !== undefined) st.detail = event.detail;
        }
        break;
      }
      case "run_complete":
        snapshot.costUsd = event.cost_usd;
        snapshot.runDir = event.run_dir;
        snapshot.runId = event.run_id;
        break;
      case "run_error":
        snapshot.status = "error";
        snapshot.error = event.message;
        break;
    }
  };

  const persistLogs = (): void => {
    logStream?.end();
    logStream = undefined;
    if (!snapshot.runId || !stderrAll) return;
    try {
      const path = join(getTestConfig().runsDir, snapshot.runId, "progress.stderr.log");
      writeFileSync(path, stderrAll);
    } catch {
      // best-effort — the run still completed; we just couldn't save stderr.
    }
  };

  const onExit = (code: number | null): void => {
    persistLogs();
    if (snapshot.status === "error") {
      broadcast();
      return;
    }
    if (code === 0) {
      snapshot.status = "completed";
    } else {
      snapshot.status = "error";
      snapshot.error =
        `bench exited with code ${code ?? "unknown"}` +
        (stderrTail ? `\n${stderrTail.trim()}` : "");
    }
    broadcast();
  };

  const startRun = async (): Promise<RunSnapshot> => {
    if (snapshot.status === "running") throw new RunInProgressError();
    // Validate env before claiming the slot — a config error shouldn't lock the runner.
    const cfg = getTestConfig();
    // Claim the slot synchronously (before any await) so concurrent starts can't race.
    snapshot = { status: "running", stages: [] };
    stderrTail = "";
    stderrAll = "";
    logStream = undefined;

    let proc: ReturnType<typeof spawn>;
    try {
      const testConfig = await loadTestConfig();
      const { flags, ingestYaml } = deriveRunArgs(testConfig);

      // Persist the ingest overrides where bench can read them via --ingest-config.
      mkdirSync(cfg.runsDir, { recursive: true });
      const ingestConfigPath = join(cfg.runsDir, ".ingest-config.yaml");
      writeFileSync(ingestConfigPath, ingestYaml);

      const args = [
        cfg.cli,
        "run",
        cfg.fixtureDir,
        ...flags,
        ...cfg.flags, // optional TEST_RUN_FLAGS extras (override derived; usually empty)
        "--ingest-config",
        ingestConfigPath,
        ...FORCED_FLAGS,
      ];
      proc = spawn(cfg.runner, args, {
        cwd: cfg.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
    } catch (err) {
      // Failed before spawn — release the slot so the user can retry.
      snapshot = { status: "error", stages: [], error: err instanceof Error ? err.message : String(err) };
      broadcast();
      throw err;
    }

    const stdout = createInterface({ input: proc.stdout! });
    stdout.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // Non-JSON stdout (stray print) — not a progress event, ignore.
        return;
      }
      const result = TestEventSchema.safeParse(parsed);
      if (!result.success) return;
      // Open the per-run log once the run-dir is known (run_start is first).
      if (result.data.type === "run_start") {
        try {
          const runDir = join(cfg.runsDir, result.data.run_id);
          mkdirSync(runDir, { recursive: true });
          logStream = createWriteStream(join(runDir, "progress.ndjson"), { flags: "w" });
        } catch {
          logStream = undefined; // best-effort: live UI still works without saved logs
        }
      }
      logStream?.write(`${trimmed}\n`);
      applyEvent(result.data);
      broadcast(result.data);
    });

    proc.stderr!.on("data", (chunk: Buffer) => {
      const s = chunk.toString();
      stderrTail = (stderrTail + s).slice(-STDERR_TAIL_LIMIT);
      stderrAll += s;
    });

    proc.on("error", (err) => {
      snapshot.status = "error";
      snapshot.error = err.message;
      broadcast();
    });
    proc.on("exit", onExit);

    return snapshot;
  };

  const subscribe = (cb: (msg: RunMessage) => void): (() => void) => {
    subscribers.add(cb);
    return () => {
      subscribers.delete(cb);
    };
  };

  return { startRun, subscribe, getSnapshot: () => snapshot };
};

const globalForRun = globalThis as unknown as { __juneTestRunManager?: RunManager };

/** The process-wide run manager. One instance survives dev HMR via globalThis. */
export const runManager: RunManager =
  globalForRun.__juneTestRunManager ?? (globalForRun.__juneTestRunManager = createRunManager());
