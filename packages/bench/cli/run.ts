// author: Claude
import { resolve, join } from "path";
import { mkdir } from "fs/promises";
import type { FactsFile } from "@/types/facts";
import type { CorpusManifest } from "@/types/corpus";
import type { QueriesFile } from "@/types/query";
import type { IngestManifestFile } from "@/types/ingest";
import type { GroundTruthFile } from "@/types/ground-truth";
import type { RetrievalResultsFile } from "@/types/retrieval";
import type { ReaderAnswersFile, BaselineAnswersFile } from "@/types/reader";
import type { JudgeResultsFile } from "@/types/judge";
import type { ResultsFile, RunManifest, RunStatus } from "@/types/results";
import { runStage4 } from "@/stages/04-ingest";
import { runStage5 } from "@/stages/05-resolve";
import { runStage6 } from "@/stages/06-retrieval";
import { runStage7 } from "@/stages/07-reader";
import { runStage8 } from "@/stages/08-judge";
import { runStage9 } from "@/stages/09-score";
import { createStopgapRetriever } from "@/retriever/stopgap";
import { buildProviders, resolveSyncProvider } from "@/providers";
import { BudgetMeter, buildCostPreview } from "@/lib/cost";
import { logger } from "@/lib/logger";
import { getConfig } from "@/lib/config";
import { getEnv } from "@/lib/env";
import { readJson, writeJsonAtomic, fileExists, sha256Hex } from "@/lib/artifacts";
import { newRunId } from "@/lib/ids";
import {
  BudgetExceededError,
  IntegrityViolationError,
  JudgeIntegrityError,
  CorpusTamperedError,
  UsageError,
  OperatorAbortError,
} from "@/lib/errors";
import {
  bootstrap,
  confirmPrompt,
  flagBool,
  flagString,
  parseArgv,
  stageProgress,
} from "./shared";

/**
 * `june-eval run` — drives Stages 4–9 against an existing fixture (§28).
 *
 * Resumable per §32: if a run-dir artifact is present, the next stage picks
 * up from there. `--resume` explicitly opts into resume behavior; without it
 * the bench refuses to touch an existing run-dir that already has artifacts.
 *
 * `--yes` skips the cost-preview confirmation.
 */
