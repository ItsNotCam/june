// author: Claude
import { resolve, join } from "path";
import { mkdir } from "fs/promises";
import type { FactsFile } from "@/types/facts";
import type { CorpusManifest } from "@/types/corpus";
import type { QueriesFile, Query, QueryTier } from "@/types/query";
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
import { createMultiHopRetriever } from "@/retriever/multi-hop";
import { openJuneDatabase } from "@/lib/sqlite";
import { qdrantCollectionExists } from "@/retriever/qdrant";
import { buildProviders, resolveSyncProvider, wrapRegistryWithCache } from "@/providers";
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
  const outRoot = resolve(flagString(flags, "out") ?? "./state/runs");
  const resume = flagBool(flags, "resume");
  const skip_ingest = flagString(flags, "skip-ingest");
  const from = flagString(flags, "from");
  const rerun_from_str = flagString(flags, "rerun-from");
  const quick = flagBool(flags, "quick");
  const sample_str = flagString(flags, "sample");
  const cache_flag = flagBool(flags, "cache");
  const yes = flagBool(flags, "yes");
  const quiet = flagBool(flags, "quiet");
  const json_log = flagBool(flags, "log-json");

  if (resume && skip_ingest !== undefined) {
    throw new UsageError(
      "--resume and --skip-ingest are mutually exclusive. To continue a run that previously skipped ingest, just --resume it.",
    );
  }
  if (resume && from !== undefined) {
    throw new UsageError(
      "--resume and --from are mutually exclusive. --resume continues an existing run-dir; --from seeds a new run-dir from a prior one.",
    );
  }
  if (skip_ingest !== undefined && from !== undefined) {
    throw new UsageError(
      "--skip-ingest and --from are mutually exclusive. --from already covers Stage 4 reuse when --rerun-from > ingest.",
    );
  }
  if ((from !== undefined) !== (rerun_from_str !== undefined)) {
    throw new UsageError(
      "--from and --rerun-from must be used together. --from <run-id> --rerun-from <stage> is the only valid shape.",
    );
  }
  const rerun_from_stage =
    rerun_from_str !== undefined ? parseRerunFromStage(rerun_from_str) : null;
  if (quick && sample_str !== undefined) {
    throw new UsageError(
      "--quick and --sample are mutually exclusive. --quick is shorthand for --sample 0.1.",
    );
  }
  const sample_ratio = parseSampleRatio({ quick, sample_str });

  const facts = (await readJson(join(fixture_dir, "facts.json"))) as FactsFile;
  const corpus = (await readJson(
    join(fixture_dir, "corpus_manifest.json"),
  )) as CorpusManifest;
  const fullQueries = (await readJson(
    join(fixture_dir, "queries.json"),
  )) as QueriesFile;

  // Hash the full fixture (not the sampled subset) so sampled runs remain
  // attributable to the canonical fixture they were drawn from.
  const fixture_hash = computeFixtureHash(facts, corpus, fullQueries);

  const queries: QueriesFile =
    sample_ratio === 1
      ? fullQueries
      : {
          ...fullQueries,
          queries: stratifiedSample(fullQueries.queries, sample_ratio),
        };
  if (sample_ratio !== 1) {
    const before = fullQueries.queries.length;
    const after = queries.queries.length;
    logger.info("run.sample.applied", {
      query_count: after,
      candidates: before,
      sampled_ratio: sample_ratio,
    });
    if (!quiet && !json_log) {
      process.stderr.write(
        `\n⚠️  --${quick ? "quick" : "sample"} active: ${after}/${before} queries (${(sample_ratio * 100).toFixed(0)}%, stratified by tier).\n   Bootstrap CIs will widen — DO NOT compare these numbers to full-fixture runs.\n\n`,
      );
    }
  }

  const cfg = getConfig();
  void getEnv();
  const cache_enabled = cache_flag || cfg.caching.enabled;
  const providers = cache_enabled
    ? wrapRegistryWithCache(buildProviders(), cfg.caching.cache_root)
    : buildProviders();
  if (cache_enabled) {
    logger.info("run.cache.enabled", {
      cache_root: cfg.caching.cache_root,
    });
  }

  const run_id = newRunId(facts.fixture_id);
  const run_dir = join(outRoot, run_id);
  await mkdir(run_dir, { recursive: true });

  const ingestPath = join(run_dir, "ingest_manifest.json");
  if (skip_ingest !== undefined) {
    const reused = await prepareSkipIngest({
      prior_run_id: skip_ingest,
      out_root: outRoot,
      fixture_id: facts.fixture_id,
      new_run_id: run_id,
      qdrant_api_key: getEnv().QDRANT_API_KEY,
    });
    await writeJsonAtomic(ingestPath, reused);
    logger.info("run.skip_ingest.reused", {
      prior_run_id: skip_ingest,
      run_id,
      ingest_run_id: reused.ingest_run_id,
      scratch_path: reused.scratch_path,
      qdrant_collections: reused.qdrant_collections,
    });
  }
  if (from !== undefined && rerun_from_stage !== null) {
    const { ingest: reused, copied } = await prepareReuseFromPrior({
      prior_run_id: from,
      rerun_from_stage,
      out_root: outRoot,
      new_run_dir: run_dir,
      fixture_id: facts.fixture_id,
      new_run_id: run_id,
      qdrant_api_key: getEnv().QDRANT_API_KEY,
    });
    if (reused) {
      await writeJsonAtomic(ingestPath, reused);
      copied.unshift("ingest_manifest.json");
    }
    logger.info("run.reuse_from_prior.applied", {
      prior_run_id: from,
      run_id,
      stage: rerun_from_stage,
      candidates: copied.length,
    });
  }
  // True when *any* prior-artifact reuse path is active. Per-stage gates below
  // pair this with a `fileExists` check on the artifact itself, so stages that
  // didn't have their artifact copied still run fresh.
  const reuse_artifacts = resume || skip_ingest !== undefined || from !== undefined;
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

  // Stage 4 — ingest. Reused when any of --resume, --skip-ingest, or
  // --from has already populated `ingest_manifest.json` in the run-dir.
  const t4 = Date.now();
  let ingest: IngestManifestFile;
  if (reuse_artifacts && (await fileExists(ingestPath))) {
    ingest = (await readJson(ingestPath)) as IngestManifestFile;
    const stage_name =
      skip_ingest !== undefined || from !== undefined
        ? "ingest (reused)"
        : "ingest (resumed)";
    stageProgress({ quiet, json_log, stage_num: 4, stage_name, duration_ms: 0 });
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
    if (reuse_artifacts && (await fileExists(groundTruthPath))) {
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
  const innerRetriever = createStopgapRetriever({
    collectionNames: ingest.qdrant_collections,
    embedModel: ingest.embedding_model,
  });

  // Optionally wrap with the multi-hop planner so T4 queries get decomposed.
  // Owns its own SQLite handle for the bridge-entity extraction step; closed
  // after Stage 6 completes (Stage 7 reopens its own — the connections are
  // read-only so no contention).
  const mhCfg = cfg.retrieval.multi_hop;
  const mhDb = mhCfg?.enabled
    ? openJuneDatabase(join(ingest.scratch_path, "june.db"))
    : null;
  const retriever =
    mhCfg?.enabled && mhDb
      ? createMultiHopRetriever({
          inner: innerRetriever,
          plannerProvider: resolveSyncProvider(providers, mhCfg.planner.provider),
          plannerModel: mhCfg.planner.model,
          plannerMaxTokens: mhCfg.planner.max_tokens,
          fetchChunkContent: (() => {
            const stmt = mhDb.query<{ raw_content: string }, [string]>(
              `SELECT raw_content FROM chunks WHERE chunk_id = ?`,
            );
            return (chunkId: string) => stmt.get(chunkId)?.raw_content ?? null;
          })(),
          budget,
        })
      : innerRetriever;

  let retrieval: RetrievalResultsFile;
  try {
    if (reuse_artifacts && (await fileExists(retrievalPath))) {
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
  } finally {
    mhDb?.close();
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
  if (reuse_artifacts && (await fileExists(readerPath))) {
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
    if (reuse_artifacts && (await fileExists(batchSubmissionPath))) {
      const sub = (await readJson(batchSubmissionPath)) as { batch_id?: string };
      resume_batch_id = sub.batch_id;
    }
    if (reuse_artifacts && (await fileExists(judgePath))) {
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

/**
 * Parses `--sample <ratio>` into a number in (0, 1]. `--quick` is shorthand
 * for `--sample 0.1`. Empty inputs map to 1 (no sampling).
 *
 * Throws `UsageError` on out-of-range, non-numeric, or non-positive inputs.
 */
const QUICK_SAMPLE_RATIO = 0.1;

const parseSampleRatio = (args: {
  quick: boolean;
  sample_str: string | undefined;
}): number => {
  if (args.quick) return QUICK_SAMPLE_RATIO;
  if (args.sample_str === undefined) return 1;
  const n = Number(args.sample_str);
  if (!Number.isFinite(n) || n <= 0 || n > 1) {
    throw new UsageError(
      `--sample expects a number in (0, 1]; got ${JSON.stringify(args.sample_str)}.`,
    );
  }
  return n;
};

/**
 * Picks a deterministic per-tier subset of `queries`, sized at `ceil(tier_count * ratio)`.
 *
 * Sorts each tier's queries by `id` (lexicographic on `q-NNNN`) and slices the
 * head — same fixture + same ratio always yields the same subset, so different
 * reader configs are compared on identical workloads. Each tier is sampled
 * independently so tier-level metrics stay representative even at small ratios.
 *
 * `ratio === 1` short-circuits in the caller so this is only invoked for genuine sampling.
 */
const stratifiedSample = (queries: readonly Query[], ratio: number): Query[] => {
  const byTier = new Map<QueryTier, Query[]>();
  for (const q of queries) {
    const list = byTier.get(q.tier) ?? [];
    list.push(q);
    byTier.set(q.tier, list);
  }
  const out: Query[] = [];
  // Iterate tiers in canonical order so the output queries are also stable across runs.
  const tierOrder: readonly QueryTier[] = ["T1", "T2", "T3", "T4", "T5"];
  for (const tier of tierOrder) {
    const tierQueries = byTier.get(tier);
    if (!tierQueries || tierQueries.length === 0) continue;
    const take = Math.max(1, Math.ceil(tierQueries.length * ratio));
    const sorted = [...tierQueries].sort((a, b) => a.id.localeCompare(b.id));
    out.push(...sorted.slice(0, take));
  }
  return out;
};

/**
 * Validates that a prior bench run's ingest artifacts are reusable for the
 * current fixture, and returns a fresh `IngestManifestFile` rebound to the
 * new bench `run_id`. Caller writes it to the new run-dir's `ingest_manifest.json`.
 *
 * Used by both `--skip-ingest` (Stage 4 reuse only) and `--from` (multi-stage
 * reuse that includes Stage 4). The flag-name is threaded through error
 * messages so operators know which path tripped the guard.
 *
 * Guards (each is a fail-loud `UsageError`):
 *  - prior run-dir + ingest_manifest.json must exist
 *  - prior fixture_id must equal the current fixture's id (reusing a different
 *    fixture's chunks is silent corruption)
 *  - prior scratch SQLite must still exist on disk
 *  - prior `ingest_run_id` must still be present in `ingestion_runs`
 *  - every prior Qdrant collection alias must still exist on the live cluster
 *
 * The reused manifest preserves the prior `scratch_path`, `config_path`,
 * `ingest_run_id`, `embedding_model`, and `completed_at` — those fields document
 * the underlying ingest, which didn't re-run. Only `run_id` is overwritten so
 * the manifest filename matches its parent run-dir.
 */
const validateReusableIngest = async (args: {
  prior_dir: string;
  fixture_id: string;
  new_run_id: string;
  qdrant_api_key?: string;
  flag_name: "--skip-ingest" | "--from";
}): Promise<IngestManifestFile> => {
  const prior_manifest_path = join(args.prior_dir, "ingest_manifest.json");

  if (!(await fileExists(prior_manifest_path))) {
    throw new UsageError(
      `${args.flag_name}: no ingest_manifest.json at ${prior_manifest_path}. Pass a run_id whose Stage 4 completed.`,
    );
  }

  const prior = (await readJson(prior_manifest_path)) as IngestManifestFile;

  if (prior.fixture_id !== args.fixture_id) {
    throw new UsageError(
      `${args.flag_name}: fixture mismatch. Prior run ingested ${prior.fixture_id} but current fixture is ${args.fixture_id}. Reusing chunks across fixtures is unsafe.`,
    );
  }

  const prior_db_path = join(prior.scratch_path, "june.db");
  if (!(await fileExists(prior_db_path))) {
    throw new UsageError(
      `${args.flag_name}: prior scratch SQLite ${prior_db_path} no longer exists. Re-ingest by dropping the flag.`,
    );
  }

  const db = openJuneDatabase(prior_db_path);
  try {
    const row = db
      .query<{ run_id: string }, [string]>(
        `SELECT run_id FROM ingestion_runs WHERE run_id = ?`,
      )
      .get(prior.ingest_run_id);
    if (!row) {
      throw new UsageError(
        `${args.flag_name}: scratch SQLite at ${prior_db_path} has no ingestion_runs row for ${prior.ingest_run_id}. The store was tampered with — drop the flag to re-ingest.`,
      );
    }
  } finally {
    db.close();
  }

  const missing: string[] = [];
  await Promise.all(
    prior.qdrant_collections.map(async (name) => {
      const exists = await qdrantCollectionExists({
        qdrantUrl: prior.qdrant_url,
        apiKey: args.qdrant_api_key,
        collection: name,
      });
      if (!exists) missing.push(name);
    }),
  );
  if (missing.length > 0) {
    throw new UsageError(
      `${args.flag_name}: Qdrant at ${prior.qdrant_url} is missing collection(s): ${missing.join(", ")}. Re-ingest by dropping the flag.`,
    );
  }

  return { ...prior, run_id: args.new_run_id };
};

/**
 * Wrapper around `validateReusableIngest` for the `--skip-ingest` flag path.
 * Returns the rebound manifest; caller writes it to the new run-dir.
 */
const prepareSkipIngest = async (args: {
  prior_run_id: string;
  out_root: string;
  fixture_id: string;
  new_run_id: string;
  qdrant_api_key?: string;
}): Promise<IngestManifestFile> =>
  validateReusableIngest({
    prior_dir: join(args.out_root, args.prior_run_id),
    fixture_id: args.fixture_id,
    new_run_id: args.new_run_id,
    qdrant_api_key: args.qdrant_api_key,
    flag_name: "--skip-ingest",
  });

/**
 * Canonical stage-number ↔ stage-name mapping for `--rerun-from`. Stages 4–9
 * are the run-time pipeline; the `generate` command owns 1–3. Numeric input
 * (4..9) and named input (the values below) are both accepted.
 */
const STAGE_NAME_TO_NUM = {
  ingest: 4,
  resolve: 5,
  retrieve: 6,
  reader: 7,
  judge: 8,
  score: 9,
} as const;
type StageName = keyof typeof STAGE_NAME_TO_NUM;
const STAGE_NAMES = Object.keys(STAGE_NAME_TO_NUM) as readonly StageName[];

/**
 * Resolves `--rerun-from <stage>` to a stage number in 4..9.
 *
 * Accepts named values (`ingest|resolve|retrieve|reader|judge|score`) or the
 * equivalent numeric values (`4|5|6|7|8|9`). Anything else throws `UsageError`
 * with the full set of accepted values.
 */
const parseRerunFromStage = (input: string): number => {
  if (input in STAGE_NAME_TO_NUM) {
    return STAGE_NAME_TO_NUM[input as StageName];
  }
  const n = Number(input);
  if (Number.isInteger(n) && n >= 4 && n <= 9) return n;
  throw new UsageError(
    `--rerun-from: expected one of ${STAGE_NAMES.join("|")} (or 4..9); got ${JSON.stringify(input)}.`,
  );
};

/**
 * Per-stage artifact filenames in the run-dir. Each stage writes exactly one
 * canonical artifact (Stage 8 also writes a checkpoint) so artifact-level
 * reuse maps cleanly to "copy these files from prior run-dir to new run-dir".
 *
 * Stage 9's `results.json` and `summary.md` are absent here on purpose —
 * Stage 9 always runs and overwrites them, so copying is moot. `--rerun-from
 * score` reuses 4..8 and lets Stage 9 regenerate.
 */
const STAGE_ARTIFACTS: Record<number, readonly string[]> = {
  4: ["ingest_manifest.json"],
  5: ["ground_truth.json"],
  6: ["retrieval_results.json"],
  // Stage 7 baseline_answers.json is optional — only present when
  // baseline.no_rag_opus was true on the prior run; copyArtifact silently
  // skips a non-existent source.
  7: ["reader_answers.json", "baseline_answers.json"],
  // batch_submission.json is the Stage 8 checkpoint — copying it lets the
  // resume_batch_id path in Stage 8 pick it up if judge_results.json is
  // somehow missing from the copied set (defensive; should be present).
  8: ["judge_results.json", "batch_submission.json"],
};

/**
 * Copies a single artifact file from `src_path` to `dst_path` if the source
 * exists. Silent no-op when the source is absent (used for optional artifacts
 * like `baseline_answers.json` when the prior run didn't enable baseline).
 *
 * Uses `Bun.write(path, Bun.file(path))` which is the Bun-native zero-copy
 * file copy — no buffering through JS-land.
 */
const copyArtifact = async (src_path: string, dst_path: string): Promise<boolean> => {
  if (!(await fileExists(src_path))) return false;
  await Bun.write(dst_path, Bun.file(src_path));
  return true;
};

/**
 * Implements `--from <prior-run-id> --rerun-from <stage>`. Validates the
 * prior run-dir, copies artifacts for stages `< rerun_from_stage` from prior
 * to the new run-dir, and (when Stage 4 is among the reused set) returns the
 * rebound `IngestManifestFile`. The caller writes the rebound manifest after
 * this returns so the new run-dir owns its `ingest_manifest.json` with the
 * new `run_id`, but otherwise points at the prior scratch + Qdrant state.
 *
 * Returns the list of artifact filenames actually copied (for log telemetry)
 * plus the rebound ingest manifest when applicable.
 *
 * Guards beyond the standard ingest validation:
 *  - prior run-dir must exist
 *  - When `rerun_from_stage > 4`, the prior ingest must validate cleanly (same
 *    rules as `--skip-ingest`).
 */
const prepareReuseFromPrior = async (args: {
  prior_run_id: string;
  rerun_from_stage: number;
  out_root: string;
  new_run_dir: string;
  fixture_id: string;
  new_run_id: string;
  qdrant_api_key?: string;
}): Promise<{ ingest: IngestManifestFile | null; copied: string[] }> => {
  const prior_dir = join(args.out_root, args.prior_run_id);
  if (!(await fileExists(prior_dir))) {
    throw new UsageError(
      `--from: prior run-dir does not exist: ${prior_dir}.`,
    );
  }

  // When Stage 4 is among the reused stages, validate ingest end-to-end and
  // hand back the rebound manifest. Caller writes it.
  let ingest: IngestManifestFile | null = null;
  if (args.rerun_from_stage > 4) {
    ingest = await validateReusableIngest({
      prior_dir,
      fixture_id: args.fixture_id,
      new_run_id: args.new_run_id,
      qdrant_api_key: args.qdrant_api_key,
      flag_name: "--from",
    });
  }

  // Copy every artifact for stages strictly below rerun_from_stage. Stage 4
  // is intentionally excluded from the copy loop — when reused, the caller
  // writes the rebound manifest from `ingest` above.
  const copied: string[] = [];
  await Promise.all(
    Object.entries(STAGE_ARTIFACTS).flatMap(([stage_str, files]) => {
      const stage = Number(stage_str);
      if (stage <= 4 || stage >= args.rerun_from_stage) return [];
      return files.map(async (filename) => {
        const ok = await copyArtifact(
          join(prior_dir, filename),
          join(args.new_run_dir, filename),
        );
        if (ok) copied.push(filename);
      });
    }),
  );

  return { ingest, copied };
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
  june-eval run <fixture_dir> [--out <dir>]
                [--resume | --skip-ingest <run_id> |
                 --from <run_id> --rerun-from <stage>]
                [--quick | --sample <ratio>] [--cache] [--yes]
                [--config <path>] [--quiet] [--log-json]

FLAGS
  <fixture_dir>            the fixture directory produced by \`june-eval generate\`.
  --out <dir>              parent directory for the run output. Default: ./state/runs.
  --resume                 pick up from the last completed stage artifact.
  --skip-ingest <run_id>   reuse Stage 4 artifacts (scratch SQLite + Qdrant
                           collections) from a prior run with the same fixture.
                           Cuts ~25 min off the iteration cycle when ingest is
                           known-good. Validates the prior scratch SQLite and
                           Qdrant collections still exist before proceeding.
                           Mutually exclusive with --resume and --from.
  --from <run_id>          seed a new run-dir with artifacts copied from a prior
                           run for every stage strictly below --rerun-from.
                           Stage 4 (ingest) is reused via the same validation
                           as --skip-ingest. Required with --rerun-from.
                           Mutually exclusive with --resume and --skip-ingest.
  --rerun-from <stage>     stage from which to recompute. Accepts named values
                           (ingest|resolve|retrieve|reader|judge|score) or the
                           equivalent numeric values (4|5|6|7|8|9). Required
                           with --from.
  --quick                  shorthand for --sample 0.1 (10% of queries per tier).
  --sample <ratio>         sample a deterministic fraction of queries per tier
                           (ratio in (0, 1]). Same fixture + same ratio always
                           yields the same subset. CIs widen — DO NOT compare
                           sampled-run numbers to full-fixture numbers.
                           Mutually exclusive with --quick.
  --cache                  serve identical LLM requests from the on-disk
                           response cache (caching.cache_root). Misses are
                           written through; hits report cost_usd: 0. Boolean
                           override of caching.enabled in config.yaml.
  --yes                    skip the cost-preview confirmation.
  --config <path>          config.yaml path. Default: CONFIG_PATH env or ./config.yaml.
  --quiet                  suppress stderr progress.
  --log-json               structured JSON log instead of human progress.

EXAMPLES
  # Smoke pass: 10% of queries, reuse prior ingest, response cache on
  june-eval run <fixture> --quick --skip-ingest <prior-run-id> --cache --yes

  # Reader iteration: keep stages 4-6 from a known-good run, re-run reader+judge+score
  june-eval run <fixture> --from <prior-run-id> --rerun-from reader --yes

  # Scoring tweak only: reuse all of 4-8, just re-run Stage 9
  june-eval run <fixture> --from <prior-run-id> --rerun-from score --yes
`;
