// author: Claude
/**
 * Machine-readable progress events for `june-eval run --progress-ndjson`.
 *
 * When the flag is set, the run emits one JSON object per line to **stdout**
 * (newline-delimited JSON). Human logs and the `[n/9] stage ok (Xs)` lines stay
 * on stderr, so a parent process (the Next `/test` server) can read structured
 * progress off stdout without untangling it from log noise.
 *
 * The schema is the contract between the bench CLI and any consumer. The Next
 * run-manager re-declares an equivalent Zod schema at its own trust boundary
 * (`packages/next/lib/test/events.ts`) — keep the two in sync.
 */
import { z } from "zod";

/** One pipeline stage, used in `run_start` so a consumer can pre-render the list. */
export const StageDescriptorSchema = z.object({
  num: z.number().int(),
  name: z.string(),
});
export type StageDescriptor = z.infer<typeof StageDescriptorSchema>;

/**
 * The full progress-event union. Discriminated on `type` so consumers can
 * `switch` exhaustively. All numeric counters are non-negative integers; costs
 * are USD floats.
 */
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

/**
 * The progress sink threaded through `runRun`. Every method maps 1:1 to an
 * event variant; `createNdjsonReporter` serializes them, `createNullReporter`
 * drops them so call sites never branch on whether the flag is set.
 */
export type ProgressEventReporter = {
  runStart: (info: { fixture_id: string; run_id: string; stages: readonly StageDescriptor[] }) => void;
  stageStart: (stage: number, name: string, total?: number) => void;
  tick: (stage: number, done: number, total: number) => void;
  poll: (stage: number, elapsed_ms: number, status: string) => void;
  stageEnd: (stage: number, name: string, duration_ms: number, detail?: string) => void;
  runComplete: (info: { run_id: string; run_dir: string; cost_usd: number }) => void;
  runError: (err: { name: string; message: string }) => void;
};

const emit = (event: TestEvent): void => {
  process.stdout.write(`${JSON.stringify(event)}\n`);
};

/**
 * NDJSON reporter — writes each event as a single JSON line to stdout.
 *
 * Used when `--progress-ndjson` is passed. Keeps stdout reserved for events so
 * the consumer can line-split it cleanly.
 */
export const createNdjsonReporter = (): ProgressEventReporter => ({
  runStart: (info) =>
    emit({
      type: "run_start",
      fixture_id: info.fixture_id,
      run_id: info.run_id,
      stages: [...info.stages],
    }),
  stageStart: (stage, name, total) =>
    emit({ type: "stage_start", stage, name, ...(total !== undefined ? { total } : {}) }),
  tick: (stage, done, total) => emit({ type: "tick", stage, done, total }),
  poll: (stage, elapsed_ms, status) => emit({ type: "poll", stage, elapsed_ms, status }),
  stageEnd: (stage, name, duration_ms, detail) =>
    emit({ type: "stage_end", stage, name, duration_ms, ...(detail !== undefined ? { detail } : {}) }),
  runComplete: (info) => emit({ type: "run_complete", ...info }),
  runError: (err) => emit({ type: "run_error", ...err }),
});

/** No-op reporter — the default when `--progress-ndjson` is absent. */
export const createNullReporter = (): ProgressEventReporter => ({
  runStart: () => {},
  stageStart: () => {},
  tick: () => {},
  poll: () => {},
  stageEnd: () => {},
  runComplete: () => {},
  runError: () => {},
});