export const runRun = async (argv: readonly string[]): Promise<void> => {
  const { positionals, flags } = parseArgv(argv);
  if (positionals.includes("--help")) {
    process.stderr.write(RUN_HELP);
    return;
  }
  if (positionals.length < 1) {
    throw new UsageError(`Missing <fixture_dir>.\n\n${RUN_HELP}`);
  }
  await bootstrap(flags);

  const fixture_dir = resolve(positionals[0]!);
  const outRoot = resolve(flagString(flags, "out") ?? "./runs");
  const resume = flagBool(flags, "resume");
  const yes = flagBool(flags, "yes");
  const quiet = flagBool(flags, "quiet");
  const json_log = flagBool(flags, "log-json");

  const facts = (await readJson(join(fixture_dir, "facts.json"))) as FactsFile;
  const corpus = (await readJson(
    join(fixture_dir, "corpus_manifest.json"),
  )) as CorpusManifest;
  const queries = (await readJson(
    join(fixture_dir, "queries.json"),
  )) as QueriesFile;

  const fixture_hash = computeFixtureHash(facts, corpus, queries);

  const cfg = getConfig();
  void getEnv();
  const providers = buildProviders();

  const run_id = newRunId(facts.fixture_id);
  const run_dir = join(outRoot, run_id);
  await mkdir(run_dir, { recursive: true });

  const ingestPath = join(run_dir, "ingest_manifest.json");
  const groundTruthPath = join(run_dir, "ground_truth.json");
  const retrievalPath = join(run_dir, "retrieval_results.json");
  const readerPath = join(run_dir, "reader_answers.json");
  const baselinePath = cfg.baseline.no_rag_opus
    ? join(run_dir, "baseline_answers.json")
    : null;
  const judgePath = join(run_dir, "judge_results.json");
  const batchSubmissionPath = join(run_dir, "batch_submission.json");
  const resultsPath = join(run_dir, "results.json");
  const summaryPath = join(run_dir, "summary.md");

  // Cost preview + confirmation (§27). Skipped under --yes.
  if (!yes) {
    const preview = buildCostPreview({
      doc_count: corpus.documents.length,
      query_count: queries.queries.length,
      include_baseline: cfg.baseline.no_rag_opus,
    });
    const total = preview.reduce((n, r) => n + r.estimated_usd, 0);
    process.stderr.write(renderCostPreview(preview, total, cfg.cost.max_budget_usd));
    if (total > cfg.cost.max_budget_usd) {
      throw new BudgetExceededError(
        `Preview cost ${total.toFixed(4)} exceeds cap ${cfg.cost.max_budget_usd.toFixed(2)}`,
        total,
        cfg.cost.max_budget_usd,
      );
    }
    const ok = await confirmPrompt("Proceed?");
    if (!ok) throw new OperatorAbortError("Operator declined cost preview");
  }

  const budget = new BudgetMeter();
  const started_at = new Date().toISOString();

  // Stage 4 — ingest (skip if ingest_manifest already present and resume).
  const t4 = Date.now();
  let ingest: IngestManifestFile;
  if (resume && (await fileExists(ingestPath))) {
    ingest = (await readJson(ingestPath)) as IngestManifestFile;
    stageProgress({ quiet, json_log, stage_num: 4, stage_name: "ingest (resumed)", duration_ms: 0 });
  } else {
    ingest = await runStage4({
      fixture_id: facts.fixture_id,
      run_id,
      corpus_dir: join(fixture_dir, "corpus"),
      manifest: corpus,
      ingest_manifest_path: ingestPath,
    });
    stageProgress({ quiet, json_log, stage_num: 4, stage_name: "ingest", duration_ms: Date.now() - t4 });
  }

  // Stage 5 — ground truth resolution.
  const t5 = Date.now();
  let ground_truth: GroundTruthFile;
  let run_status: RunStatus = "completed";
  try {
    if (resume && (await fileExists(groundTruthPath))) {
      ground_truth = (await readJson(groundTruthPath)) as GroundTruthFile;
      if (ground_truth.integrity.aborted_over_threshold) {
        throw new IntegrityViolationError(
          `Previous resolution aborted over threshold — regenerate the fixture or raise thresholds`,
          ground_truth.integrity.unresolved_pct,
          ground_truth.integrity.embedding_pct,
        );
      }
    } else {
      ground_truth = await runStage5({
        facts,
        corpus,
        ingest,
        out_path: groundTruthPath,
      });
    }
    stageProgress({ quiet, json_log, stage_num: 5, stage_name: "ground-truth resolution", duration_ms: Date.now() - t5 });
  } catch (err) {
    if (err instanceof IntegrityViolationError) {
      run_status = "aborted_integrity_resolution";
      await writeStubResults({
        run_status,
        run_id,
        facts,
        started_at,
        fixture_hash,
        budget,
        resultsPath,
        summaryPath,
      });
      throw err;
    }
    throw err;
  }

  // Stage 6 — retrieval evaluation.
  const t6 = Date.now();
  const retriever = createStopgapRetriever({
    collectionNames: ingest.qdrant_collections,
    embedModel: ingest.embedding_model,
  });
  let retrieval: RetrievalResultsFile;
  if (resume && (await fileExists(retrievalPath))) {
    retrieval = (await readJson(retrievalPath)) as RetrievalResultsFile;
  } else {
    retrieval = await runStage6({
      facts,
      queries,
      ground_truth,
      retriever,
      ingest_run_id: ingest.ingest_run_id,
      out_path: retrievalPath,
    });
  }
  stageProgress({ quiet, json_log, stage_num: 6, stage_name: "retrieval evaluation", duration_ms: Date.now() - t6 });

  // Stage 7 — reader + optional baseline.
  const t7 = Date.now();
  const readerProvider = resolveSyncProvider(providers, cfg.roles.reader.provider);
  const readerConcurrency = cfg.roles.reader.concurrency;
  const baselineProvider = cfg.baseline.no_rag_opus
    ? resolveSyncProvider(providers, cfg.baseline.provider)
    : null;

  let reader: ReaderAnswersFile;
  let baseline: BaselineAnswersFile | null = null;
  if (resume && (await fileExists(readerPath))) {
    reader = (await readJson(readerPath)) as ReaderAnswersFile;
    if (baselinePath && (await fileExists(baselinePath))) {
      baseline = (await readJson(baselinePath)) as BaselineAnswersFile;
    }
  } else {
    const out = await runStage7({
      fixture_id: facts.fixture_id,
      queries,
      retrieval,
      ingest,
      reader_provider: readerProvider,
      reader_model: cfg.roles.reader.model,
      reader_max_tokens: cfg.roles.reader.max_tokens,
      reader_temperature: cfg.roles.reader.temperature,
      reader_concurrency: readerConcurrency,
      baseline_provider: baselineProvider,
      baseline_model: cfg.baseline.no_rag_opus ? cfg.baseline.model : null,
      baseline_max_tokens: cfg.baseline.no_rag_opus
        ? cfg.baseline.max_tokens
        : null,
      budget,
      out_path: readerPath,
      baseline_out_path: baselinePath,
    });
    reader = out.reader;
    baseline = out.baseline;
  }
  stageProgress({ quiet, json_log, stage_num: 7, stage_name: "reader evaluation", duration_ms: Date.now() - t7 });

  // Stage 8 — judging.
  const t8 = Date.now();
  let judge: JudgeResultsFile;
  try {
    let resume_batch_id: string | undefined;
    if (resume && (await fileExists(batchSubmissionPath))) {
      const sub = (await readJson(batchSubmissionPath)) as { batch_id?: string };
      resume_batch_id = sub.batch_id;
    }
    if (resume && (await fileExists(judgePath))) {
      judge = (await readJson(judgePath)) as JudgeResultsFile;
    } else {
      judge = await runStage8({
        facts,
        queries,
        reader,
        baseline,
        provider: providers["anthropic-batch"],
        model: cfg.roles.judge.model,
        max_tokens: cfg.roles.judge.max_tokens,
        checkpoint_path: batchSubmissionPath,
        resume_batch_id,
        out_path: judgePath,
      });
    }
    stageProgress({ quiet, json_log, stage_num: 8, stage_name: "judging (batch)", duration_ms: Date.now() - t8 });
  } catch (err) {
    if (err instanceof JudgeIntegrityError) {
      run_status = "aborted_integrity_judge";
      await writeStubResults({
        run_status,
        run_id,
        facts,
        started_at,
        fixture_hash,
        budget,
        resultsPath,
        summaryPath,
      });
      throw err;
    }
    throw err;
  }

  // Stage 9 — scoring + report.
  const t9 = Date.now();
  const manifest = buildManifest({
    facts,
    fixture_hash,
    run_id,
    started_at,
    ingest,
    retriever_config_snapshot: retriever.config_snapshot,
    budget_cap_usd: cfg.cost.max_budget_usd,
  });
  await runStage9({
    facts,
    queries,
    ground_truth,
    retrieval,
    reader,
    baseline,
    judge,
    manifest,
    run_status,
    budget,
    leakage_warning_count: 0,
    results_path: resultsPath,
    summary_path: summaryPath,
  });
  stageProgress({ quiet, json_log, stage_num: 9, stage_name: "scoring + report", duration_ms: Date.now() - t9 });

  logger.info("run.complete", {
    fixture_id: facts.fixture_id,
    run_id,
    run_status,
    run_dir,
    total_cost_usd: budget.total(),
  });
  process.stderr.write(
    `\nRun complete: ${run_dir}\nTotal cost: $${budget.total().toFixed(4)}\n\nSee ${summaryPath}\n`,
  );
};

