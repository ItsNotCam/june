// author: Claude
/**
 * Dashboard data layer — pure, filesystem-only readers over `state/runs/`,
 * `golden.json`, and per-run `progress.ndjson`.
 *
 * The browser cannot read the run directory directly, so the dashboard server
 * (`server.ts`) exposes these functions over a tiny JSON/SSE API. Everything
 * here is read-only and side-effect-free: it parses on-disk artifacts into the
 * **one** shape the frontend consumes, translating between the synthetic
 * `results.json` (`src/types/results.ts`) and the doc-native
 * `holdout_results.json` (`src/types/holdout.ts`), which DO NOT share field
 * names (`fixture_id` vs `holdout_id`, `overall.macro` vs `answerable`, …).
 *
 * Robustness over strictness: a malformed/partial artifact is skipped or
 * downgraded to a `running`/`error` summary rather than throwing — a live run
 * mid-write must never brick the whole list.
 */
import { readFile, readdir, stat } from "fs/promises";
import { join } from "path";
import { fileExists } from "@/lib/artifacts";
import { HOLDOUT_RESULTS_FILENAME, HOLDOUT_SUMMARY_FILENAME } from "@/lib/holdout-paths";
import { TestEventSchema, type TestEvent } from "@/lib/progress-events";
import type { ResultsFile, MetricWithCi } from "@/types/results";
import type { HoldoutResultsFile } from "@/types/holdout";

/** `YYYYMMDDHHMMSS-XXXXXXXX` — the only directory names treated as runs. */
export const RUN_ID_RE = /^\d{14}-[A-Z0-9]+$/;

/** A metric point + its bootstrap CI, with the heavy `query_ids` provenance dropped. */
export type MetricPoint = { point: number; ci_low: number; ci_high: number };

/** Coarse lifecycle status the frontend colors by. */
export type SummaryStatus =
  | "completed"
  | "awaiting_verdicts"
  | "running"
  | "aborted"
  | "error";

/** Provider identity tuples carried through to the UI (cross-judge guard, filters). */
export type ProviderRef = { provider: string; model: string };
export type JudgeRef = { provider: string; model: string; prompt_template_hash: string };

/** The unified per-run summary — identical shape for synthetic and holdout runs. */
export type RunSummary = {
  run_id: string;
  kind: "synthetic" | "holdout";
  status: SummaryStatus;
  /** Raw `run_status` from the file, or null while still running. */
  run_status: string | null;
  started_at: string | null;
  completed_at: string | null;
  /** `control` | `iterate` | `freeform` | null. NEVER mix control & iterate on one trend line. */
  mode: string | null;
  fixture_id: string | null;
  /** Grouping key — metrics are only comparable within one fixture_hash. */
  fixture_hash: string | null;
  reader: ProviderRef | null;
  judge: JudgeRef | null;
  cost_total: number | null;
  /** Headline metrics (synthetic: overall.macro; holdout: answerable.*). */
  overall: {
    reader_correct_pct: MetricPoint | null;
    recall_at_5: MetricPoint | null;
    recall_at_10: MetricPoint | null;
    mrr: MetricPoint | null;
  };
  /** Per-tier reader-correct points (for the per-tier trend + golden baseline overlay). */
  per_tier_correct: Record<string, number>;
  /** Holdout-only signal (retrieval leads; reader is parametric-caveated). */
  holdout?: {
    unanswerable_refused_pct: MetricPoint | null;
    reader_rag_correct_pct: MetricPoint | null;
    reader_norag_correct_pct: MetricPoint | null;
  };
};

/** A golden baseline normalized across the on-disk v1 and the newer v2 schema. */
export type GoldenNormalized = {
  fixture_hash: string;
  run_id: string;
  noise_floor: number;
  /** Per-tier reader-correct baseline points (v2: derived from per_tier[*].reader_correct_pct). */
  per_tier_correct: Record<string, number>;
  /** Present only on v2 goldens; v1 has no judge identity. */
  judge: JudgeRef | null;
  schema_version: 1 | 2;
};

/** The active (in-flight) run the SSE stream tails, plus how its progress is observed. */
export type ActiveRun = {
  run_id: string;
  run_dir: string;
  kind: "synthetic" | "holdout";
  /** "events" → progress.ndjson present; "artifacts" → infer stage from which files exist. */
  observability: "events" | "artifacts";
};

