// author: Claude
import { resolve, join } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import type { CorpusManifest } from "@/types/corpus";
import type { QueriesFile } from "@/types/query";
import type { RetrievalResultsFile, RetrievalResult } from "@/types/retrieval";
import type { IngestManifestFile } from "@/types/ingest";
import type {
  HoldoutQueriesFile,
  HoldoutManifest,
  HoldoutResultsFile,
} from "@/types/holdout";
import type { JudgeTask, JudgeTasksFile, JudgeProvenance } from "@/types/judge-tasks";
import { BASELINE_QUERY_PREFIX } from "@/types/judge";
import {
  splitDocs,
  buildLabelingPlan,
  assembleHoldout,
  docFilename,
  type HoldoutLabelsFile,
  type RealDoc,
} from "@/lib/holdout-build";
import {
  HOLDOUT_LOCK_FILENAME,
  buildHoldoutLock,
  verifyHoldoutLock,
  computeHoldoutHash,
  assertFrozenHoldoutIntact,
} from "@/lib/holdout-lock";
import {
  resolveExpectedDocIds,
  buildChunkDocMap,
  type RetrievedDoc,
} from "@/lib/holdout";
import {
  buildHoldoutPerQuery,
  buildHoldoutResults,
  rescoreHoldoutWithVerdicts,
  renderHoldoutSummary,
  validateHoldoutVerdicts,
  type HoldoutPerQueryInput,
} from "@/lib/holdout-score";
import { runStage4 } from "@/stages/04-ingest";
import { runStage7 } from "@/stages/07-reader";
import { createStopgapRetriever } from "@/retriever/stopgap";
import { buildProviders, resolveSyncProvider } from "@/providers";
import { openJuneDatabase, renderChunksById } from "@/lib/sqlite";
import { BudgetMeter } from "@/lib/cost";
import { promptTemplateHash } from "@/lib/prompts";
import { newRunId } from "@/lib/ids";
import {
  readJson,
  writeJsonAtomic,
  fileExists,
  listMarkdownFiles,
} from "@/lib/artifacts";
import { UsageError, FixtureTamperedError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getConfig } from "@/lib/config";
import { getEnv } from "@/lib/env";
import { RUN_MODES, isControlReader, type RunMode, type ReaderProvider } from "@/lib/modes";
import {
  HOLDOUT_RESULTS_FILENAME,
  HOLDOUT_SUMMARY_FILENAME,
  HOLDOUT_JUDGE_TASKS_FILENAME,
} from "@/lib/holdout-paths";
import { bootstrap, parseArgv, flagString, flagBool } from "./shared";

/**
 * Real-document holdout CLI (§ RSI Phase 4) — the sealed, separately-reported,
 * never-gated eval. Build path (all no-API): `holdout-split` slices a real
 * `llms-full.txt` into docs + a labeling plan → agents label expected docs +
 * gold answers → `holdout-assemble` validates → `freeze-holdout` locks it into
 * `fixtures/<name>/`. Run path: `run-holdout` ingests + scores doc-level recall +
 * runs the local reader + emits judge tasks; `score-holdout` finalizes from
 * external agent verdicts. See `HOLDOUT.md`.
 */

/** Where committed fixtures (incl. holdouts) live — package root, tracked in git. */
const FIXTURES_ROOT = join(import.meta.dir, "..", "fixtures");
const PLAN_FILENAME = "labeling_plan.json";

