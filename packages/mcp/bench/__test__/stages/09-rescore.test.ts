// author: Claude
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { FactsFile } from "@/types/facts";
import type { QueriesFile } from "@/types/query";
import type { GroundTruthFile } from "@/types/ground-truth";
import type { RetrievalResultsFile } from "@/types/retrieval";
import type { ReaderAnswersFile } from "@/types/reader";
import type { JudgeResultsFile, VerdictRecord } from "@/types/judge";
import type { JudgeProvenance } from "@/types/judge-tasks";
import type { ResultsFile, RunManifest } from "@/types/results";
import { runStage9, rescoreWithVerdicts } from "@/stages/09-score";
import { BudgetMeter } from "@/lib/cost";
import { readJson } from "@/lib/artifacts";
import { loadTestConfig } from "../helpers";

/**
 * The externalized judge path must be NUMERICALLY IDENTICAL to the in-bench
 * path. We score the same fixture two ways:
 *   A) in-bench  — runStage9 with the verdicts inline.
 *   B) external  — runStage9 with EMPTY verdicts (the awaiting_verdicts partial),
 *                  then rescoreWithVerdicts overlays the same verdicts.
 * Same run_id ⇒ same bootstrap seed ⇒ the per-tier/overall MetricWithCi must
 * match exactly. This is the guarantee that moving the judge out of the bench
 * changed the transport, not the measurement.
 */

const RUN_ID = "r-equiv-1";

const facts: FactsFile = {
  fixture_id: "FID",
  fixture_seed: 1,
  schema_version: 1,
  domain_name: "Test",
  generated_at: "2026-01-01T00:00:00Z",
  facts: [],
};

const queries: QueriesFile = {
  fixture_id: "FID",
  schema_version: 1,
  query_author: { provider: "openai", model: "gpt" },
  queries: [
    { id: "q-T1-a", tier: "T1", text: "", expected_fact_ids: ["f1"], anti_leakage_score: null, generation_attempts: 1 },
    { id: "q-T1-b", tier: "T1", text: "", expected_fact_ids: ["f2"], anti_leakage_score: null, generation_attempts: 1 },
    { id: "q-T5-a", tier: "T5", text: "", expected_fact_ids: [], anti_leakage_score: null, generation_attempts: 1 },
    { id: "q-T5-b", tier: "T5", text: "", expected_fact_ids: [], anti_leakage_score: null, generation_attempts: 1 },
  ],
};

const ground_truth: GroundTruthFile = {
  fixture_id: "FID",
  schema_version: 1,
  ingest_run_id: "ir",
  ingest_schema_version: 1,
  ingest_embedding_model: "m",
  resolutions: [],
  integrity: { unresolved_pct: 0, embedding_pct: 0, aborted_over_threshold: false },
};

// T1-a fully retrieved (recall 1), T1-b missed (recall 0) → T1 recall@5 = 0.5.
const recallFor = (id: string): Record<"1" | "3" | "5" | "10", number> =>
  id === "q-T1-a" ? { "1": 1, "3": 1, "5": 1, "10": 1 } : { "1": 0, "3": 0, "5": 0, "10": 0 };

const retrieval: RetrievalResultsFile = {
  fixture_id: "FID",
  ingest_run_id: "ir",
  retriever_config: { adapter: "stopgap", retrieval_config_snapshot: {} },
  results: queries.queries.map((q) => ({
    query_id: q.id,
    retrieved: [],
    recall_at_k: recallFor(q.id),
    mrr: q.id === "q-T1-a" ? 1 : 0,
    t5_top1_score: q.tier === "T5" ? 0.15 : null,
  })),
};

const reader: ReaderAnswersFile = {
  fixture_id: "FID",
  reader: { provider: "ollama", model: "gemma4:26b", temperature: 0 },
  answers: queries.queries.map((q) => ({
    query_id: q.id,
    answer_text: "",
    retrieved_chunk_ids: [],
    latency_ms: 0,
    prompt_tokens: null,
    completion_tokens: null,
  })),
};

// T1-a CORRECT, T1-b INCORRECT → T1 correct = 0.5; T5-a REFUSED (correct),
// T5-b INCORRECT → T5 correct = 0.5; micro = 2/4 = 0.5.
const realVerdicts: VerdictRecord[] = [
  { query_id: "q-T1-a", verdict: "CORRECT", rationale: "", unjudged_reason: null },
  { query_id: "q-T1-b", verdict: "INCORRECT", rationale: "", unjudged_reason: null },
  { query_id: "q-T5-a", verdict: "REFUSED", rationale: "", unjudged_reason: null },
  { query_id: "q-T5-b", verdict: "INCORRECT", rationale: "", unjudged_reason: null },
];

// What `run --judge external` writes into the partial: everything UNJUDGED.
const pendingVerdicts: VerdictRecord[] = queries.queries.map((q) => ({
  query_id: q.id,
  verdict: "UNJUDGED" as const,
  rationale: "",
  unjudged_reason: "awaiting external judge",
}));

