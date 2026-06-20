// author: Claude
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  listRunSummaries,
  loadGolden,
  detectActiveRun,
  inferStageFromArtifacts,
  getRunDetail,
  readRunLog,
} from "@/dashboard/reader";
import { startDashboardServer } from "@/dashboard/server";

/**
 * Data-layer + light integration tests for the dashboard. We seed a temp
 * state/runs dir with one synthetic run, one holdout run, and one in-flight run,
 * plus a v1 golden.json — the exact mix the on-disk dashboard reads — and assert
 * the unified summaries, golden normalization, active-run detection, and that
 * the Bun.serve API returns those shapes over HTTP.
 */

const metric = (point: number) => ({ point, ci_low: point - 0.05, ci_high: point + 0.05, query_ids: [] });

const SYNTH_ID = "20260101120000-AAAA1111";
const HOLD_ID = "20260102120000-BBBB2222";
const ACTIVE_ID = "20260103120000-CCCC3333";

const syntheticResults = {
  fixture_id: "fix-synth",
  run_id: SYNTH_ID,
  schema_version: 1,
  run_status: "completed",
  started_at: "2026-01-01T12:00:00Z",
  completed_at: "2026-01-01T12:10:00Z",
  manifest: {
    fixture_id: "fix-synth",
    fixture_hash: "hash-synth",
    mode: "control",
    roles: {
      reader: { provider: "ollama", model: "gemma4:26b", temperature: 0 },
      judge: { provider: "external", model: "claude-sonnet-4-6", prompt_template_hash: "abc" },
    },
    june: { embedding_model: "snowflake-arctic-embed2" },
  },
  per_query: [],
  per_tier: {
    T1: { query_count: 6, recall_at_1: metric(1), recall_at_5: metric(1), recall_at_10: metric(1), mrr: metric(1), reader_correct_pct: metric(1), reader_hallucinated_pct: metric(0), reader_refused_pct: metric(0), unjudged_pct: 0, t5_top1_score_median: null },
    T4: { query_count: 6, recall_at_1: metric(0.8), recall_at_5: metric(0.9), recall_at_10: metric(0.95), mrr: metric(0.85), reader_correct_pct: metric(0.9), reader_hallucinated_pct: metric(0), reader_refused_pct: metric(0.1), unjudged_pct: 0, t5_top1_score_median: null },
  },
  overall: {
    macro: { reader_correct_pct: metric(0.83), recall_at_5: metric(0.92), recall_at_10: metric(0.96), mrr: metric(0.88) },
    micro: { reader_correct_pct: metric(0.83), recall_at_5: metric(0.92), recall_at_10: metric(0.96), mrr: metric(0.88) },
  },
  integrity: { unresolved_pct: 0, embedding_pct: 0, unjudged_pct: 0, queries_with_leakage_warning: 0 },
  cost_usd: { role_1: 0, role_2: 0, role_3: 0.12, role_4: 0, total: 0.12 },
};

const holdoutResults = {
  kind: "holdout",
  sealed: true,
  holdout_id: "hold-real",
  holdout_hash: "hash-hold",
  run_id: HOLD_ID,
  schema_version: 1,
  run_status: "completed",
  started_at: "2026-01-02T12:00:00Z",
  completed_at: "2026-01-02T12:10:00Z",
  manifest: {
    holdout_id: "hold-real",
    holdout_hash: "hash-hold",
    mode: "control",
    reader: { provider: "ollama", model: "gemma4:26b", temperature: 0 },
    judge: { provider: "external", model: "claude-sonnet-4-6", prompt_template_hash: "abc" },
    source: { name: "Next.js docs", url: "https://nextjs.org", doc_count: 19 },
  },
  answerable: {
    query_count: 34,
    recall_at_1: metric(0.6), recall_at_5: metric(0.75), recall_at_10: metric(0.82), mrr: metric(0.68),
    reader_correct_pct: metric(0.7),
  },
  unanswerable: { query_count: 6, reader_refused_pct: metric(0.83), top1_score_median: 0.4 },
  reader_rag_correct_pct: metric(0.7),
  reader_norag_correct_pct: metric(0.65),
  per_query: [],
  integrity: { unjudged_pct: 0, queries_with_unknown_doc: 0 },
  cost_usd: { role_1: 0, role_2: 0, role_3: 0.2, role_4: 0, total: 0.2 },
};

const goldenV1 = {
  "hash-synth": {
    run_id: SYNTH_ID,
    fixture_hash: "hash-synth",
    noise_floor: 0.05,
    per_tier_correct: { T1: 1, T4: 0.9 },
    note: "v1 pinned baseline",
  },
};