// ---------------------------------------------------------------------------
// holdout-split — slice a real docs file into a corpus + labeling plan (NO API)
// ---------------------------------------------------------------------------
export const runHoldoutSplit = async (argv: readonly string[]): Promise<void> => {
  const { positionals, flags } = parseArgv(argv);
  if (positionals.includes("--help") || positionals.length < 1) {
    process.stderr.write(SPLIT_HELP);
    if (positionals.length < 1) throw new UsageError("Missing <source.txt>");
    return;
  }
  await bootstrap(flags);

  const srcPath = resolve(positionals[0]!);
  const outDir = resolve(flagString(flags, "out") ?? "./state/holdout-split");
  const urlPrefix = flagString(flags, "url-prefix");
  const maxDocsStr = flagString(flags, "max-docs");
  const maxDocs = maxDocsStr !== undefined ? Number(maxDocsStr) : undefined;
  if (maxDocsStr !== undefined && (!Number.isInteger(maxDocs) || maxDocs! < 1)) {
    throw new UsageError(`--max-docs expects a positive integer; got ${JSON.stringify(maxDocsStr)}.`);
  }
  const sourceName = flagString(flags, "source-name") ?? "Next.js documentation";
  const sourceUrl = flagString(flags, "source-url") ?? "https://nextjs.org/docs/llms-full.txt";

  const fullText = await readFile(srcPath, "utf-8");
  const docs = splitDocs(fullText, { urlPrefix, maxDocs });
  if (docs.length === 0) {
    throw new UsageError(
      `holdout-split: no documents matched${urlPrefix ? ` url-prefix "${urlPrefix}"` : ""}. Widen the filter.`,
    );
  }

  const corpusDir = join(outDir, "corpus");
  await mkdir(corpusDir, { recursive: true });
  await Promise.all(
    docs.map((d) => writeFile(join(corpusDir, docFilename(d)), d.markdown, "utf-8")),
  );
  // A provisional manifest so the corpus is ingest-ready even before labeling.
  const { manifest } = assembleHoldout({
    docs,
    labels: [],
    corpusDir,
    label_author: { provider: "pending", model: "pending" },
  });
  await writeJsonAtomic(join(outDir, "corpus_manifest.json"), manifest);
  const plan = buildLabelingPlan(docs, { name: sourceName, url: sourceUrl });
  await writeJsonAtomic(join(outDir, PLAN_FILENAME), plan);

  logger.info("holdout.split.complete", {
    holdout_id: plan.holdout_id,
    note: `${docs.length} docs → ${outDir}`,
  });
  process.stderr.write(
    `Split ${sourceName} → ${outDir}\n` +
      `  holdout_id: ${plan.holdout_id}\n` +
      `  ${docs.length} real documents${urlPrefix ? ` (url-prefix ${urlPrefix})` : ""}.\n` +
      `  Next: agents label ~30-60 Q/A against ${PLAN_FILENAME} + corpus/ → labels.json, then \`june-eval holdout-assemble\`. See HOLDOUT.md.\n`,
  );
};

// ---------------------------------------------------------------------------
// holdout-assemble — validate agent labels into a holdout fixture (NO API)
// ---------------------------------------------------------------------------
export const runHoldoutAssemble = async (argv: readonly string[]): Promise<void> => {
  const { positionals, flags } = parseArgv(argv);
  if (positionals.includes("--help") || positionals.length < 1) {
    process.stderr.write(ASSEMBLE_HELP);
    if (positionals.length < 1) throw new UsageError("Missing <split_dir>");
    return;
  }
  await bootstrap(flags);

  const splitDir = resolve(positionals[0]!);
  const labelsArg = flagString(flags, "labels");
  const labelModel = flagString(flags, "label-model");
  const outDir = resolve(flagString(flags, "out") ?? join(splitDir, "fixture"));
  if (!labelsArg || !labelModel) {
    throw new UsageError("holdout-assemble requires --labels <file> --label-model <m>.");
  }

  const docs = await readRealDocs(splitDir);
  const labelsFile = (await readJson(resolve(labelsArg))) as HoldoutLabelsFile;
  if (!Array.isArray(labelsFile.labels) || labelsFile.labels.length === 0) {
    throw new UsageError(`holdout-assemble: ${labelsArg} has no labels.`);
  }

  const corpusDir = join(outDir, "corpus");
  const { manifest, queries, files } = assembleHoldout({
    docs,
    labels: labelsFile.labels,
    corpusDir,
    label_author: { provider: "claude-code-agent", model: labelModel },
  });

  await mkdir(corpusDir, { recursive: true });
  await Promise.all(files.map((f) => writeFile(join(corpusDir, f.filename), f.markdown, "utf-8")));
  await writeJsonAtomic(join(outDir, "corpus_manifest.json"), manifest);
  await writeJsonAtomic(join(outDir, "holdout_queries.json"), queries);

  const answerable = queries.queries.filter((q) => !q.unanswerable).length;
  logger.info("holdout.assemble.complete", {
    holdout_id: queries.holdout_id,
    note: `${files.length} docs, ${queries.queries.length} queries → ${outDir}`,
  });
  process.stderr.write(
    `Assembled holdout → ${outDir}\n` +
      `  holdout_id: ${queries.holdout_id}\n` +
      `  ${files.length} real docs, ${queries.queries.length} queries (${answerable} answerable, ${queries.queries.length - answerable} unanswerable), labeled by ${labelModel}.\n` +
      `  Next: \`june-eval freeze-holdout ${outDir} --name holdout-real --signoff <who>\`.\n`,
  );
};

