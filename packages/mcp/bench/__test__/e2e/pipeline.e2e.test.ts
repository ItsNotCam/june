// author: Claude
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Database } from "bun:sqlite";
import type { FactsFile } from "@/types/facts";
import type { QueriesFile } from "@/types/query";
import type { GroundTruthFile } from "@/types/ground-truth";
import type { ReaderAnswersFile } from "@/types/reader";
import type { RetrievalResult } from "@/types/retrieval";
import type { Retriever } from "@/retriever/types";
import type { JudgeTasksFile } from "@/types/judge-tasks";
import type { ResultsFile, RunManifest, RunStatus } from "@/types/results";
import type { VerdictRecord } from "@/types/judge";
import { runStage6 } from "@/stages/06-retrieval";
import { buildJudgeTasks } from "@/stages/08-judge";
import { runStage9 } from "@/stages/09-score";
import { BudgetMeter } from "@/lib/cost";
import { loadConfig } from "@/lib/config";
import { readJson } from "@/lib/artifacts";
import { runScore } from "../../cli/score";
import { writeTestConfig } from "../helpers";

/**
 * Hermetic end-to-end test (RSI-foundation Phase 7).
 *
 * Drives the WHOLE no-API eval pipeline over a TINY frozen fixture, wired exactly
 * as `june-eval run --judge external` + `june-eval score` wire it — but with the
 * two live dependencies replaced by hermetic stand-ins so CI never needs Qdrant,
 * Ollama, or a june subprocess (and never an API key):
 *   - the retriever is a deterministic FAKE returning a committed ranking;
 *   - the reader answers are a committed fixture (the reader is the live SUT — a
 *     hermetic run feeds canned answers; this test grades the SCAFFOLD, not gemma).
 *
 * Flow: runStage6 (retrieval scoring) → buildJudgeTasks (emit self-contained
 * judge_tasks.json) → runStage9 (partial, awaiting_verdicts) → `score` overlays the
 * COMMITTED verdicts.json (what the orchestrator's agents would return) → finalized
 * results.json. The whole chain calls zero provider code by construction — the
 * no-API guarantee proven, not just asserted.
 */

const FIX = join(import.meta.dir, "fixtures");
const RUN_ID = "e2e-mini-run-1"; // must match fixtures/verdicts.json run_id

let cfgPath: string;
let scratchDir: string;
let facts: FactsFile;
let queries: QueriesFile;
let ground_truth: GroundTruthFile;
let reader: ReaderAnswersFile;
let retrieverOutput: Record<string, string[]>;

/** Deterministic stand-in for the stopgap/Qdrant retriever — pure lookup, no I/O. */
const makeFakeRetriever = (byText: Map<string, string[]>): Retriever => ({
  name: "e2e-fake",
  config_snapshot: { fusion: "rrf", dense_weight: 0.6, bm25_weight: 0.4, rank_constant: 60 },
  retrieve: async (queryText: string, k: number): Promise<RetrievalResult[]> => {
    const ids = byText.get(queryText) ?? [];
    return ids.slice(0, k).map((chunk_id, i) => ({
      chunk_id,
      score: 1 / (i + 1),
      rank_source: "dense" as const,
    }));
  },
});

const buildManifest = (run_id: string): RunManifest => ({
  fixture_id: facts.fixture_id,
  fixture_hash: "e2e-fixture-hash",
  fixture_seed: facts.fixture_seed,
  run_id,
  bench_version: "0.1.0",
  schema_version: 1,
  started_at: "2026-06-17T00:00:00Z",
  completed_at: "",
  mode: "control",
  roles: {
    corpus_author: { provider: "claude-code-agent", model: "sonnet" },
    query_author: { provider: "claude-code-agent", model: "opus" },
    reader: { provider: "ollama", model: "gemma4:26b", temperature: 0 },
    // Stamp the same judge prompt hash the committed verdicts carry so `score`
    // does not warn about a prompt mismatch (the cross-judge guard's key).
    judge: {
      provider: "external",
      model: "(pending)",
      prompt_template_hash: "cbba4ecceba82690f09209b76e1fd9b8aa5306f6e54b04b1d0d7a8850d4b3e77",
    },
    baseline: null,
  },
  june: {
    ingest_run_id: "e2e-ingest",
    schema_version: 1,
    embedding_model: "e2e-fake-embedder",
    embedding_model_version: "1",
  },
  retrieval_config_snapshot: {},
  caching_enabled: false,
  budget_cap_usd: 5,
});

