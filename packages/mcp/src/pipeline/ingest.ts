import { readdir, stat } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { ulid } from "ulid";
import { logger } from "@/lib/logger";
import { startHeartbeat } from "@/lib/lock";
import { createSilentReporter, type ProgressReporter } from "@/lib/progress";
import { isShutdownRequested } from "@/lib/shutdown";
import { asRunId, asVersion } from "@/types/ids";
import { bindingFor, runStage1 } from "./stages/01-discover";
import { runStage2 } from "./stages/02-parse";
import { runStage3 } from "./stages/03-chunk";
import { runStage4 } from "./stages/04-derive";
import { runStage5 } from "./stages/05-classify";
import { runStage6 } from "./stages/06-summarize";
import { runStage7 } from "./stages/07-link";
import { runStage8 } from "./stages/08-embed-text";
import { runStage9 } from "./stages/09-embed";
import { runStage10 } from "./stages/10-store";
import type { Document } from "@/types/document";
import type { RunId, Version } from "@/types/ids";
import type { IngestionRun } from "@/types/run";
import type { PipelineDeps } from "./factory";

/**
 * Pipeline orchestrator ([§13](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#13-stage-overview-table)). Drives stages 1–10 per document, with
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
};

export type IngestResult = {
  readonly run: IngestionRun;
  readonly processed: number;
  readonly skipped: number;
  readonly errored: number;
};

const MD_EXTS = new Set([".md", ".markdown"]);

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
 * Run the pipeline for a single file, starting from the document's current
 * status. Stages 1–3 + 10 persist in their own transactions; the stages
 * between derive in-memory. Resume compatibility: callers may also pass a
 * pre-existing `Document` (from Stage 1's "resume" result) to skip directly
 * to the appropriate stage.
 */
const processFile = async (
  absolutePath: string,
  opts: {
    deps: PipelineDeps;
    runId: RunId;
    runVersion: Version;
    cliVersion: Version | undefined;
    progress: ProgressReporter;
    force: boolean;
  },
): Promise<"processed" | "skipped" | "errored"> => {
  const { deps, progress } = opts;
  const source_uri = pathToFileURL(absolutePath).toString();
  const { sidecar, vector, classifier, summarizer, embedder } = {
    sidecar: deps.storage.sidecar,
    vector: deps.storage.vector,
    classifier: deps.classifier,
    summarizer: deps.summarizer,
    embedder: deps.embedder,
  };

  // ---- Stage 1 (own tx) ----
  const tx1 = await sidecar.begin();
  let stage1;
  try {
    stage1 = await runStage1({
      absolutePath,
      runId: opts.runId,
      runVersion: opts.runVersion,
      cliVersion: opts.cliVersion,
      sidecar,
      tx: tx1,
      force: opts.force,
    });
    await tx1.commit();
  } catch (err) {
    await tx1.rollback();
    throw err;
  }

  if (stage1.kind === "unchanged") return "skipped";
  if (stage1.kind === "skipped_too_large") return "skipped";

  const document: Document =
    stage1.kind === "resume" ? stage1.document : stage1.document;
  const rawBytes =
    stage1.kind === "resume" || stage1.kind === "ingest" || stage1.kind === "resurrection"
      ? stage1.rawBytes
      : undefined;
  if (!rawBytes) return "skipped";

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
      return "skipped";
    }
    if (s2.kind === "failed") {
      progress.doc_errored(source_uri, s2.error_type);
      return "errored";
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

  // ---- Stage 4 (pure CPU, no tx) ----
  const derived = runStage4({ chunked });

  // ---- Stage 5 (no document-level tx; errors row in own tx) ----
  const binding = bindingFor(document.source_uri);
  const tx5 = await sidecar.begin();
  let classified;
  try {
    classified = await runStage5({
      chunks: derived.chunks,
      classifier,
      sidecar,
      runId: opts.runId,
      binding,
    });
    await tx5.commit();
  } catch (err) {
    await tx5.rollback();
    throw err;
  }

  // ---- Stage 6 (own tx; advances chunks.status to contextualized) ----
  const tx6 = await sidecar.begin();
  let summarized;
  try {
    summarized = await runStage6({
      document: parsed.document,
      body: parsed.raw_normalized,
      sections: chunked.sections,
      chunks: classified.chunks,
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

  // ---- Stage 7 (pure; internal sidecar reads) ----
  const linked = await runStage7({ chunks: summarized.chunks, sidecar });

  // ---- Stage 8 (pure; records audit rows on truncation in own tx) ----
  const tx8 = await sidecar.begin();
  let composed;
  try {
    composed = await runStage8({ chunks: linked.chunks, sidecar, runId: opts.runId });
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
      document: parsed.document,
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
  progress.tick(source_uri, "embedded");

  // ---- Stage 10 (own tx) ----
  const tx10 = await sidecar.begin();
  try {
    await runStage10({
      document: parsed.document,
      chunks: embedded.chunks,
      priorVersion,
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
  progress.tick(source_uri, "stored");

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

    progress.start(files.length);

    for (const abs of files) {
      if (isShutdownRequested()) {
        logger.info("ingest_shutdown_requested", {
          event: "ingest_shutdown_requested",
          count: processed + skipped + errored,
        });
        break;
      }
      const docStart = performance.now();
      try {
        const res = await processFile(abs, {
          deps: opts.deps,
          runId,
          runVersion,
          cliVersion: opts.cliVersion,
          progress,
          force: opts.force ?? false,
        });
        if (res === "processed") {
          processed++;
          progress.doc_done(pathToFileURL(abs).toString(), performance.now() - docStart);
        } else if (res === "skipped") {
          skipped++;
        } else {
          errored++;
        }
      } catch (err) {
        errored++;
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("doc_failed", {
          event: "doc_failed",
          source_uri: abs,
          error_message: msg,
        });
        progress.doc_errored(pathToFileURL(abs).toString(), msg);
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
  }
};