// ---------------------------------------------------------------------------
// freeze-holdout / verify-holdout — immutable, hash-locked sealed holdout
// ---------------------------------------------------------------------------
export const runFreezeHoldout = async (argv: readonly string[]): Promise<void> => {
  const { positionals, flags } = parseArgv(argv);
  if (positionals.includes("--help") || positionals.length < 1) {
    process.stderr.write(FREEZE_HELP);
    if (positionals.length < 1) throw new UsageError("Missing <holdout_dir>");
    return;
  }
  await bootstrap(flags);

  const src = resolve(positionals[0]!);
  const name = flagString(flags, "name");
  if (!name || !/^[a-z0-9][a-z0-9._-]*$/i.test(name)) {
    throw new UsageError(`--name <name> is required and must be a safe folder name (got ${JSON.stringify(name)}).`);
  }
  const force = flagBool(flags, "force");
  const root = resolve(flagString(flags, "out") ?? FIXTURES_ROOT);
  const dest = join(root, name);

  for (const f of ["corpus_manifest.json", "holdout_queries.json"]) {
    if (!(await fileExists(join(src, f)))) {
      throw new UsageError(`freeze-holdout: source ${src} is missing ${f} — not a complete holdout dir.`);
    }
  }
  if ((await fileExists(dest)) && !force) {
    throw new UsageError(
      `freeze-holdout: ${dest} already exists. A sealed holdout is immutable — pick a new --name, or pass --force.`,
    );
  }

  const sourceName = flagString(flags, "source-name") ?? "Next.js documentation";
  const sourceUrl = flagString(flags, "source-url") ?? "https://nextjs.org/docs/llms-full.txt";

  await mkdir(join(dest, "corpus"), { recursive: true });
  for (const f of ["corpus_manifest.json", "holdout_queries.json"]) {
    await Bun.write(join(dest, f), Bun.file(join(src, f)));
  }
  const mdFiles = await listMarkdownFiles(join(src, "corpus"));
  await Promise.all(
    mdFiles.map((p) => Bun.write(join(dest, "corpus", p.split("/").pop()!), Bun.file(p))),
  );
  // Rewrite each doc's absolute_path to its frozen location (content_hash unchanged).
  const frozenManifest = (await readJson(join(dest, "corpus_manifest.json"))) as CorpusManifest;
  for (const doc of frozenManifest.documents) {
    doc.absolute_path = join(dest, "corpus", doc.filename);
  }
  await writeJsonAtomic(join(dest, "corpus_manifest.json"), frozenManifest);

  const lock = await buildHoldoutLock({
    holdoutDir: dest,
    name,
    source: { name: sourceName, url: sourceUrl, doc_count: frozenManifest.documents.length },
    human_signoff: flagString(flags, "signoff") ?? null,
    frozen_at: new Date().toISOString(),
    ...(flagString(flags, "note") !== undefined ? { note: flagString(flags, "note")! } : {}),
  });
  await writeJsonAtomic(join(dest, HOLDOUT_LOCK_FILENAME), lock);

  logger.info("holdout.freeze.complete", { holdout_hash: lock.holdout_hash, note: name });
  process.stderr.write(
    `Froze SEALED holdout "${name}" → ${dest}\n` +
      `  holdout_hash: ${lock.holdout_hash}\n` +
      `  ${lock.doc_count} real docs, ${lock.query_count} queries (${lock.answerable_count} answerable / ${lock.unanswerable_count} unanswerable), labeled by ${lock.label_author.model}.\n` +
      `  ${lock.files.length} files hashed into ${HOLDOUT_LOCK_FILENAME}. Commit the ${name}/ dir. It is NEVER pinned or gated.\n`,
  );
};

export const runVerifyHoldout = async (argv: readonly string[]): Promise<void> => {
  const { positionals, flags } = parseArgv(argv);
  if (positionals.includes("--help") || positionals.length < 1) {
    process.stderr.write(VERIFY_HELP);
    if (positionals.length < 1) throw new UsageError("Missing <holdout_dir>");
    return;
  }
  await bootstrap(flags);

  const dir = resolve(positionals[0]!);
  if (!(await fileExists(join(dir, HOLDOUT_LOCK_FILENAME)))) {
    throw new UsageError(`verify-holdout: ${dir} has no ${HOLDOUT_LOCK_FILENAME} — freeze it first.`);
  }
  const { ok, divergences, lock } = await verifyHoldoutLock(dir);
  if (!ok) {
    throw new FixtureTamperedError(
      `Holdout "${lock.name}" diverged from its lock (${divergences.length} issue(s)):\n  ${divergences.join("\n  ")}`,
      divergences,
    );
  }
  process.stderr.write(
    `verify-holdout OK — "${lock.name}" matches its lock (holdout_hash ${lock.holdout_hash.slice(0, 12)}…, ${lock.files.length} files).\n`,
  );
};