const manifest = (judgeProvider: string): RunManifest => ({
  fixture_id: "FID",
  fixture_hash: "h",
  fixture_seed: 1,
  run_id: RUN_ID,
  bench_version: "0.1.0",
  schema_version: 1,
  started_at: "",
  completed_at: "",
  mode: "control",
  roles: {
    corpus_author: { provider: "anthropic", model: "sonnet" },
    query_author: { provider: "openai", model: "gpt" },
    reader: { provider: "ollama", model: "gemma4:26b", temperature: 0 },
    judge: { provider: judgeProvider, model: "(pending)", prompt_template_hash: "hash-A" },
    baseline: null,
  },
  june: { ingest_run_id: "ir", schema_version: 1, embedding_model: "m", embedding_model_version: "" },
  retrieval_config_snapshot: {},
  caching_enabled: false,
  budget_cap_usd: 5,
});

const judgeResults = (verdicts: VerdictRecord[]): JudgeResultsFile => ({
  fixture_id: "FID",
  judge: { provider: "deepseek", model: "x", batch_api: false },
  verdicts,
});

const score = async (verdicts: VerdictRecord[], status: "completed" | "awaiting_verdicts"): Promise<ResultsFile> => {
  const dir = await mkdtemp(join(tmpdir(), "bench-rescore-"));
  const resultsPath = join(dir, "results.json");
  await runStage9({
    facts,
    queries,
    ground_truth,
    retrieval,
    reader,
    baseline: null,
    judge: judgeResults(verdicts),
    manifest: manifest("external"),
    run_status: status,
    budget: new BudgetMeter(),
    leakage_warning_count: 0,
    results_path: resultsPath,
    summary_path: join(dir, "summary.md"),
  });
  return (await readJson(resultsPath)) as ResultsFile;
};

describe("Stage 9 — rescore from external verdicts equals in-bench scoring", () => {
  beforeAll(async () => {
    await loadTestConfig();
  });

  test("partial (empty verdicts) → rescore == full in-bench run", async () => {
    const full = await score(realVerdicts, "completed");
    const partial = await score(pendingVerdicts, "awaiting_verdicts");

    // The partial is honest about being unfinished.
    expect(partial.run_status).toBe("awaiting_verdicts");
    expect(partial.integrity.unjudged_pct).toBe(1);
    expect(partial.per_tier.T1.reader_correct_pct.point).toBe(0);
    // ...but retrieval metrics are already final.
    expect(partial.per_tier.T1.recall_at_5.point).toBe(0.5);

    const provenance: JudgeProvenance = {
      kind: "claude-code-agent",
      model: "claude-sonnet-4-6",
      prompt_template_hash: "hash-A",
      judged_at: "2026-06-17T00:00:00Z",
    };
    const external = rescoreWithVerdicts({
      partial,
      verdicts: realVerdicts,
      judge: provenance,
      run_status: "completed",
      completed_at: "2026-06-17T00:00:00Z",
    });

    // Correctness now matches the in-bench run, CIs included (same seed).
    expect(external.per_tier.T1.reader_correct_pct).toEqual(full.per_tier.T1.reader_correct_pct);
    expect(external.per_tier.T5.reader_correct_pct).toEqual(full.per_tier.T5.reader_correct_pct);
    expect(external.overall.micro.reader_correct_pct).toEqual(full.overall.micro.reader_correct_pct);
    expect(external.overall.macro.reader_correct_pct).toEqual(full.overall.macro.reader_correct_pct);

    // Retrieval metrics are untouched by the verdict overlay.
    expect(external.per_tier.T1.recall_at_5).toEqual(partial.per_tier.T1.recall_at_5);
    expect(external.per_tier.T1.mrr).toEqual(partial.per_tier.T1.mrr);

    // Sanity on the actual numbers.
    expect(external.per_tier.T1.reader_correct_pct.point).toBe(0.5);
    expect(external.per_tier.T5.reader_correct_pct.point).toBe(0.5);
    expect(external.overall.micro.reader_correct_pct.point).toBe(0.5);

    // Finalized + judge provenance recorded (the cross-judge guard's keys).
    expect(external.run_status).toBe("completed");
    expect(external.integrity.unjudged_pct).toBe(0);
    expect(external.manifest.roles.judge).toEqual({
      provider: "claude-code-agent",
      model: "claude-sonnet-4-6",
      prompt_template_hash: "hash-A",
    });
  });

  test("unjudged verdicts count toward unjudged_pct, not correct", async () => {
    const partial = await score(pendingVerdicts, "awaiting_verdicts");
    const provenance: JudgeProvenance = {
      kind: "claude-code-agent",
      model: "claude-sonnet-4-6",
      prompt_template_hash: "hash-A",
      judged_at: "2026-06-17T00:00:00Z",
    };
    // Only 2 of 4 judged; the T5 pair left UNJUDGED.
    const external = rescoreWithVerdicts({
      partial,
      verdicts: realVerdicts.slice(0, 2),
      judge: provenance,
      run_status: "completed",
      completed_at: "2026-06-17T00:00:00Z",
    });
    expect(external.integrity.unjudged_pct).toBe(0.5);
    expect(external.per_tier.T5.reader_correct_pct.point).toBe(0); // both UNJUDGED
  });
});