let root: string;
let runsRoot: string;
let goldenPath: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "june-dash-"));
  runsRoot = join(root, "runs");
  goldenPath = join(root, "golden.json");

  await mkdir(join(runsRoot, SYNTH_ID), { recursive: true });
  await writeFile(join(runsRoot, SYNTH_ID, "results.json"), JSON.stringify(syntheticResults));
  await writeFile(join(runsRoot, SYNTH_ID, "summary.md"), "# synthetic summary\nok");

  await mkdir(join(runsRoot, HOLD_ID), { recursive: true });
  await writeFile(join(runsRoot, HOLD_ID, "holdout_results.json"), JSON.stringify(holdoutResults));

  // in-flight run: a dir reached stage 6 (retrieval) with a fresh progress.ndjson, no results yet
  await mkdir(join(runsRoot, ACTIVE_ID), { recursive: true });
  await writeFile(join(runsRoot, ACTIVE_ID, "ingest_manifest.json"), "{}");
  await writeFile(join(runsRoot, ACTIVE_ID, "ground_truth.json"), "{}");
  await writeFile(join(runsRoot, ACTIVE_ID, "retrieval_results.json"), "{}");
  await writeFile(
    join(runsRoot, ACTIVE_ID, "progress.ndjson"),
    `${JSON.stringify({ type: "run_start", fixture_id: "fix-synth", run_id: ACTIVE_ID, stages: [{ num: 4, name: "ingest" }] })}\n${JSON.stringify({ type: "stage_start", stage: 6, name: "retrieval evaluation" })}\n`,
  );
  await writeFile(
    join(runsRoot, ACTIVE_ID, "run.log"),
    "12:00:00.001 | 💬 info  | stage.4.spawn  subcommand=\"ingest\"\n12:00:01.002 | ⚠️  warn  | stage.4.retry  attempt=2\n",
  );

  await writeFile(goldenPath, JSON.stringify(goldenV1));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("listRunSummaries", () => {
  test("returns synthetic + holdout + running, newest first", async () => {
    const runs = await listRunSummaries(runsRoot);
    expect(runs.map((r) => r.run_id)).toEqual([ACTIVE_ID, HOLD_ID, SYNTH_ID]);
  });

  test("synthetic summary maps mode, fixture, overall, per-tier correct", async () => {
    const runs = await listRunSummaries(runsRoot);
    const s = runs.find((r) => r.run_id === SYNTH_ID)!;
    expect(s.kind).toBe("synthetic");
    expect(s.mode).toBe("control");
    expect(s.fixture_hash).toBe("hash-synth");
    expect(s.reader?.model).toBe("gemma4:26b");
    expect(s.judge?.model).toBe("claude-sonnet-4-6");
    expect(s.overall.reader_correct_pct?.point).toBeCloseTo(0.83);
    expect(s.per_tier_correct).toEqual({ T1: 1, T4: 0.9 });
    expect(s.cost_total).toBeCloseTo(0.12);
  });

  test("holdout summary translates holdout_id/hash and answerable→overall", async () => {
    const runs = await listRunSummaries(runsRoot);
    const h = runs.find((r) => r.run_id === HOLD_ID)!;
    expect(h.kind).toBe("holdout");
    expect(h.fixture_id).toBe("hold-real");
    expect(h.fixture_hash).toBe("hash-hold");
    expect(h.overall.recall_at_5?.point).toBeCloseTo(0.75);
    expect(h.holdout?.reader_norag_correct_pct?.point).toBeCloseTo(0.65);
    expect(h.holdout?.unanswerable_refused_pct?.point).toBeCloseTo(0.83);
  });

  test("in-flight run with no results is marked running", async () => {
    const runs = await listRunSummaries(runsRoot);
    const a = runs.find((r) => r.run_id === ACTIVE_ID)!;
    expect(a.status).toBe("running");
  });
});

describe("loadGolden", () => {
  test("normalizes the v1 (flat per_tier_correct) schema, no judge", async () => {
    const golden = await loadGolden(goldenPath);
    expect(golden["hash-synth"]?.schema_version).toBe(1);
    expect(golden["hash-synth"]?.noise_floor).toBeCloseTo(0.05);
    expect(golden["hash-synth"]?.per_tier_correct).toEqual({ T1: 1, T4: 0.9 });
    expect(golden["hash-synth"]?.judge).toBeNull();
  });

  test("normalizes a v2 entry (per_tier with reader_correct_pct + judge)", async () => {
    const v2Path = join(root, "golden-v2.json");
    await writeFile(
      v2Path,
      JSON.stringify({
        "hash-x": {
          schema_version: 2,
          run_id: "r",
          fixture_hash: "hash-x",
          noise_floor: 0.04,
          judge: { provider: "external", model: "deepseek-v4-pro", prompt_template_hash: "z" },
          per_tier: { T1: { query_count: 6, reader_correct_pct: { point: 0.95, ci_low: 0.9, ci_high: 1 }, recall_at_1: { point: 1, ci_low: 1, ci_high: 1 }, recall_at_5: { point: 1, ci_low: 1, ci_high: 1 }, mrr: { point: 1, ci_low: 1, ci_high: 1 } } },
        },
      }),
    );
    const golden = await loadGolden(v2Path);
    expect(golden["hash-x"]?.schema_version).toBe(2);
    expect(golden["hash-x"]?.per_tier_correct).toEqual({ T1: 0.95 });
    expect(golden["hash-x"]?.judge?.model).toBe("deepseek-v4-pro");
  });

  test("missing golden file → empty registry, no throw", async () => {
    expect(await loadGolden(join(root, "nope.json"))).toEqual({});
  });
});

