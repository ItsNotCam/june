// author: Claude
/**
 * Machine-facing JSON bridge for the Next.js ingestion UI (`@june/next`).
 *
 * Why a subprocess: the Next app cannot import `@june/mcp-ingest` in-process —
 * Bun resolves the package's internal `@/` path alias against the *caller's*
 * tsconfig, which in `packages/next` points elsewhere and breaks resolution.
 * Spawning this script with cwd = the ingest package sidesteps that entirely
 * (and keeps `bun:sqlite` + native deps out of the Next bundle).
 *
 * Protocol: the runner writes one `BridgeCommand` JSON object to stdin (then
 * EOF) and passes a sentinel string as argv[2]. This script emits one
 * sentinel-prefixed JSON event per line to stdout; pipeline log noise on
 * stdout never carries the sentinel and is ignored by the runner.
 */
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { ingestPath } from "@/pipeline/ingest";
import { purge } from "@/pipeline/purge";
import { buildDeps } from "@/pipeline/factory";
import { createSqliteSidecar } from "@/lib/storage/sqlite";
import { createQdrantStorage } from "@/lib/storage/qdrant";
import { createStubEmbedder } from "@/lib/embedder/stub";
import { createStubSummarizer } from "@/lib/summarizer/stub";
import { deriveDocIdFromUri } from "@/lib/ids";
import { getConfig } from "@/lib/config";
import { SidecarLockHeldError } from "@/lib/errors";
import { asDocId } from "@/types/ids";
import { bootstrap } from "./shared";
import type { ProgressReporter } from "@/lib/progress";
import type { CommonFlags } from "./shared";

const CommandSchema = z.discriminatedUnion("cmd", [
  z.object({
    cmd: z.literal("ingest"),
    files: z.array(z.object({ id: z.string(), name: z.string(), path: z.string() })),
  }),
  z.object({ cmd: z.literal("list") }),
  z.object({ cmd: z.literal("purge"), docId: z.string() }),
]);

const SENTINEL = process.argv[2] ?? "@@JUNE_EVT@@";

/** Bridge runs read-only-ish: quiet, JSON logs, config from CONFIG_PATH env. */
const FLAGS: CommonFlags = {
  configPath: undefined,
  quiet: true,
  jsonLog: true,
  verifyOffline: false,
  yes: true,
};

const emit = (event: Record<string, unknown>): void => {
  process.stdout.write(`${SENTINEL}${JSON.stringify(event)}\n`);
};

const LOCK_RETRY_DELAY_MS = 750;
const LOCK_RETRY_MAX_MS = 300_000;
const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

/**
 * Run a lock-acquiring operation, waiting + retrying while another run holds
 * the single-writer SQLite lock instead of failing. Lets the runner admit
 * `INGEST_MAX_PARALLEL` operations that then serialize gracefully at the lock.
 * The lock is acquired before any work, so retrying is side-effect-free.
 */
const withLockRetry = async <T>(fn: () => Promise<T>): Promise<T> => {
  const deadline = Date.now() + LOCK_RETRY_MAX_MS;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof SidecarLockHeldError && Date.now() < deadline) {
        await sleep(LOCK_RETRY_DELAY_MS);
        continue;
      }
      throw err;
    }
  }
};

/** Best-effort human name from a source URI (prefers the file basename). */
const nameFromUri = (uri: string): string => {
  try {
    return basename(new URL(uri).pathname) || uri;
  } catch {
    return basename(uri) || uri;
  }
};

const runIngest = async (
  files: ReadonlyArray<{ id: string; name: string; path: string }>,
): Promise<void> => {
  const deps = await buildDeps();
  emit({
    type: "run_start",
    files: files.map((f) => {
      const sourceUri = pathToFileURL(f.path).toString();
      // Display-only id for the dashboard. NOTE: this is the URI-domain id and may
      // differ from the stored relpath-based doc_id when ingest runs under a source_root.
      return {
        id: f.id,
        name: f.name,
        sourceUri,
        docId: deriveDocIdFromUri(sourceUri) as string,
      };
    }),
  });

  let processed = 0;
  let skipped = 0;
  let errored = 0;

  for (const f of files) {
    emit({ type: "file_start", id: f.id });
    let terminal = false;
    const progress: ProgressReporter = {
      start: () => {},
      close: () => {},
      tick: (_uri, stage, extra) =>
        emit({ type: "stage", id: f.id, stage, detail: extra }),
      doc_done: (_uri, durationMs) => {
        terminal = true;
        emit({ type: "file_done", id: f.id, durationMs });
      },
      doc_skipped: (_uri, reason) => {
        terminal = true;
        emit({ type: "file_skipped", id: f.id, reason });
      },
      doc_errored: (_uri, message) => {
        terminal = true;
        emit({ type: "file_error", id: f.id, message });
      },
    };

    try {
      const result = await withLockRetry(() =>
        ingestPath({ path: f.path, deps, trigger: "api", progress }),
      );
      processed += result.processed;
      skipped += result.skipped;
      errored += result.errored;
      // The "unchanged" short-circuit returns skipped without a progress
      // callback — synthesize a terminal event so the row never hangs.
      if (!terminal) {
        if (result.skipped > 0) emit({ type: "file_skipped", id: f.id, reason: "unchanged" });
        else if (result.errored > 0) emit({ type: "file_error", id: f.id, message: "errored" });
        else emit({ type: "file_done", id: f.id, durationMs: 0 });
      }
    } catch (err) {
      errored++;
      emit({
        type: "file_error",
        id: f.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  emit({ type: "run_done", processed, skipped, errored });
  await deps.storage.sidecar.close();
};

const runList = async (): Promise<void> => {
  const sidecar = await createSqliteSidecar(getConfig().sidecar.path);
  try {
    const docs = await sidecar.listLatestDocuments();
    emit({
      type: "documents",
      documents: docs.map((d) => ({
        docId: d.doc_id as string,
        name: d.document_title || nameFromUri(d.source_uri),
        sourceUri: d.source_uri,
        version: d.version as string,
        status: d.status,
        byteLength: d.byte_length,
        ingestedAt: d.ingested_at,
        hasStagedFile: false,
      })),
    });
  } finally {
    await sidecar.close();
  }
};

const runPurge = async (docId: string): Promise<void> => {
  const sidecar = await createSqliteSidecar(getConfig().sidecar.path);
  const deps = {
    storage: { sidecar, vector: createQdrantStorage() },
    embedder: createStubEmbedder(),
    summarizer: createStubSummarizer(),
  };
  try {
    const result = await withLockRetry(() =>
      purge({ deps, doc_id: asDocId(docId), allVersions: true }),
    );
    emit({ type: "purged", docId, purgedVersions: result.purgedVersions, purgedChunks: result.purgedChunks });
  } finally {
    await sidecar.close();
  }
};

const main = async (): Promise<void> => {
  const raw = await Bun.stdin.text();
  const command = CommandSchema.parse(JSON.parse(raw));
  await bootstrap(FLAGS);

  switch (command.cmd) {
    case "ingest":
      await runIngest(command.files);
      break;
    case "list":
      await runList();
      break;
    case "purge":
      await runPurge(command.docId);
      break;
  }
};

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    emit({ type: "fatal", message: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
