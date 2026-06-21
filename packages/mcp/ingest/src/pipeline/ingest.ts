// author: Claude
import { readdir, stat } from "node:fs/promises";
import { dirname, join, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { ulid } from "ulid";
import { getConfig } from "#internal/lib/config";
import { logger } from "#internal/lib/logger";
import { startHeartbeat } from "#internal/lib/lock";
import { createSilentReporter, type ProgressReporter } from "#internal/lib/progress";
import { isShutdownRequested } from "#internal/lib/shutdown";
import { asRunId, asVersion } from "#internal/types/ids";
import { runStage1, runStage1FromContent } from "./stages/01-discover";
import { runStage2 } from "./stages/02-parse";
import { runStage3 } from "./stages/03-chunk";
import { runStage6 } from "./stages/06-summarize";
import type { SummarizedChunk } from "./stages/06-summarize";
import { runStage8 } from "./stages/08-embed-text";
import { runStage9 } from "./stages/09-embed";
import { runStage10 } from "./stages/10-store";
import type { Stage1Result } from "./stages/01-discover";
import type { Document } from "#internal/types/document";
import type { RunId, Version } from "#internal/types/ids";
import type { IngestionRun } from "#internal/types/run";
import type { PipelineDeps } from "./factory";

/**
 * Pipeline orchestrator ([§13](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#13-stage-overview-table)). Drives stages 1–10 per document, with
 * resume-aware entry per `documents.status` and a single run-scoped lock.
 */

export type IngestOptions = {
  readonly path: string;
  readonly runId?: RunId;
  readonly cliVersion?: Version;
  readonly deps: PipelineDeps;
  readonly trigger?: IngestionRun["trigger"];
  readonly progress?: ProgressReporter;
  /** Re-ingest even if the file is already stored and content hash matches. */
  readonly force?: boolean;
  /**
   * Root that `doc_id` is derived relative to (portable across worktrees). Highest
   * precedence; falls back to `config.ingest.source_root`, then git-toplevel
   * autodetect, then the URI hash. See {@link resolveSourceRoot}.
   */
  readonly sourceRoot?: string;
};

export type IngestResult = {
  readonly run: IngestionRun;
  readonly processed: number;
  readonly skipped: number;
  readonly errored: number;
};

const MD_EXTS = new Set([".md", ".markdown"]);

/** Git toplevel of `startDir`, or undefined if not in a repo / git unavailable. */
const gitToplevel = (startDir: string): string | undefined => {
  try {
    const res = Bun.spawnSync([
      "git",
      "-C",
      startDir,
      "rev-parse",
      "--show-toplevel",
    ]);
    if (res.exitCode !== 0) return undefined;
    const out = new TextDecoder().decode(res.stdout).trim();
    return out.length > 0 ? resolvePath(out) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Resolve the `source_root` for portable `doc_id` derivation, once per run.
 * Precedence: explicit opt > `config.ingest.source_root` > git toplevel of the
 * ingest dir > undefined (⇒ URI-hash fallback in Stage 1).
 */
const resolveSourceRoot = (
  ingestDir: string,
  optsRoot: string | undefined,
): string | undefined => {
  if (optsRoot) return resolvePath(optsRoot);
  const cfgRoot = getConfig().ingest.source_root;
  if (cfgRoot) return resolvePath(cfgRoot);
  return gitToplevel(ingestDir);
};

const walkMarkdownFiles = async (root: string): Promise<string[]> => {
  const out: string[] = [];
  const visit = async (p: string): Promise<void> => {
    const st = await stat(p);
    if (st.isFile()) {
      const dot = p.lastIndexOf(".");
      if (dot >= 0 && MD_EXTS.has(p.slice(dot).toLowerCase())) {
        out.push(p);
      }
      return;
    }
    if (st.isDirectory()) {
      const entries = await readdir(p);
      entries.sort((a, b) => a.localeCompare(b));
      for (const e of entries) {
        await visit(join(p, e));
      }
    }
  };
  await visit(resolvePath(root));
  return out;
};

/**
 * Two-phase ingest carrier. A document that has cleared the SUMMARIZE phase
 * (Stages 1–6) in memory, ready for the EMBED phase (Stages 8–10). Phase B
 * consumes `chunks` directly and never re-reads summaries from the DB, so the
 * summarizer can be fully unloaded from VRAM before Phase B begins.
 */
type SummarizedDoc = {
  readonly document: Document;
  readonly chunks: ReadonlyArray<SummarizedChunk>;
  readonly priorVersion: Version | undefined;
  readonly source_uri: string;
};

/**
 * Max docs carried in memory per phase window. Each window runs
 * {summarize all → unload summarizer → embed all → unload embedder}, so only ONE
 * model is GPU-resident at a time (the fix for single-GPU summarizer↔embedder
 * VRAM contention). A window ≥ corpus size ⇒ a single model swap for the whole
 * run (the 19-doc holdout is one window); a large vault swaps once per window
 * instead of once per doc, which both removes the thrash AND bounds the
 * in-memory `SummarizedDoc[]`.
 */
const DEFAULT_PHASE_WINDOW = 256;

type PhaseOpts = {
  readonly deps: PipelineDeps;
  readonly runId: RunId;
  readonly progress: ProgressReporter;
};

/** Stage 1 (discover) for a file, in its own transaction. */
const discoverFile = async (
  absolutePath: string,
  opts: {
    deps: PipelineDeps;
    runId: RunId;
    runVersion: Version;
    cliVersion: Version | undefined;
    force: boolean;
    sourceRoot: string | undefined;
  },
): Promise<Stage1Result> => {
  const sidecar = opts.deps.storage.sidecar;
  const tx1 = await sidecar.begin();
  try {
    const stage1 = await runStage1({
      absolutePath,
      runId: opts.runId,
      runVersion: opts.runVersion,
      cliVersion: opts.cliVersion,
      sidecar,
      tx: tx1,
      force: opts.force,
      sourceRoot: opts.sourceRoot,
    });
    await tx1.commit();
    return stage1;
  } catch (err) {
    await tx1.rollback();
    throw err;
  }
};

/** Stage 1 (discover) for an in-memory document, in its own transaction. */
const discoverContent = async (
  rawBytes: Uint8Array,
  sourceUri: string,
  opts: {
    deps: PipelineDeps;
    runId: RunId;
    runVersion: Version;
    cliVersion: Version | undefined;
    source_modified_at: string | undefined;
    force: boolean;
  },
): Promise<Stage1Result> => {
  const sidecar = opts.deps.storage.sidecar;
  const tx1 = await sidecar.begin();
  try {
    const stage1 = await runStage1FromContent({
      rawBytes,
      sourceUri,
      source_modified_at: opts.source_modified_at,
      runId: opts.runId,
      runVersion: opts.runVersion,
      cliVersion: opts.cliVersion,
      sidecar,
      tx: tx1,
      force: opts.force,
    });
    await tx1.commit();
    return stage1;
  } catch (err) {
    await tx1.rollback();
    throw err;
  }
};

/**
 * SUMMARIZE phase — Stages 2,3,6 for one discovered document. Returns the
 * in-memory `SummarizedDoc` carrier on success, or a terminal disposition.
 * Uses only the summarizer (not the embedder). Each stage commits in its own
 * transaction; an unexpected stage failure throws and is tallied by the caller.
 */
const runSummarizePhase = async (
  stage1: Stage1Result,
  source_uri: string,
  opts: PhaseOpts,
): Promise<
  { kind: "ok"; doc: SummarizedDoc } | { kind: "skipped" } | { kind: "errored" }
> => {
  const { deps, progress } = opts;
  const sidecar = deps.storage.sidecar;
  const summarizer = deps.summarizer;

  if (stage1.kind === "unchanged") return { kind: "skipped" };
  if (stage1.kind === "skipped_too_large") return { kind: "skipped" };

  // Remaining kinds (ingest / resume / resurrection) all carry rawBytes.
  const document: Document = stage1.document;
  const rawBytes = stage1.rawBytes;

  // Capture the prior version before we touch status in Stage 2+.
  const allVersions = await sidecar.listVersionsForDoc(document.doc_id);
  const priorLatest = allVersions.find(
    (v) => v.version !== document.version && v.is_latest,
  );
  const priorVersion = priorLatest?.version;

  // ---- Stage 2 (own tx) ----
  const tx2 = await sidecar.begin();
  let parsed;
  try {
    const s2 = await runStage2({
      document,
      rawBytes,
      runId: opts.runId,
      sidecar,
      tx: tx2,
    });
    await tx2.commit();
    if (s2.kind === "skipped_empty" || s2.kind === "skipped_metadata_only") {
      progress.doc_skipped(source_uri, s2.kind);
      return { kind: "skipped" };
    }
    if (s2.kind === "failed") {
      progress.doc_errored(source_uri, s2.error_type);
      return { kind: "errored" };
    }
    parsed = s2.parsed;
    progress.tick(source_uri, "parsed");
  } catch (err) {
    await tx2.rollback();
    throw err;
  }

  // ---- Stage 3 (own tx) ----
  const tx3 = await sidecar.begin();
  let chunked;
  try {
    chunked = await runStage3({ parsed, sidecar, tx: tx3 });
    await tx3.commit();
  } catch (err) {
    await tx3.rollback();
    throw err;
  }
  progress.tick(
    source_uri,
    "chunked",
    `${chunked.chunks.length} chunks, ${chunked.sections.length} sections`,
  );

  // ---- Stage 6 (own tx; advances chunks.status to contextualized) ----
  const tx6 = await sidecar.begin();
  let summarized;
  try {
    summarized = await runStage6({
      document: parsed.document,
      body: parsed.raw_normalized,
      sections: chunked.sections,
      chunks: chunked.chunks,
      summarizer,
      sidecar,
      tx: tx6,
      runId: opts.runId,
    });
    await tx6.commit();
  } catch (err) {
    await tx6.rollback();
    throw err;
  }
  progress.tick(source_uri, "contextualized");

  return {
    kind: "ok",
    doc: {
      document: parsed.document,
      chunks: summarized.chunks,
      priorVersion,
      source_uri,
    },
  };
};

/**
 * EMBED phase — Stages 8,9,10 for one already-summarized document. Uses only
 * the embedder (the summarizer is unloaded before this runs). Stage 8 is pure —
 * it re-derives the embed-text from the in-memory summarized chunks, so no
 * summary is ever re-read from the DB. Throws on an unexpected stage failure
 * (tallied by the caller).
 */
const runEmbedPhase = async (
  doc: SummarizedDoc,
  opts: PhaseOpts,
): Promise<"processed"> => {
  const { deps, progress } = opts;
  const sidecar = deps.storage.sidecar;
  const vector = deps.storage.vector;
  const embedder = deps.embedder;

  // ---- Stage 8 (pure; records audit rows on truncation in own tx) ----
  const tx8 = await sidecar.begin();
  let composed;
  try {
    composed = await runStage8({ chunks: doc.chunks, sidecar, runId: opts.runId });
    await tx8.commit();
  } catch (err) {
    await tx8.rollback();
    throw err;
  }

  // ---- Stage 9 (own tx; advances chunks.status to embedded) ----
  const tx9 = await sidecar.begin();
  let embedded;
  try {
    embedded = await runStage9({
      document: doc.document,
      chunks: composed.chunks,
      embedder,
      sidecar,
      tx: tx9,
      runId: opts.runId,
    });
    await tx9.commit();
  } catch (err) {
    await tx9.rollback();
    throw err;
  }
  progress.tick(doc.source_uri, "embedded");

  // ---- Stage 10 (own tx) ----
  const tx10 = await sidecar.begin();
  try {
    await runStage10({
      document: doc.document,
      chunks: embedded.chunks,
      priorVersion: doc.priorVersion,
      vector,
      sidecar,
      tx: tx10,
      runId: opts.runId,
    });
    await tx10.commit();
  } catch (err) {
    await tx10.rollback();
    throw err;
  }
  progress.tick(doc.source_uri, "stored");

  return "processed";
};

/**
 * Ingest a single file OR a directory (recursive). Acquires the single-writer
 * lock for the duration of the run and releases it on exit (graceful or not).
 */
export const ingestPath = async (opts: IngestOptions): Promise<IngestResult> => {
  const runId = opts.runId ?? asRunId(ulid());
  const runVersion = asVersion(new Date().toISOString());
  const startedAt = new Date().toISOString();

  const { sidecar } = opts.deps.storage;
  await sidecar.acquireWriteLock(runId);
  const heartbeat = startHeartbeat(sidecar, runId);

  const trigger = opts.trigger ?? "cli";
  const run: IngestionRun = {
    run_id: runId,
    started_at: startedAt,
    completed_at: undefined,
    trigger,
    doc_count: 0,
    chunk_count: 0,
    error_count: 0,
  };
  await sidecar.putRun(run);
  await opts.deps.storage.vector.ensureCollections(opts.deps.embedder.dim);

  const progress = opts.progress ?? createSilentReporter();

  let processed = 0;
  let skipped = 0;
  let errored = 0;

  try {
    const absRoot = resolvePath(opts.path);
    const st = await stat(absRoot);
    const files = st.isDirectory()
      ? await walkMarkdownFiles(absRoot)
      : [absRoot];

    // Resolve the portable-doc_id root once for the whole run.
    const sourceRoot = resolveSourceRoot(
      st.isDirectory() ? absRoot : dirname(absRoot),
      opts.sourceRoot,
    );
    logger.info("ingest_source_root", {
      event: "ingest_source_root",
      source_root: sourceRoot ?? "(none — URI-hash doc_id)",
    });

    progress.start(files.length);

    const phaseOpts: PhaseOpts = { deps: opts.deps, runId, progress };

    // Two-phase, windowed: per window summarize ALL docs → unload the summarizer
    // → embed ALL docs → unload the embedder. Only one model is GPU-resident at a
    // time, so the summarizer (gemma) and embedder never thrash the GPU. See
    // DEFAULT_PHASE_WINDOW.
    for (let start = 0; start < files.length; start += DEFAULT_PHASE_WINDOW) {
      if (isShutdownRequested()) {
        logger.info("ingest_shutdown_requested", {
          event: "ingest_shutdown_requested",
          count: processed + skipped + errored,
        });
        break;
      }
      const window = files.slice(start, start + DEFAULT_PHASE_WINDOW);

      // Free the embedder — its startup dim-probe (first window) or the prior
      // window's embed phase leaves it resident — so Phase A has the full GPU.
      await opts.deps.embedder.unload();

      // ---- Phase A: summarize every doc in the window (embedder NOT resident) ----
      const summarizedDocs: SummarizedDoc[] = [];
      for (const abs of window) {
        if (isShutdownRequested()) break;
        const source_uri = pathToFileURL(abs).toString();
        try {
          const stage1 = await discoverFile(abs, {
            deps: opts.deps,
            runId,
            runVersion,
            cliVersion: opts.cliVersion,
            force: opts.force ?? false,
            sourceRoot,
          });
          const r = await runSummarizePhase(stage1, source_uri, phaseOpts);
          if (r.kind === "ok") summarizedDocs.push(r.doc);
          else if (r.kind === "skipped") skipped++;
          else errored++;
        } catch (err) {
          errored++;
          const msg = err instanceof Error ? err.message : String(err);
          logger.error("doc_failed", {
            event: "doc_failed",
            source_uri: abs,
            error_message: msg,
          });
          progress.doc_errored(source_uri, msg);
        }
      }

      // ---- Boundary: free the summarizer's VRAM before the embedder loads ----
      await opts.deps.summarizer.unload();

      // ---- Phase B: embed every summarized doc (summarizer NOT resident) ----
      for (const doc of summarizedDocs) {
        if (isShutdownRequested()) break;
        const docStart = performance.now();
        try {
          await runEmbedPhase(doc, phaseOpts);
          processed++;
          progress.doc_done(doc.source_uri, performance.now() - docStart);
        } catch (err) {
          errored++;
          const msg = err instanceof Error ? err.message : String(err);
          logger.error("doc_failed", {
            event: "doc_failed",
            source_uri: doc.source_uri,
            error_message: msg,
          });
          progress.doc_errored(doc.source_uri, msg);
        }
      }
    }

    const completedAt = new Date().toISOString();
    await sidecar.updateRun(runId, {
      completed_at: completedAt,
      doc_count: processed,
      chunk_count: 0,
      error_count: errored,
    });
    return {
      run: {
        ...run,
        completed_at: completedAt,
        doc_count: processed,
        chunk_count: 0,
        error_count: errored,
      },
      processed,
      skipped,
      errored,
    };
  } finally {
    heartbeat.stop();
    progress.close();
    await sidecar.releaseWriteLock(runId);
    // Free the embed model's VRAM at the run boundary so a downstream reader
    // (gemma) never contends with it. Best-effort — unload() never throws.
    await opts.deps.embedder.unload();
  }
};

export type IngestContentOptions = {
  /** Raw markdown. UTF-8 string or `Uint8Array` of UTF-8 bytes. */
  readonly content: string | Uint8Array;
  /**
   * Caller-supplied virtual URI; participates in `doc_id` derivation, so the
   * same URI + same content is correctly recognized as unchanged on re-call.
   * Pick a stable scheme per source — e.g. `mcp://session/<id>/<name>.md`.
   * Never accept this from an untrusted client without sanitizing — but it is
   * not a filesystem path and is never opened, so the security risk is purely
   * about namespace collision, not file disclosure.
   */
  readonly sourceUri: string;
  readonly deps: PipelineDeps;
  readonly runId?: RunId;
  readonly cliVersion?: Version;
  readonly trigger?: IngestionRun["trigger"];
  readonly progress?: ProgressReporter;
  readonly force?: boolean;
  /** Optional caller-supplied source modification time (ISO-8601). */
  readonly source_modified_at?: string;
};

/**
 * Ingest a single in-memory markdown document. Same lock + run-row
 * accounting + idempotency as `ingestPath`, but with no filesystem read —
 * the caller hands over the bytes and a virtual URI.
 *
 * This is the preferred entry point for network-facing surfaces (MCP tools,
 * HTTP endpoints) where accepting an arbitrary filesystem path would expose
 * an arbitrary-file-read primitive to the caller.
 */
export const ingestContent = async (
  opts: IngestContentOptions,
): Promise<IngestResult> => {
  const runId = opts.runId ?? asRunId(ulid());
  const runVersion = asVersion(new Date().toISOString());
  const startedAt = new Date().toISOString();

  const { sidecar } = opts.deps.storage;
  await sidecar.acquireWriteLock(runId);
  const heartbeat = startHeartbeat(sidecar, runId);

  const trigger = opts.trigger ?? "api";
  const run: IngestionRun = {
    run_id: runId,
    started_at: startedAt,
    completed_at: undefined,
    trigger,
    doc_count: 0,
    chunk_count: 0,
    error_count: 0,
  };
  await sidecar.putRun(run);
  await opts.deps.storage.vector.ensureCollections(opts.deps.embedder.dim);

  const progress = opts.progress ?? createSilentReporter();
  const rawBytes =
    typeof opts.content === "string"
      ? new TextEncoder().encode(opts.content)
      : opts.content;

  let processed = 0;
  let skipped = 0;
  let errored = 0;

  try {
    progress.start(1);

    const docStart = performance.now();
    try {
      // Same two-phase discipline as ingestPath (one doc = one window): free the
      // embedder, summarize, unload the summarizer, then embed. A single doc never
      // alternated, but this keeps both entry points structurally identical.
      await opts.deps.embedder.unload();
      const phaseOpts: PhaseOpts = { deps: opts.deps, runId, progress };
      const stage1 = await discoverContent(rawBytes, opts.sourceUri, {
        deps: opts.deps,
        runId,
        runVersion,
        cliVersion: opts.cliVersion,
        source_modified_at: opts.source_modified_at,
        force: opts.force ?? false,
      });
      const r = await runSummarizePhase(stage1, opts.sourceUri, phaseOpts);
      if (r.kind === "ok") {
        await opts.deps.summarizer.unload();
        await runEmbedPhase(r.doc, phaseOpts);
        processed++;
        progress.doc_done(opts.sourceUri, performance.now() - docStart);
      } else if (r.kind === "skipped") {
        skipped++;
      } else {
        errored++;
      }
    } catch (err) {
      errored++;
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("doc_failed", {
        event: "doc_failed",
        source_uri: opts.sourceUri,
        error_message: msg,
      });
      progress.doc_errored(opts.sourceUri, msg);
    }

    const completedAt = new Date().toISOString();
    await sidecar.updateRun(runId, {
      completed_at: completedAt,
      doc_count: processed,
      chunk_count: 0,
      error_count: errored,
    });
    return {
      run: {
        ...run,
        completed_at: completedAt,
        doc_count: processed,
        chunk_count: 0,
        error_count: errored,
      },
      processed,
      skipped,
      errored,
    };
  } finally {
    heartbeat.stop();
    progress.close();
    await sidecar.releaseWriteLock(runId);
    // Free the embed model's VRAM at the run boundary so a downstream reader
    // (gemma) never contends with it. Best-effort — unload() never throws.
    await opts.deps.embedder.unload();
  }
};