const computeFixtureHash = (
  facts: FactsFile,
  corpus: CorpusManifest,
  queries: QueriesFile,
): string => {
  const sortedCorpusHashes = corpus.documents
    .map((d) => d.content_hash)
    .sort()
    .join("|");
  return sha256Hex(
    JSON.stringify(facts) + ":" + sortedCorpusHashes + ":" + JSON.stringify(queries),
  );
};

const buildManifest = (args: {
  facts: FactsFile;
  fixture_hash: string;
  run_id: string;
  started_at: string;
  ingest: IngestManifestFile;
  retriever_config_snapshot: Record<string, unknown>;
  budget_cap_usd: number;
}): RunManifest => {
  const cfg = getConfig();
  return {
    fixture_id: args.facts.fixture_id,
    fixture_hash: args.fixture_hash,
    fixture_seed: args.facts.fixture_seed,
    run_id: args.run_id,
    bench_version: "0.1.0",
    schema_version: 1,
    started_at: args.started_at,
    completed_at: new Date().toISOString(),
    roles: {
      corpus_author: {
        provider: cfg.roles.corpus_author.provider,
        model: cfg.roles.corpus_author.model,
      },
      query_author: {
        provider: cfg.roles.query_author.provider,
        model: cfg.roles.query_author.model,
      },
      reader: {
        provider: cfg.roles.reader.provider,
        model: cfg.roles.reader.model,
        temperature: cfg.roles.reader.temperature,
      },
      judge: {
        provider: "anthropic-batch",
        model: cfg.roles.judge.model,
      },
      baseline: cfg.baseline.no_rag_opus
        ? {
            provider: cfg.baseline.provider,
            model: cfg.baseline.model,
            temperature: 0,
          }
        : null,
    },
    june: {
      ingest_run_id: args.ingest.ingest_run_id,
      schema_version: args.ingest.ingest_schema_version,
      embedding_model: args.ingest.embedding_model,
      embedding_model_version: args.ingest.embedding_model_version,
    },
    retrieval_config_snapshot: args.retriever_config_snapshot,
    caching_enabled: cfg.caching.enabled,
    budget_cap_usd: args.budget_cap_usd,
  };
};

