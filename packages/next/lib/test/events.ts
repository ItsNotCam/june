// author: Claude
/**
 * Progress-event contract for the `/test` runner.
 *
 * The bench CLI emits these as newline-delimited JSON on stdout when invoked
 * with `--progress-ndjson` (see `packages/mcp/bench/src/lib/progress-events.ts`).
 * This file re-declares the schema on the Next side because the NDJSON line is a
 * trust boundary — we validate every line before folding it into state. **Keep
 * this schema in sync with the bench definition.**
 */
import { z } from "zod";

const StageDescriptorSchema = z.object({
  num: z.number().int(),
  name: z.string(),
});

/** Discriminated union of every progress event the bench run can emit. */
export const TestEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("run_start"),
    fixture_id: z.string(),
    run_id: z.string(),
    stages: z.array(StageDescriptorSchema),
  }),
  z.object({
    type: z.literal("stage_start"),
    stage: z.number().int(),
    name: z.string(),
    total: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal("tick"),
    stage: z.number().int(),
    done: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("poll"),
    stage: z.number().int(),
    elapsed_ms: z.number().nonnegative(),
    status: z.string(),
  }),
  z.object({
    type: z.literal("stage_end"),
    stage: z.number().int(),
    name: z.string(),
    duration_ms: z.number().nonnegative(),
    detail: z.string().optional(),
  }),
  z.object({
    type: z.literal("run_complete"),
    run_id: z.string(),
    run_dir: z.string(),
    cost_usd: z.number().nonnegative(),
  }),
  z.object({
    type: z.literal("run_error"),
    name: z.string(),
    message: z.string(),
  }),
]);
export type TestEvent = z.infer<typeof TestEventSchema>;

/** Overall lifecycle of the single tracked run. */
export type RunStatus = "idle" | "running" | "completed" | "error";

/** Per-stage progress as folded from the event stream. */
export type StageState = {
  num: number;
  name: string;
  status: "pending" | "running" | "done";
  done?: number;
  total?: number;
  elapsedMs?: number;
  detail?: string;
};

/**
 * The full client-facing snapshot. The SSE endpoint replays this on connect so
 * a late or reloaded client picks up the in-flight run, then streams deltas.
 */
export type RunSnapshot = {
  status: RunStatus;
  runId?: string;
  fixtureId?: string;
  stages: StageState[];
  costUsd?: number;
  runDir?: string;
  error?: string;
};

/**
 * The SSE message envelope. `snapshot` is sent first (catch-up); `event` carries
 * each subsequent delta alongside the recomputed snapshot so the client can
 * render purely from the latest message.
 */
export type RunMessage = {
  snapshot: RunSnapshot;
  event?: TestEvent;
};