// ---------------------------------------------------------------------------
// run-holdout — ingest + doc-level retrieval + reader + emit judge tasks
// ---------------------------------------------------------------------------
export const runRunHoldout = async (argv: readonly string[]): Promise<void> => {
  const { positionals, flags } = parseArgv(argv);
  if (positionals.includes("--help") || positionals.length < 1) {
    process.stderr.write(RUN_HELP);
    if (positionals.length < 1) throw new UsageError("Missing <holdout_dir>");
    return;
  }
  await bootstrap(flags);

  const holdout_dir = resolve(positionals[0]!);
  const outRoot = resolve(flagString(flags, "out") ?? "./state/runs");
  const baseline_enabled = !flagBool(flags, "no-baseline"); // ON by default (the parametric delta)
  const quiet = flagBool(flags, "quiet");
  // Optional YAML whose ingest tunables merge into the Stage-4 scratch config —
  // e.g. `summarizer.concurrency: 1` so a big control summarizer (gemma4:26b) on a
  // single 24GB GPU runs one context at a time (mirrors `run`'s --ingest-config).
  const ingest_config = flagString(flags, "ingest-config");

  // A frozen holdout is immutable — refuse to run a drifted one.
  await assertFrozenHoldoutIntact(holdout_dir);

  const corpus = (await readJson(join(holdout_dir, "corpus_manifest.json"))) as CorpusManifest;
  const holdoutQueries = (await readJson(
    join(holdout_dir, "holdout_queries.json"),
  )) as HoldoutQueriesFile;
  const holdout_hash = computeHoldoutHash(corpus, holdoutQueries);

  // Reader-by-purpose: --mode forces the reader (reader stays LOCAL/BYO).
  const { run_mode, reader_provider_name, reader_model } = resolveHoldoutReader(flags);

  const cfg = getConfig();
  void getEnv();
  const providers = buildProviders();
  const run_id = newRunId(holdoutQueries.holdout_id);
  const run_dir = join(outRoot, run_id);
  await mkdir(run_dir, { recursive: true });
  const budget = new BudgetMeter();
  const started_at = new Date().toISOString();

  // Stage 4 — ingest the real corpus as-is.
  const ingestPath = join(run_dir, "ingest_manifest.json");
  const ingest: IngestManifestFile = await runStage4({
    fixture_id: holdoutQueries.holdout_id,
    run_id,
    corpus_dir: join(holdout_dir, "corpus"),
    manifest: corpus,
    ingest_manifest_path: ingestPath,
    ...(ingest_config !== undefined ? { ingest_config_path: ingest_config } : {}),
  });

  // Resolve labeled expected filenames → june doc_ids (matches what june ingested).
  const expectedByQuery = new Map<string, string[]>();
  let queries_with_unknown_doc = 0;
  for (const q of holdoutQueries.queries) {
    const ids = q.unanswerable ? [] : resolveExpectedDocIds(q, corpus);
    expectedByQuery.set(q.id, ids);
  }

  // Doc-level retrieval. Plain stopgap retriever ONLY — no multi-hop planner
  // (that calls an LLM; the holdout retrieval path must stay deterministic +
  // API-free, and it's the un-contaminated signal we lead with).
  const retriever = createStopgapRetriever({
    collectionNames: ingest.qdrant_collections,
    embedModel: ingest.embedding_model,
    ingestRunId: ingest.ingest_run_id,
  });
  const maxK = Math.max(...cfg.retrieval.k_values, 10);

  const db = openJuneDatabase(join(ingest.scratch_path, "june.db"));
  let perQueryInputs: HoldoutPerQueryInput[];
  let judgeTasks: JudgeTask[];
  try {
    const chunkToDoc = buildChunkDocMap(db);
    // Validate that every expected doc_id actually ingested.
    const ingestedDocIds = new Set(chunkToDoc.values());
    for (const q of holdoutQueries.queries) {
      const ids = expectedByQuery.get(q.id)!;
      if (ids.some((id) => !ingestedDocIds.has(id))) queries_with_unknown_doc++;
    }

    const retrievals = new Map<string, RetrievalResult[]>();
    const projected = new Map<string, RetrievedDoc[]>();
    for (const q of holdoutQueries.queries) {
      const top = await retriever.retrieve(q.text, maxK);
      retrievals.set(q.id, top);
      projected.set(
        q.id,
        top.map((r) => ({
          chunk_id: r.chunk_id,
          doc_id: chunkToDoc.get(r.chunk_id) ?? "",
          score: r.score,
        })),
      );
    }

    // Run the local reader (+ no-RAG baseline = SAME reader, empty context).
    // The judge stays external. We adapt the holdout queries into the Stage-7
    // shapes so the reader/judge code paths are reused verbatim.
    const synthQueries = toSyntheticQueries(holdoutQueries);
    const retrievalFile = toRetrievalResultsFile(
      holdoutQueries.holdout_id,
      ingest.ingest_run_id,
      retriever,
      retrievals,
    );
    const readerOut = await runStage7({
      fixture_id: holdoutQueries.holdout_id,
      queries: synthQueries,
      retrieval: retrievalFile,
      ingest,
      reader_provider: resolveSyncProvider(providers, reader_provider_name),
      reader_model,
      reader_max_tokens: cfg.roles.reader.max_tokens,
      reader_temperature: cfg.roles.reader.temperature,
      reader_concurrency: cfg.roles.reader.concurrency,
      baseline_provider: baseline_enabled
        ? resolveSyncProvider(providers, reader_provider_name)
        : null,
      baseline_model: baseline_enabled ? reader_model : null,
      baseline_max_tokens: baseline_enabled ? cfg.roles.reader.max_tokens : null,
      budget,
      out_path: join(run_dir, "reader_answers.json"),
      baseline_out_path: baseline_enabled ? join(run_dir, "baseline_answers.json") : null,
    });

    const readerById = new Map(readerOut.reader.answers.map((a) => [a.query_id, a]));
    const baselineById = new Map(
      (readerOut.baseline?.answers ?? []).map((a) => [a.query_id, a]),
    );
    const readerK = cfg.reader_eval.k;

    perQueryInputs = holdoutQueries.queries.map((q) => ({
      query: q,
      expected_doc_ids: expectedByQuery.get(q.id)!,
      retrieved: projected.get(q.id)!,
      reader_answer: readerById.get(q.id)?.answer_text ?? "",
      baseline_answer: baseline_enabled ? (baselineById.get(q.id)?.answer_text ?? "") : null,
    }));

    // Emit judge tasks (reader + baseline) — gold answer is the expected "fact".
    judgeTasks = [];
    for (const q of holdoutQueries.queries) {
      const chunkIds = (retrievals.get(q.id) ?? []).slice(0, readerK).map((r) => r.chunk_id);
      judgeTasks.push({
        query_id: q.id,
        query_text: q.text,
        tier: q.unanswerable ? "T5" : "T1",
        expected_facts: q.unanswerable ? [] : [{ surface_hint: q.gold_answer }],
        reader_answer: readerById.get(q.id)?.answer_text ?? "",
        retrieved_context: renderChunksById(db, chunkIds),
        is_baseline: false,
      });
      if (baseline_enabled) {
        judgeTasks.push({
          query_id: `${BASELINE_QUERY_PREFIX}${q.id}`,
          query_text: q.text,
          tier: q.unanswerable ? "T5" : "T1",
          expected_facts: q.unanswerable ? [] : [{ surface_hint: q.gold_answer }],
          reader_answer: baselineById.get(q.id)?.answer_text ?? "",
          retrieved_context: "",
          is_baseline: true,
        });
      }
    }
  } finally {
    db.close();
  }

  const judgePromptHash = await promptTemplateHash("judge");
  const judgeTasksFile: JudgeTasksFile = {
    fixture_id: holdoutQueries.holdout_id,
    run_id,
    schema_version: 1,
    prompt_template: "judge",
    prompt_template_hash: judgePromptHash,
    tasks: judgeTasks,
  };
  const judgeTasksPath = join(run_dir, HOLDOUT_JUDGE_TASKS_FILENAME);
  await writeJsonAtomic(judgeTasksPath, judgeTasksFile);

  const completed_at = new Date().toISOString();
  const manifest: HoldoutManifest = {
    holdout_id: holdoutQueries.holdout_id,
    holdout_hash,
    run_id,
    bench_version: "0.1.0",
    schema_version: 1,
    started_at,
    completed_at,
    mode: run_mode,
    reader: { provider: reader_provider_name, model: reader_model, temperature: cfg.roles.reader.temperature },
    judge: { provider: "external", model: "", prompt_template_hash: judgePromptHash },
    baseline: baseline_enabled ? { provider: reader_provider_name, model: reader_model } : null,
    june: {
      ingest_run_id: ingest.ingest_run_id,
      schema_version: ingest.ingest_schema_version,
      embedding_model: ingest.embedding_model,
      embedding_model_version: ingest.embedding_model_version,
    },
    source: {
      name: "real-doc holdout",
      url: holdoutQueries.holdout_id,
      doc_count: corpus.documents.length,
    },
    label_author: holdoutQueries.label_author,
  };

  const results = buildHoldoutResults({
    holdout_id: holdoutQueries.holdout_id,
    holdout_hash,
    run_id,
    run_status: "awaiting_verdicts",
    started_at,
    completed_at,
    manifest,
    per_query: buildHoldoutPerQuery(perQueryInputs),
    queries_with_unknown_doc,
    cost_usd: budget.snapshot(),
  });
  const resultsPath = join(run_dir, HOLDOUT_RESULTS_FILENAME);
  const summaryPath = join(run_dir, HOLDOUT_SUMMARY_FILENAME);
  await writeJsonAtomic(resultsPath, results);
  await writeFile(summaryPath, renderHoldoutSummary(results), "utf-8");

  logger.info("holdout.run.awaiting_verdicts", {
    holdout_id: holdoutQueries.holdout_id,
    run_id,
    run_dir,
    recall_at_5: results.answerable.recall_at_5.point,
  });
  if (!quiet) {
    process.stderr.write(
      `\nHoldout run reached AWAITING VERDICTS: ${run_dir}\n` +
        `Doc-level retrieval is FINAL (recall@5 ${(results.answerable.recall_at_5.point * 100).toFixed(1)}%); ` +
        `reader correctness is pending external agent judging (NO API).\n\n` +
        `Next:\n` +
        `  1. Judge ${judgeTasksPath} with the orchestrator's Sonnet agents (see JUDGE-RUNNER.md).\n` +
        `  2. june-eval score-holdout ${run_dir} --verdicts <verdicts.json>\n` +
        `Holdout numbers are SEALED — reported separately, never pinned or gated.\n`,
    );
  }
};