const renderCostPreview = (
  rows: ReturnType<typeof buildCostPreview>,
  total: number,
  cap: number,
): string => {
  let out = "\nCost preview (estimated):\n\n";
  for (const r of rows) {
    const note =
      r.provider === "ollama" && r.estimated_usd > 0 ? " (electricity)" : "";
    out += `  ${r.label.padEnd(22)} ${r.provider}/${r.model} — $${r.estimated_usd.toFixed(4)}${note}\n`;
  }
  out += `  ${"total".padEnd(22)} — $${total.toFixed(4)} (cap $${cap.toFixed(2)})\n\n`;
  return out;
};

const writeStubResults = async (args: {
  run_status: RunStatus;
  run_id: string;
  facts: FactsFile;
  started_at: string;
  fixture_hash: string;
  budget: BudgetMeter;
  resultsPath: string;
  summaryPath: string;
}): Promise<void> => {
  const completed_at = new Date().toISOString();
  const stub: ResultsFile = {
    fixture_id: args.facts.fixture_id,
    run_id: args.run_id,
    schema_version: 1,
    run_status: args.run_status,
    started_at: args.started_at,
    completed_at,
    manifest: {
      fixture_id: args.facts.fixture_id,
      fixture_hash: args.fixture_hash,
      fixture_seed: args.facts.fixture_seed,
      run_id: args.run_id,
      bench_version: "0.1.0",
      schema_version: 1,
      started_at: args.started_at,
      completed_at,
      roles: {
        corpus_author: { provider: "", model: "" },
        query_author: { provider: "", model: "" },
        reader: { provider: "", model: "", temperature: 0 },
        judge: { provider: "anthropic-batch", model: "" },
        baseline: null,
      },
      june: {
        ingest_run_id: "",
        schema_version: 1,
        embedding_model: "",
        embedding_model_version: "",
      },
      retrieval_config_snapshot: {},
      caching_enabled: false,
      budget_cap_usd: 0,
    },
    per_query: [],
    per_tier: {
      T1: emptyTierAggregates(),
      T2: emptyTierAggregates(),
      T3: emptyTierAggregates(),
      T4: emptyTierAggregates(),
      T5: emptyTierAggregates(),
    },
    overall: {
      macro: emptyOverall(),
      micro: emptyOverall(),
    },
    integrity: {
      unresolved_pct: 0,
      embedding_pct: 0,
      unjudged_pct: 0,
      queries_with_leakage_warning: 0,
    },
    cost_usd: args.budget.snapshot(),
  };
  await writeJsonAtomic(args.resultsPath, stub);
  const emptySummary = `# Bench run aborted (${args.run_status})\n\nNo per-tier metrics; see the integrity block in \`results.json\`.\n`;
  await Bun.write(args.summaryPath, emptySummary);
};

const emptyMetricWithCi = () => ({ point: 0, ci_low: 0, ci_high: 0, query_ids: [] });
const emptyTierAggregates = () => ({
  query_count: 0,
  recall_at_1: emptyMetricWithCi(),
  recall_at_3: emptyMetricWithCi(),
  recall_at_5: emptyMetricWithCi(),
  recall_at_10: emptyMetricWithCi(),
  mrr: emptyMetricWithCi(),
  reader_correct_pct: emptyMetricWithCi(),
  reader_hallucinated_pct: emptyMetricWithCi(),
  reader_refused_pct: emptyMetricWithCi(),
  unjudged_pct: 0,
  t5_top1_score_median: null,
});
const emptyOverall = () => ({
  reader_correct_pct: emptyMetricWithCi(),
  recall_at_5: emptyMetricWithCi(),
  recall_at_10: emptyMetricWithCi(),
  mrr: emptyMetricWithCi(),
});

// Suppress unused-import lint for files the run may create transitively.
void CorpusTamperedError;

const RUN_HELP = `june-eval run — drive Stages 4–9 against an existing fixture.

USAGE
  june-eval run <fixture_dir> [--out <dir>] [--resume] [--yes]
                [--config <path>] [--quiet] [--log-json]

FLAGS
  <fixture_dir>     the fixture directory produced by \`june-eval generate\`.
  --out <dir>       parent directory for the run output. Default: ./runs.
  --resume          pick up from the last completed stage artifact.
  --yes             skip the cost-preview confirmation.
  --config <path>   config.yaml path. Default: CONFIG_PATH env or ./config.yaml.
  --quiet           suppress stderr progress.
  --log-json        structured JSON log instead of human progress.
`;