const safeReadJson = async (path: string): Promise<unknown | null> => {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return null;
  }
};

/** Drop `query_ids` from a `MetricWithCi`, tolerating a missing/partial value. */
const toPoint = (m: MetricWithCi | undefined | null): MetricPoint | null => {
  if (!m || typeof m.point !== "number") return null;
  return { point: m.point, ci_low: m.ci_low, ci_high: m.ci_high };
};

const statusFor = (runStatus: string | null): SummaryStatus => {
  if (runStatus === "completed") return "completed";
  if (runStatus === "awaiting_verdicts") return "awaiting_verdicts";
  if (runStatus && runStatus.startsWith("aborted")) return "aborted";
  return "error";
};

const summarizeSynthetic = (runId: string, r: ResultsFile): RunSummary => {
  const macro = r.overall?.macro;
  const perTierCorrect: Record<string, number> = {};
  for (const [tier, agg] of Object.entries(r.per_tier ?? {})) {
    const pt = toPoint(agg?.reader_correct_pct);
    if (pt) perTierCorrect[tier] = pt.point;
  }
  return {
    run_id: runId,
    kind: "synthetic",
    status: statusFor(r.run_status ?? null),
    run_status: r.run_status ?? null,
    started_at: r.started_at ?? null,
    completed_at: r.completed_at ?? null,
    mode: r.manifest?.mode ?? null,
    fixture_id: r.manifest?.fixture_id ?? r.fixture_id ?? null,
    fixture_hash: r.manifest?.fixture_hash ?? null,
    reader: r.manifest?.roles?.reader
      ? { provider: r.manifest.roles.reader.provider, model: r.manifest.roles.reader.model }
      : null,
    judge: r.manifest?.roles?.judge ?? null,
    cost_total: r.cost_usd?.total ?? null,
    overall: {
      reader_correct_pct: toPoint(macro?.reader_correct_pct),
      recall_at_5: toPoint(macro?.recall_at_5),
      recall_at_10: toPoint(macro?.recall_at_10),
      mrr: toPoint(macro?.mrr),
    },
    per_tier_correct: perTierCorrect,
  };
};

const summarizeHoldout = (runId: string, h: HoldoutResultsFile): RunSummary => {
  const a = h.answerable;
  return {
    run_id: runId,
    kind: "holdout",
    status: statusFor(h.run_status ?? null),
    run_status: h.run_status ?? null,
    started_at: h.started_at ?? null,
    completed_at: h.completed_at ?? null,
    mode: h.manifest?.mode ?? null,
    fixture_id: h.holdout_id ?? null,
    fixture_hash: h.holdout_hash ?? null,
    reader: h.manifest?.reader
      ? { provider: h.manifest.reader.provider, model: h.manifest.reader.model }
      : null,
    judge: h.manifest?.judge ?? null,
    cost_total: h.cost_usd?.total ?? null,
    // Retrieval leads for holdout; reader_correct is parametric-caveated (carried in `holdout`).
    overall: {
      reader_correct_pct: toPoint(a?.reader_correct_pct),
      recall_at_5: toPoint(a?.recall_at_5),
      recall_at_10: toPoint(a?.recall_at_10),
      mrr: toPoint(a?.mrr),
    },
    per_tier_correct: {},
    holdout: {
      unanswerable_refused_pct: toPoint(h.unanswerable?.reader_refused_pct),
      reader_rag_correct_pct: toPoint(h.reader_rag_correct_pct),
      reader_norag_correct_pct: toPoint(h.reader_norag_correct_pct),
    },
  };
};