/**
 * Runs the full hermetic pipeline into a fresh run-dir and finalizes it via the
 * real `score` command. Returns the run-dir + the partial (pre-score) and final
 * (post-score) results so individual tests can assert against either stage.
 */
const runPipeline = async (run_id: string): Promise<{
  run_dir: string;
  tasks: JudgeTasksFile;
  partial: ResultsFile;
  final: ResultsFile;
}> => {
  const run_dir = await mkdtemp(join(tmpdir(), "bench-e2e-run-"));
  const resultsPath = join(run_dir, "results.json");
  const summaryPath = join(run_dir, "summary.md");

  const byText = new Map(queries.queries.map((q) => [q.text, retrieverOutput[q.id] ?? []]));
  const retriever = makeFakeRetriever(byText);

  // Stage 6 — deterministic retrieval scoring (no reader/judge).
  const retrieval = await runStage6({
    facts,
    queries,
    ground_truth,
    retriever,
    ingest_run_id: "e2e-ingest",
    out_path: join(run_dir, "retrieval_results.json"),
  });

  // Stage 8 — emit the self-contained judge tasks (context pre-rendered from june.db).
  const tasks = await buildJudgeTasks({
    facts,
    queries,
    reader,
    baseline: null,
    run_id,
    scratch_path: scratchDir,
    out_path: join(run_dir, "judge_tasks.json"),
  });

  // Stage 9 (partial) — retrieval metrics final, every answer UNJUDGED.
  const pendingVerdicts: VerdictRecord[] = reader.answers.map((a) => ({
    query_id: a.query_id,
    verdict: "UNJUDGED" as const,
    rationale: "",
    unjudged_reason: "awaiting external judge",
  }));
  await runStage9({
    facts,
    queries,
    ground_truth,
    retrieval,
    reader,
    baseline: null,
    judge: {
      fixture_id: facts.fixture_id,
      judge: { provider: "deepseek", model: "", batch_api: false },
      verdicts: pendingVerdicts,
    },
    manifest: buildManifest(run_id),
    run_status: "awaiting_verdicts" satisfies RunStatus,
    budget: new BudgetMeter(),
    leakage_warning_count: 0,
    results_path: resultsPath,
    summary_path: summaryPath,
  });
  const partial = (await readJson(resultsPath)) as ResultsFile;

  // `score` — overlay the COMMITTED agent verdicts and finalize (the real CLI path).
  await runScore([run_dir, "--verdicts", join(FIX, "verdicts.json"), "--config", cfgPath]);
  const final = (await readJson(resultsPath)) as ResultsFile;

  return { run_dir, tasks, partial, final };
};

beforeAll(async () => {
  cfgPath = await writeTestConfig();
  await loadConfig(cfgPath);

  facts = (await readJson(join(FIX, "facts.json"))) as FactsFile;
  queries = (await readJson(join(FIX, "queries.json"))) as QueriesFile;
  ground_truth = (await readJson(join(FIX, "ground-truth.json"))) as GroundTruthFile;
  reader = (await readJson(join(FIX, "reader.json"))) as ReaderAnswersFile;
  retrieverOutput = (await readJson(join(FIX, "retriever-output.json"))) as Record<string, string[]>;

  // Seed the tiny june.db the judge-task renderer reads chunk text from.
  scratchDir = await mkdtemp(join(tmpdir(), "bench-e2e-scratch-"));
  const chunks = (await readJson(join(FIX, "chunks.json"))) as Array<{ chunk_id: string; raw_content: string }>;
  const db = new Database(join(scratchDir, "june.db"));
  db.run(`CREATE TABLE chunks (chunk_id TEXT PRIMARY KEY, raw_content TEXT NOT NULL)`);
  for (const c of chunks) db.run(`INSERT INTO chunks (chunk_id, raw_content) VALUES (?, ?)`, [c.chunk_id, c.raw_content]);
  db.close();
});

