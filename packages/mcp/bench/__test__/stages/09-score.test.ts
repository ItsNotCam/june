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
import type { JudgeResultsFile } from "@/types/judge";
import type { RunManifest } from "@/types/results";
import { runStage9 } from "@/stages/09-score";
import { BudgetMeter } from "@/lib/cost";
import { readJson } from "@/lib/artifacts";
import { loadTestConfig } from "../helpers";

/**
 * End-to-end scoring test. Wires the stage-9 inputs by hand, then asserts:
 * - T5 queries with REFUSED verdict are counted as CORRECT in scoring.
 * - T1 queries with CORRECT verdict are counted as CORRECT.
 * - Overall micro aggregates match the expected fraction.
 * - Macro averages across tiers equally.
 */
describe("Stage 9 — tier-dispatched scoring", () => {
  beforeAll(async () => {
    await loadTestConfig();
  });

  test("maps T5 REFUSED → correct; T1–T4 CORRECT → correct", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bench-stage9-"));
    const resultsPath = join(dir, "results.json");
    const summaryPath = join(dir, "summary.md");

    const facts: FactsFile = {
      fixture_id: "FID",
      fixture_seed: 1,
      schema_version: 1,
      domain_name: "Test",
      generated_at: new Date().toISOString(),
      facts: [],
    };
    const queries: QueriesFile = {
      fixture_id: "FID",
      schema_version: 1,
      query_author: { provider: "openai", model: "gpt" },
      queries: [
        { id: "q-T1-a", tier: "T1", text: "", expected_fact_ids: ["f1"], anti_leakage_score: null, generation_attempts: 1 },
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
    const retrieval: RetrievalResultsFile = {
      fixture_id: "FID",
      ingest_run_id: "ir",
      retriever_config: { adapter: "stopgap", retrieval_config_snapshot: {} },
      results: queries.queries.map((q) => ({
        query_id: q.id,
        retrieved: [],
        recall_at_k: { "1": 0, "3": 0, "5": 0, "10": 0 },
        mrr: 0,
        t5_top1_score: q.tier === "T5" ? 0.12 : null,
      })),
    };
    const reader: ReaderAnswersFile = {
      fixture_id: "FID",
      reader: { provider: "ollama", model: "qwen", temperature: 0 },
      answers: queries.queries.map((q) => ({
        query_id: q.id,
        answer_text: "",
        retrieved_chunk_ids: [],
        latency_ms: 0,
        prompt_tokens: null,
        completion_tokens: null,
      })),
    };
    const judge: JudgeResultsFile = {
      fixture_id: "FID",
      judge: { provider: "anthropic-batch", model: "sonnet", batch_api: true },
      batch: { batch_id: "b", submitted_at: "", retrieved_at: "" },
      verdicts: [
        { query_id: "q-T1-a", verdict: "CORRECT", rationale: "", unjudged_reason: null },
        { query_id: "q-T5-a", verdict: "REFUSED", rationale: "", unjudged_reason: null },
        { query_id: "q-T5-b", verdict: "INCORRECT", rationale: "", unjudged_reason: null },
      ],
    };
    const manifest: RunManifest = {
      fixture_id: "FID",
      fixture_hash: "h",
      fixture_seed: 1,
      run_id: "r1",
      bench_version: "0.1.0",
      schema_version: 1,
      started_at: "",
      completed_at: "",
      roles: {
        corpus_author: { provider: "anthropic", model: "sonnet" },
        query_author: { provider: "openai", model: "gpt" },
        reader: { provider: "ollama", model: "qwen", temperature: 0 },
        judge: { provider: "anthropic-batch", model: "sonnet" },
        baseline: null,
      },
      june: { ingest_run_id: "ir", schema_version: 1, embedding_model: "m", embedding_model_version: "" },
      retrieval_config_snapshot: {},
      caching_enabled: false,
      budget_cap_usd: 5,
    };

    await runStage9({
      facts,
      queries,
      ground_truth,
      retrieval,
      reader,
      baseline: null,
      judge,
      manifest,
      run_status: "completed",
      budget: new BudgetMeter(),
      leakage_warning_count: 0,
      results_path: resultsPath,
      summary_path: summaryPath,
    });

    const loaded = (await readJson(resultsPath)) as import("@/types/results").ResultsFile;
    // T5 tier: 1/2 correct (one REFUSED, one INCORRECT)
    expect(loaded.per_tier.T5.reader_correct_pct.point).toBeCloseTo(0.5, 6);
    // T1 tier: 1/1 correct
    expect(loaded.per_tier.T1.reader_correct_pct.point).toBeCloseTo(1, 6);
    // Micro: 2 correct of 3 queries total
    expect(loaded.overall.micro.reader_correct_pct.point).toBeCloseTo(2 / 3, 6);
    // T5 t5_top1_score_median is present
    expect(loaded.per_tier.T5.t5_top1_score_median).toBeCloseTo(0.12, 6);
  });
});