// ---------------------------------------------------------------------------
// score-holdout — finalize an awaiting-verdicts holdout from external verdicts
// ---------------------------------------------------------------------------
export const runScoreHoldout = async (argv: readonly string[]): Promise<void> => {
  const { positionals, flags } = parseArgv(argv);
  if (positionals.includes("--help") || positionals.length < 1) {
    process.stderr.write(SCORE_HELP);
    if (positionals.length < 1) throw new UsageError("Missing <run_dir>");
    return;
  }
  await bootstrap(flags);

  const run_dir = resolve(positionals[0]!);
  const verdictsArg = flagString(flags, "verdicts");
  if (verdictsArg === undefined) throw new UsageError("Missing --verdicts <file>.\n\n" + SCORE_HELP);

  const resultsPath = join(run_dir, HOLDOUT_RESULTS_FILENAME);
  const summaryPath = join(run_dir, HOLDOUT_SUMMARY_FILENAME);
  const partial = (await readJson(resultsPath)) as HoldoutResultsFile;
  if (partial.kind !== "holdout") {
    throw new UsageError(`score-holdout: ${resultsPath} is not a holdout result (kind=${(partial as { kind?: string }).kind}).`);
  }

  const verdicts = validateHoldoutVerdicts(await readJson(resolve(verdictsArg)));
  if (verdicts.run_id && verdicts.run_id !== partial.run_id) {
    throw new UsageError(`verdicts.json is for run ${verdicts.run_id} but ${resultsPath} is run ${partial.run_id}.`);
  }
  const stamped = partial.manifest.judge.prompt_template_hash;
  if (stamped && verdicts.judge.prompt_template_hash !== stamped) {
    logger.warn("score_holdout.judge_prompt_mismatch", {
      run_stamped: stamped,
      verdicts_used: verdicts.judge.prompt_template_hash,
    });
  }

  const judge: JudgeProvenance = verdicts.judge;
  const final = rescoreHoldoutWithVerdicts({
    partial,
    verdicts: verdicts.verdicts,
    judge,
    run_status: "completed",
    completed_at: new Date().toISOString(),
  });
  await writeJsonAtomic(resultsPath, final);
  await writeFile(summaryPath, renderHoldoutSummary(final), "utf-8");

  logger.info("holdout.score.complete", {
    run_id: final.run_id,
    judge_model: judge.model,
    answerable_recall_at_5: final.answerable.recall_at_5.point,
    reader_rag_correct_pct: final.reader_rag_correct_pct.point,
  });
  process.stderr.write(
    `Scored holdout ${final.run_id} (judge ${judge.model}). ` +
      `Doc recall@5 ${(final.answerable.recall_at_5.point * 100).toFixed(1)}%, ` +
      `reader correct% (RAG) ${(final.reader_rag_correct_pct.point * 100).toFixed(1)}%` +
      `${final.reader_norag_correct_pct ? ` vs no-RAG ${(final.reader_norag_correct_pct.point * 100).toFixed(1)}%` : ""}.\n` +
      `Wrote ${resultsPath} + ${summaryPath}. SEALED — never pinned/gated. Lead with retrieval (parametric caveat).\n`,
  );
};