/** Summarize a single run dir, or null if it isn't a recognizable run. */
export const summarizeRunDir = async (
  runsRoot: string,
  runId: string,
): Promise<RunSummary | null> => {
  const dir = join(runsRoot, runId);
  const resultsPath = join(dir, "results.json");
  const holdoutPath = join(dir, HOLDOUT_RESULTS_FILENAME);

  if (await fileExists(resultsPath)) {
    const raw = await safeReadJson(resultsPath);
    if (raw && typeof raw === "object") return summarizeSynthetic(runId, raw as ResultsFile);
  }
  if (await fileExists(holdoutPath)) {
    const raw = await safeReadJson(holdoutPath);
    if (raw && typeof raw === "object") return summarizeHoldout(runId, raw as HoldoutResultsFile);
  }

  // No results yet → an in-flight (or aborted-without-results) run. Guess the
  // kind from holdout-specific intermediate artifacts.
  const kind: "synthetic" | "holdout" =
    (await fileExists(join(dir, "holdout_judge_tasks.json"))) ? "holdout" : "synthetic";
  return {
    run_id: runId,
    kind,
    status: "running",
    run_status: null,
    started_at: null,
    completed_at: null,
    mode: null,
    fixture_id: null,
    fixture_hash: null,
    reader: null,
    judge: null,
    cost_total: null,
    overall: { reader_correct_pct: null, recall_at_5: null, recall_at_10: null, mrr: null },
    per_tier_correct: {},
  };
};