describe("active run + stage inference", () => {
  test("detectActiveRun finds the newest no-results dir with fresh progress", async () => {
    const active = await detectActiveRun(runsRoot);
    expect(active?.run_id).toBe(ACTIVE_ID);
    expect(active?.observability).toBe("events");
  });

  test("a stale in-flight dir is not reported as active", async () => {
    // pretend 'now' is far in the future → the progress.ndjson mtime is stale
    const active = await detectActiveRun(runsRoot, 1000, Date.now() + 1_000_000_000);
    expect(active).toBeNull();
  });

  test("a holdout-shaped run (only run.log, no progress.ndjson) is active via run.log mtime", async () => {
    // A run mid stage-4 ingest writes NOTHING new into the run dir — only appends
    // run.log — so the dir mtime is frozen at creation. Liveness must come from
    // the freshly-appended run.log, else the run vanishes from the dashboard.
    const HOLDOUT_ACTIVE = "20260104120000-DDDD4444";
    const dir = join(runsRoot, HOLDOUT_ACTIVE);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "holdout_judge_tasks.json"), "{}");
    await writeFile(join(dir, "run.log"), "12:00:00.001 | 💬 info  | stage.4.spawn\n");
    try {
      const active = await detectActiveRun(runsRoot);
      expect(active?.run_id).toBe(HOLDOUT_ACTIVE);
      expect(active?.kind).toBe("holdout");
      expect(active?.observability).toBe("artifacts"); // no progress.ndjson
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("inferStageFromArtifacts returns the highest reached stage", async () => {
    expect(await inferStageFromArtifacts(join(runsRoot, ACTIVE_ID))).toBe(6);
    expect(await inferStageFromArtifacts(join(runsRoot, SYNTH_ID))).toBe(9);
  });
});

describe("readRunLog", () => {
  test("tails the run.log lines, oldest first", async () => {
    const log = await readRunLog(runsRoot, ACTIVE_ID);
    expect(log.present).toBe(true);
    expect(log.truncated).toBe(false);
    expect(log.lines).toHaveLength(2);
    expect(log.lines[0]).toContain("stage.4.spawn");
    expect(log.lines[1]).toContain("stage.4.retry");
  });

  test("absent run.log → present:false, no throw", async () => {
    const log = await readRunLog(runsRoot, SYNTH_ID);
    expect(log).toEqual({ present: false, lines: [], truncated: false });
  });

  test("oversized log is byte-capped and flagged truncated", async () => {
    const big = Array.from({ length: 500 }, (_, i) => `line ${i} ${"x".repeat(200)}`).join("\n");
    await writeFile(join(runsRoot, ACTIVE_ID, "run.log"), big);
    const log = await readRunLog(runsRoot, ACTIVE_ID, 4_000, 100);
    expect(log.truncated).toBe(true);
    expect(log.lines.length).toBeLessThanOrEqual(100);
    // restore the small fixture for any later-running test
    await writeFile(
      join(runsRoot, ACTIVE_ID, "run.log"),
      "12:00:00.001 | 💬 info  | stage.4.spawn  subcommand=\"ingest\"\n12:00:01.002 | ⚠️  warn  | stage.4.retry  attempt=2\n",
    );
  });

  test("rejects a malformed run id", async () => {
    expect(await readRunLog(runsRoot, "../etc/passwd")).toEqual({ present: false, lines: [], truncated: false });
  });
});

describe("getRunDetail", () => {
  test("synthetic detail carries results + summary_md", async () => {
    const d = await getRunDetail(runsRoot, SYNTH_ID);
    expect(d?.kind).toBe("synthetic");
    expect(d?.summary_md).toContain("synthetic summary");
  });

  test("rejects a malformed run id", async () => {
    expect(await getRunDetail(runsRoot, "../etc/passwd")).toBeNull();
  });
});

describe("HTTP API (Bun.serve)", () => {
  test("serves /api/runs and /api/golden over an ephemeral port", async () => {
    const server = startDashboardServer({ port: 0, runsRoot, goldenPath });
    try {
      const runs = (await fetch(`http://localhost:${server.port}/api/runs`).then((r) => r.json())) as unknown[];
      expect(runs).toHaveLength(3);
      const golden = (await fetch(`http://localhost:${server.port}/api/golden`).then((r) => r.json())) as Record<string, { per_tier_correct: Record<string, number> }>;
      expect(golden["hash-synth"]!.per_tier_correct["T1"]).toBe(1);
      const detail = (await fetch(`http://localhost:${server.port}/api/runs/${SYNTH_ID}`).then((r) => r.json())) as { kind: string };
      expect(detail.kind).toBe("synthetic");
      const bad = await fetch(`http://localhost:${server.port}/api/runs/not-a-run`);
      expect(bad.status).toBe(400);
      const log = (await fetch(`http://localhost:${server.port}/api/runs/${ACTIVE_ID}/log`).then((r) => r.json())) as { present: boolean; lines: string[] };
      expect(log.present).toBe(true);
      expect(log.lines.length).toBeGreaterThan(0);
    } finally {
      server.stop(true);
    }
  });
});