// --- helpers ---------------------------------------------------------------

/** Reads `corpus/*.md` from a split dir back into `RealDoc`s (slug = filename stem). */
const readRealDocs = async (splitDir: string): Promise<RealDoc[]> => {
  const manifest = (await readJson(join(splitDir, "corpus_manifest.json"))) as CorpusManifest;
  const docs: RealDoc[] = [];
  for (const d of manifest.documents) {
    const markdown = await readFile(join(splitDir, "corpus", d.filename), "utf-8");
    docs.push({
      slug: d.filename.replace(/\.md$/, ""),
      title: d.document_title,
      url: "",
      markdown,
    });
  }
  // Re-attach source URLs from the labeling plan when present (provenance).
  if (await fileExists(join(splitDir, PLAN_FILENAME))) {
    const plan = (await readJson(join(splitDir, PLAN_FILENAME))) as {
      documents: Array<{ filename: string; url: string }>;
    };
    const urlByFile = new Map(plan.documents.map((p) => [p.filename, p.url]));
    for (const d of docs) d.url = urlByFile.get(docFilename(d)) ?? "";
  }
  return docs;
};

/** Resolves the holdout reader from --mode (forces the reader; reader stays LOCAL). */
const resolveHoldoutReader = (
  flags: Record<string, string | boolean>,
): { run_mode: RunMode; reader_provider_name: ReaderProvider; reader_model: string } => {
  const mode_flag = flagString(flags, "mode");
  const reader_provider = flagString(flags, "reader-provider");
  const reader_model_flag = flagString(flags, "reader-model");
  if (mode_flag === "iterate" || mode_flag === "control") {
    if (reader_provider !== undefined || reader_model_flag !== undefined) {
      throw new UsageError("--mode and --reader-provider/--reader-model are mutually exclusive.");
    }
    const ref = RUN_MODES[mode_flag];
    return { run_mode: mode_flag, reader_provider_name: ref.provider, reader_model: ref.model };
  }
  if (reader_provider !== undefined || reader_model_flag !== undefined) {
    const provider = (reader_provider ?? "ollama") as ReaderProvider;
    return {
      run_mode: "freeform",
      reader_provider_name: provider,
      reader_model: reader_model_flag ?? "gemma4:26b",
    };
  }
  throw new UsageError(
    "Declare run intent: --mode control (gemma4:26b, the bar — recommended for the holdout) | --mode iterate | explicit --reader-* (freeform). See packages/mcp/bench/CLAUDE.md.",
  );
};
void isControlReader;