/** Enumerate valid run-id directories under `runsRoot`, newest first. */
export const listRunIds = async (runsRoot: string): Promise<string[]> => {
  let entries;
  try {
    entries = await readdir(runsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && RUN_ID_RE.test(e.name))
    .map((e) => e.name)
    .sort()
    .reverse(); // run_id is timestamp-prefixed → lexicographic desc == newest first
};

/** All run summaries, newest first. Unreadable dirs are skipped, never thrown. */
export const listRunSummaries = async (runsRoot: string): Promise<RunSummary[]> => {
  const ids = await listRunIds(runsRoot);
  const out = await Promise.all(ids.map((id) => summarizeRunDir(runsRoot, id).catch(() => null)));
  return out.filter((s): s is RunSummary => s !== null);
};

/** Full run detail: the raw results file (synthetic or holdout) + the rendered summary markdown. */
export const getRunDetail = async (
  runsRoot: string,
  runId: string,
): Promise<{ kind: "synthetic" | "holdout"; results: unknown; summary_md: string | null } | null> => {
  if (!RUN_ID_RE.test(runId)) return null;
  const dir = join(runsRoot, runId);
  const resultsPath = join(dir, "results.json");
  const holdoutPath = join(dir, HOLDOUT_RESULTS_FILENAME);

  if (await fileExists(resultsPath)) {
    const results = await safeReadJson(resultsPath);
    if (results === null) return null;
    const summary_md = await readFile(join(dir, "summary.md"), "utf-8").catch(() => null);
    return { kind: "synthetic", results, summary_md };
  }
  if (await fileExists(holdoutPath)) {
    const results = await safeReadJson(holdoutPath);
    if (results === null) return null;
    const summary_md = await readFile(join(dir, HOLDOUT_SUMMARY_FILENAME), "utf-8").catch(() => null);
    return { kind: "holdout", results, summary_md };
  }
  return null;
};

/** Parse `golden.json`, normalizing both the on-disk v1 and the v2 schema. */
export const loadGolden = async (goldenPath: string): Promise<Record<string, GoldenNormalized>> => {
  const raw = await safeReadJson(goldenPath);
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, GoldenNormalized> = {};
  for (const [fixtureHash, entryRaw] of Object.entries(raw as Record<string, unknown>)) {
    if (!entryRaw || typeof entryRaw !== "object") continue;
    const entry = entryRaw as Record<string, unknown>;
    const noiseFloor = typeof entry["noise_floor"] === "number" ? entry["noise_floor"] : 0;
    const runId = typeof entry["run_id"] === "string" ? entry["run_id"] : "";

    // v2: per_tier is a Record<tier, GoldenTier{reader_correct_pct:{point,...}}> + judge.
    if (entry["per_tier"] && typeof entry["per_tier"] === "object") {
      const perTierCorrect: Record<string, number> = {};
      for (const [tier, t] of Object.entries(entry["per_tier"] as Record<string, unknown>)) {
        const pt = (t as { reader_correct_pct?: { point?: number } })?.reader_correct_pct?.point;
        if (typeof pt === "number") perTierCorrect[tier] = pt;
      }
      const j = entry["judge"] as JudgeRef | undefined;
      out[fixtureHash] = {
        fixture_hash: fixtureHash,
        run_id: runId,
        noise_floor: noiseFloor,
        per_tier_correct: perTierCorrect,
        judge: j && j.model ? j : null,
        schema_version: 2,
      };
      continue;
    }

    // v1: flat per_tier_correct scalars, no judge.
    if (entry["per_tier_correct"] && typeof entry["per_tier_correct"] === "object") {
      const perTierCorrect: Record<string, number> = {};
      for (const [tier, v] of Object.entries(entry["per_tier_correct"] as Record<string, unknown>)) {
        if (typeof v === "number") perTierCorrect[tier] = v;
      }
      out[fixtureHash] = {
        fixture_hash: fixtureHash,
        run_id: runId,
        noise_floor: noiseFloor,
        per_tier_correct: perTierCorrect,
        judge: null,
        schema_version: 1,
      };
    }
  }
  return out;
};

/**
 * The newest run dir with no results file yet — the candidate in-flight run.
 *
 * Returns null when nothing is active. A dir is only considered active if its
 * `progress.ndjson` (or the dir itself, as a fallback) was touched within
 * `staleMs`, so an aborted-without-results dir doesn't masquerade as live.
 */
export const detectActiveRun = async (
  runsRoot: string,
  staleMs = 120_000,
  nowMs?: number,
): Promise<ActiveRun | null> => {
  const ids = await listRunIds(runsRoot);
  const now = nowMs ?? Date.now();
  for (const runId of ids) {
    const dir = join(runsRoot, runId);
    if (await fileExists(join(dir, "results.json"))) return null; // newest is done → idle
    if (await fileExists(join(dir, HOLDOUT_RESULTS_FILENAME))) return null;

    const progressPath = join(dir, "progress.ndjson");
    const hasEvents = await fileExists(progressPath);
    const watched = hasEvents ? progressPath : dir;
    let mtimeMs: number;
    try {
      mtimeMs = (await stat(watched)).mtimeMs;
    } catch {
      continue;
    }
    if (now - mtimeMs > staleMs) return null; // newest in-flight dir is stale → idle
    const kind: "synthetic" | "holdout" =
      (await fileExists(join(dir, "holdout_judge_tasks.json"))) ? "holdout" : "synthetic";
    return { run_id: runId, run_dir: dir, kind, observability: hasEvents ? "events" : "artifacts" };
  }
  return null;
};

/** Parse a run's `progress.ndjson` into validated events; null if the file is absent. */
export const readProgressEvents = async (runDir: string): Promise<TestEvent[] | null> => {
  let body: string;
  try {
    body = await readFile(join(runDir, "progress.ndjson"), "utf-8");
  } catch {
    return null;
  }
  const events: TestEvent[] = [];
  for (const line of body.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = TestEventSchema.safeParse(JSON.parse(line));
      if (parsed.success) events.push(parsed.data);
    } catch {
      // a half-written final line during a live tail — ignore
    }
  }
  return events;
};

/** Stage roster mirrored from cli/run.ts `RUN_STAGES` (the artifact-inference fallback). */
export const STAGE_ARTIFACTS: ReadonlyArray<{ stage: number; name: string; file: string }> = [
  { stage: 4, name: "ingest", file: "ingest_manifest.json" },
  { stage: 5, name: "ground-truth resolution", file: "ground_truth.json" },
  { stage: 6, name: "retrieval evaluation", file: "retrieval_results.json" },
  { stage: 7, name: "reader evaluation", file: "reader_answers.json" },
  { stage: 8, name: "judging", file: "judge_results.json" },
  { stage: 9, name: "scoring + report", file: "results.json" },
];

/**
 * Coarse current-stage inference from which artifacts exist — the fallback for
 * holdout runs and any run predating the progress.ndjson sink. Returns the
 * highest stage whose output file is present (0 = nothing yet).
 */
export const inferStageFromArtifacts = async (runDir: string): Promise<number> => {
  let highest = 0;
  for (const s of STAGE_ARTIFACTS) {
    if (await fileExists(join(runDir, s.file))) highest = s.stage;
  }
  if (await fileExists(join(runDir, HOLDOUT_RESULTS_FILENAME))) highest = 9;
  return highest;
};
