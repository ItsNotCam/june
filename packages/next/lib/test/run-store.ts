// author: Claude
/**
 * Read-only view over the bench run-dirs on disk (server-only).
 *
 * Each run lives in `<runsDir>/<run_id>/`. Bench writes one artifact per stage
 * plus `results.json`/`summary.md` at the end; the run-manager additionally
 * saves `progress.ndjson` + `progress.stderr.log` for UI-launched runs. This
 * module turns that directory into a list item and a detail object — it never
 * writes anything.
 */
import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import { z } from "zod";
import { getTestConfig } from "./env";
import { TestEventSchema, type TestEvent } from "./events";

/** Stage roster, paired with the artifact whose presence proves completion. */
const STAGE_ARTIFACTS = [
  { num: 4, name: "ingest", file: "ingest_manifest.json" },
  { num: 5, name: "ground-truth resolution", file: "ground_truth.json" },
  { num: 6, name: "retrieval evaluation", file: "retrieval_results.json" },
  { num: 7, name: "reader evaluation", file: "reader_answers.json" },
  { num: 8, name: "judging (batch)", file: "judge_results.json" },
  { num: 9, name: "scoring + report", file: "results.json" },
] as const;

/** run_id format guard — bench ids are uppercase-alnum; reject anything with path separators. */
const RUN_ID_RE = /^[A-Za-z0-9._-]+$/;
/** Bound the saved event log returned to the client. */
const MAX_EVENTS = 2000;
/** Bound the stderr tail returned to the client (chars). */
const STDERR_TAIL = 16_000;

/** Minimal slice of results.json we actually surface — loose so schema drift doesn't break listing. */
const ResultsSummarySchema = z.object({
  run_status: z.string(),
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
  fixture_id: z.string().optional(),
  cost_usd: z.object({ total: z.number() }).optional(),
  overall: z
    .object({
      macro: z
        .object({
          reader_correct_pct: z.object({ point: z.number() }).optional(),
          recall_at_5: z.object({ point: z.number() }).optional(),
          mrr: z.object({ point: z.number() }).optional(),
        })
        .optional(),
    })
    .optional(),
});

/** A run reduced to "in progress in this server" / on-disk terminal / interrupted / empty. */
export type DiskRunStatus = "running" | "completed" | "aborted" | "incomplete" | "empty";

export type RunListItem = {
  runId: string;
  status: DiskRunStatus;
  /** The verbatim results.json run_status when present (e.g. aborted_integrity_judge). */
  runStatusRaw?: string;
  fixtureId?: string;
  startedAt?: string;
  completedAt?: string;
  costUsd?: number;
  stagesComplete: number;
  totalStages: number;
};

export type RunStageState = {
  num: number;
  name: string;
  done: boolean;
};

export type RunDetail = RunListItem & {
  stages: RunStageState[];
  metrics?: {
    readerCorrectPct?: number;
    recallAt5?: number;
    mrr?: number;
  };
  summaryMd?: string;
  events?: TestEvent[];
  stderr?: string;
};

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const readJsonLoose = async (path: string): Promise<unknown | undefined> => {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as unknown;
  } catch {
    return undefined;
  }
};

const deriveStatus = (
  results: z.infer<typeof ResultsSummarySchema> | undefined,
  stagesComplete: number,
): DiskRunStatus => {
  if (results) return results.run_status === "completed" ? "completed" : "aborted";
  if (stagesComplete > 0) return "incomplete";
  return "empty";
};

const buildListItem = async (runId: string, dir: string): Promise<RunListItem> => {
  const present = await Promise.all(
    STAGE_ARTIFACTS.map((s) => fileExists(join(dir, s.file))),
  );
  const stagesComplete = present.filter(Boolean).length;

  const rawResults = await readJsonLoose(join(dir, "results.json"));
  const parsed = rawResults ? ResultsSummarySchema.safeParse(rawResults) : undefined;
  const results = parsed?.success ? parsed.data : undefined;

  return {
    runId,
    status: deriveStatus(results, stagesComplete),
    runStatusRaw: results?.run_status,
    fixtureId: results?.fixture_id,
    startedAt: results?.started_at,
    completedAt: results?.completed_at,
    costUsd: results?.cost_usd?.total,
    stagesComplete,
    totalStages: STAGE_ARTIFACTS.length,
  };
};

/**
 * Lists every run-dir under the configured runs directory, newest first.
 * Returns an empty array when the directory does not exist yet (no runs).
 */
export const listRuns = async (): Promise<RunListItem[]> => {
  const { runsDir } = getTestConfig();
  let entries: string[];
  try {
    entries = (await readdir(runsDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && RUN_ID_RE.test(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
  const items = await Promise.all(entries.map((name) => buildListItem(name, join(runsDir, name))));
  // started_at is ISO-8601, so lexicographic sort is chronological; missing sorts last.
  return items.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
};

/**
 * Returns the full detail for one run (timeline, metrics, summary, saved logs),
 * or `undefined` if the run-dir does not exist. Rejects ids containing path
 * separators to prevent traversal outside the runs directory.
 */
export const getRunDetail = async (runId: string): Promise<RunDetail | undefined> => {
  if (!RUN_ID_RE.test(runId)) return undefined;
  const { runsDir } = getTestConfig();
  const dir = join(runsDir, runId);
  if (!(await fileExists(dir))) return undefined;

  const item = await buildListItem(runId, dir);
  const stages: RunStageState[] = await Promise.all(
    STAGE_ARTIFACTS.map(async (s) => ({
      num: s.num,
      name: s.name,
      done: await fileExists(join(dir, s.file)),
    })),
  );

  const rawResults = await readJsonLoose(join(dir, "results.json"));
  const parsed = rawResults ? ResultsSummarySchema.safeParse(rawResults) : undefined;
  const macro = parsed?.success ? parsed.data.overall?.macro : undefined;
  const metrics = macro
    ? {
        readerCorrectPct: macro.reader_correct_pct?.point,
        recallAt5: macro.recall_at_5?.point,
        mrr: macro.mrr?.point,
      }
    : undefined;

  const summaryMd = (await fileExists(join(dir, "summary.md")))
    ? await readFile(join(dir, "summary.md"), "utf-8")
    : undefined;

  const events = await readEventLog(join(dir, "progress.ndjson"));

  const stderr = (await fileExists(join(dir, "progress.stderr.log")))
    ? (await readFile(join(dir, "progress.stderr.log"), "utf-8")).slice(-STDERR_TAIL)
    : undefined;

  return { ...item, stages, metrics, summaryMd, events, stderr };
};

const readEventLog = async (path: string): Promise<TestEvent[] | undefined> => {
  if (!(await fileExists(path))) return undefined;
  const lines = (await readFile(path, "utf-8")).split("\n").filter(Boolean).slice(-MAX_EVENTS);
  const events: TestEvent[] = [];
  for (const line of lines) {
    try {
      const parsed = TestEventSchema.safeParse(JSON.parse(line));
      if (parsed.success) events.push(parsed.data);
    } catch {
      // Skip a corrupt/partial trailing line — best-effort log replay.
    }
  }
  return events;
};