/** Adapts holdout queries into the Stage-7 `QueriesFile` shape (tier = answerability). */
const toSyntheticQueries = (holdout: HoldoutQueriesFile): QueriesFile => ({
  fixture_id: holdout.holdout_id,
  schema_version: 1,
  query_author: { provider: "real", model: "labeled" },
  queries: holdout.queries.map((q) => ({
    id: q.id,
    tier: q.unanswerable ? ("T5" as const) : ("T1" as const),
    text: q.text,
    expected_fact_ids: [],
    anti_leakage_score: null,
    generation_attempts: 1,
  })),
});

/** Adapts holdout retrievals into the Stage-7 `RetrievalResultsFile` shape. */
const toRetrievalResultsFile = (
  holdout_id: string,
  ingest_run_id: string,
  retriever: { name: string; config_snapshot: Record<string, unknown> },
  retrievals: ReadonlyMap<string, RetrievalResult[]>,
): RetrievalResultsFile => ({
  fixture_id: holdout_id,
  ingest_run_id,
  retriever_config: { adapter: retriever.name, retrieval_config_snapshot: retriever.config_snapshot },
  results: [...retrievals.entries()].map(([query_id, retrieved]) => ({
    query_id,
    retrieved,
    recall_at_k: { "1": 0, "3": 0, "5": 0, "10": 0 },
    mrr: 0,
    t5_top1_score: null,
  })),
});