describe("hermetic e2e — run → emit tasks → score, end-to-end invariants", () => {
  test("Stage 6 scores retrieval deterministically and correctly per tier", async () => {
    const { partial } = await runPipeline(RUN_ID);
    // T1: expected chunk at rank 1 → perfect recall + MRR.
    expect(partial.per_tier.T1.recall_at_5.point).toBe(1);
    expect(partial.per_tier.T1.recall_at_1.point).toBe(1);
    expect(partial.per_tier.T1.mrr.point).toBe(1);
    // T3: expected chunk at rank 2 → missed @1, present @3/@5, MRR 0.5.
    expect(partial.per_tier.T3.recall_at_1.point).toBe(0);
    expect(partial.per_tier.T3.recall_at_5.point).toBe(1);
    expect(partial.per_tier.T3.mrr.point).toBeCloseTo(0.5, 6);
  });

  test("judge_tasks.json is self-contained — context pre-rendered, prompt hash stamped, no DB needed downstream", async () => {
    const { tasks } = await runPipeline(RUN_ID);
    // No baseline pass → one task per query.
    expect(tasks.tasks).toHaveLength(queries.queries.length);
    expect(tasks.prompt_template_hash).toMatch(/^[0-9a-f]{64}$/);
    const t1 = tasks.tasks.find((t) => t.query_id === "q-T1")!;
    // The retrieved chunk's TEXT is inlined — an out-of-process judge needs no SQLite.
    expect(t1.retrieved_context).toContain('<chunk id="chunk-florbix-health">');
    expect(t1.retrieved_context).toContain("port 8421");
    expect(t1.expected_facts).toEqual([
      { surface_hint: "The Florbix module exposes its health endpoint on port 8421" },
    ]);
  });

  test("partial run is honest: retrieval final, correctness pending (unjudged 100%)", async () => {
    const { partial } = await runPipeline(RUN_ID);
    expect(partial.run_status).toBe("awaiting_verdicts");
    expect(partial.integrity.unjudged_pct).toBe(1);
    expect(partial.overall.micro.reader_correct_pct.point).toBe(0);
    // …yet the retrieval signal is already complete.
    expect(partial.per_tier.T1.recall_at_5.point).toBe(1);
  });

  test("score overlays committed verdicts → finalized run, correctness materializes, retrieval untouched", async () => {
    const { partial, final } = await runPipeline(RUN_ID);
    expect(final.run_status).toBe("completed");
    expect(final.integrity.unjudged_pct).toBe(0);
    // All three canned answers are correct (T5's refusal is the right call for an unanswerable).
    expect(final.per_tier.T1.reader_correct_pct.point).toBe(1);
    expect(final.per_tier.T3.reader_correct_pct.point).toBe(1);
    expect(final.per_tier.T5.reader_correct_pct.point).toBe(1);
    expect(final.overall.micro.reader_correct_pct.point).toBe(1);
    // The verdict overlay must NOT perturb the retrieval metrics computed at partial time.
    expect(final.per_tier.T1.recall_at_5).toEqual(partial.per_tier.T1.recall_at_5);
    expect(final.per_tier.T3.mrr).toEqual(partial.per_tier.T3.mrr);
    // The judge identity from verdicts.json is recorded as the cross-judge guard's key.
    expect(final.manifest.roles.judge).toEqual({
      provider: "claude-code-agent",
      model: "claude-sonnet-4-6",
      prompt_template_hash: "cbba4ecceba82690f09209b76e1fd9b8aa5306f6e54b04b1d0d7a8850d4b3e77",
    });
  });

  test("pipeline is deterministic — two independent runs yield an identical metric tree", async () => {
    const a = await runPipeline(RUN_ID);
    const b = await runPipeline(RUN_ID);
    // Same fixture + same run_id (bootstrap seed) ⇒ byte-identical per-tier + overall blocks.
    expect(b.final.per_tier).toEqual(a.final.per_tier);
    expect(b.final.overall).toEqual(a.final.overall);
    expect(b.final.integrity).toEqual(a.final.integrity);
  });
});