const SPLIT_HELP = `june-eval holdout-split — slice a real docs file into a holdout corpus + labeling plan (NO API).

USAGE
  june-eval holdout-split <source.txt> [--out <dir>] [--url-prefix <p>] [--max-docs <n>]
                          [--source-name <s>] [--source-url <u>] [--config <path>]

Splits a concatenated docs file (Next.js llms-full.txt shape) on its frontmatter
boundaries into self-contained real documents, keeping a COHERENT subset
(--url-prefix, e.g. /docs/app/getting-started) capped at --max-docs. Writes
corpus/*.md + corpus_manifest.json (no planted facts) + labeling_plan.json. Then
agents hand-label Q/A → labels.json and \`june-eval holdout-assemble\`. See HOLDOUT.md.
`;

const ASSEMBLE_HELP = `june-eval holdout-assemble — validate agent labels into a holdout fixture (NO API).

USAGE
  june-eval holdout-assemble <split_dir> --labels <file> --label-model <m> [--out <dir>] [--config <path>]

Reads the split dir's corpus + a labels.json ({ labels: [{ text, expected_doc_filenames,
gold_answer, unanswerable? }] }), validates each label (expected docs exist; answerable ⇒
a gold answer; unanswerable ⇒ no expected docs), and writes corpus_manifest.json +
holdout_queries.json. Then \`june-eval freeze-holdout\`.
`;

const FREEZE_HELP = `june-eval freeze-holdout — commit a holdout as an immutable, SEALED, hash-locked artifact.

USAGE
  june-eval freeze-holdout <holdout_dir> --name <name> [--signoff <who>] [--note <text>]
                           [--source-name <s>] [--source-url <u>] [--force] [--out <dir>] [--config <path>]

Copies corpus/ + corpus_manifest.json + holdout_queries.json into fixtures/<name>/ and
writes ${HOLDOUT_LOCK_FILENAME} (canonical hash + per-file hashes + provenance). A sealed
holdout is reported separately and is NEVER pinned, gated, or tuned against.
`;

const VERIFY_HELP = `june-eval verify-holdout — re-check a frozen holdout against its lock.

USAGE
  june-eval verify-holdout <holdout_dir> [--config <path>]

Recomputes every file's SHA-256 and the canonical holdout hash and compares them to
${HOLDOUT_LOCK_FILENAME}. Exits 1 (tampered) on any drift, 0 when intact.
`;

const RUN_HELP = `june-eval run-holdout — run the sealed real-doc holdout (doc-level retrieval + reader).

USAGE
  june-eval run-holdout <holdout_dir> --mode <m> [--out <dir>] [--no-baseline] [--quiet]
                        [--ingest-config <path>] [--config <path>]

Ingests the real corpus, scores DOC-LEVEL recall@k/MRR over the labeled expected docs
(the un-contaminated signal — lead with it), runs the LOCAL reader (+ a no-RAG same-reader
baseline unless --no-baseline; the RAG−noRAG delta is the honest reader signal under
parametric contamination), and emits holdout_judge_tasks.json (run_status awaiting_verdicts).
Then judge with agents and \`june-eval score-holdout\`. Reader-by-purpose: use --mode control
(gemma4:26b). Holdout numbers are SEALED — never pinned or gated.
`;

const SCORE_HELP = `june-eval score-holdout — finalize an awaiting-verdicts holdout from external verdicts.

USAGE
  june-eval score-holdout <run_dir> --verdicts <verdicts.json> [--config <path>]

Overlays external agent verdicts (JUDGE-RUNNER.md) onto a partial holdout_results.json and
rewrites it + holdout_summary.md as completed. Retrieval metrics are untouched. No LLM called.
The result stays SEALED (kind: holdout) — structurally excluded from the golden gate.
`;
