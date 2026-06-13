// author: Claude
/**
 * Server-only driver for the markdown ingestion UI. Spawns the
 * `@june/mcp-ingest` web bridge as a Bun child process (cwd = the ingest
 * package, so its `@/` aliases + `bun:sqlite` resolve) and translates its
 * sentinel-prefixed NDJSON stdout into typed `BridgeEvent`s.
 *
 * Never imports `@june/mcp-ingest` directly — that would drag the pipeline's
 * `@/`-aliased source (and `bun:sqlite`) into the Next bundle. All pipeline
 * work happens in the spawned process.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { z } from "zod";
import {
  BridgeEventSchema,
  EVENT_SENTINEL,
  type BridgeCommand,
  type BridgeEvent,
  type DocumentRow,
} from "@/lib/ingest-events";

/** Absolute path to the ingest package — overridable for non-standard layouts. */
const INGEST_PKG_DIR =
  process.env["INGEST_PKG_DIR"] ?? resolve(process.cwd(), "..", "mcp", "ingest");
const BRIDGE_PATH = join(INGEST_PKG_DIR, "cli", "web-bridge.ts");
const BUN_BIN = process.env["BUN_BIN"] ?? "bun";

/** Where uploaded markdown is staged so it has a real path + a file to wipe. */
const STAGING_DIR =
  process.env["INGEST_STAGING_DIR"] ?? join(process.cwd(), ".ingest-uploads");
const MANIFEST_PATH = join(STAGING_DIR, "manifest.json");

/** An uploaded file's bytes + original name, before staging. */
export type Upload = { name: string; bytes: Uint8Array };

type StagedFile = { id: string; name: string; path: string };

const ManifestSchema = z.record(
  z.string(),
  z.object({ path: z.string(), name: z.string() }),
);
type Manifest = z.infer<typeof ManifestSchema>;

// ---- Single-writer serialization -------------------------------------------
// Each bridge process acquires the pipeline's single-writer SQLite lock, so
// write commands (ingest, purge) must not overlap. Reads (list) are exempt.
let tail: Promise<unknown> = Promise.resolve();
const withWriteLock = <T>(fn: () => Promise<T>): Promise<T> => {
  const result = tail.then(fn, fn);
  tail = result.catch(() => undefined);
  return result;
};

// ---- Manifest (docId -> staged file) ---------------------------------------
const readManifest = async (): Promise<Manifest> => {
  try {
    const raw = await readFile(MANIFEST_PATH, "utf8");
    return ManifestSchema.parse(JSON.parse(raw));
  } catch {
    // Missing or malformed manifest is non-fatal — treat as empty.
    return {};
  }
};

const writeManifest = async (manifest: Manifest): Promise<void> => {
  await mkdir(STAGING_DIR, { recursive: true });
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf8");
};

// ---- Staging ---------------------------------------------------------------
const sanitizeName = (name: string): string => {
  const base = basename(name).replace(/[^A-Za-z0-9._-]/g, "_");
  return base.length > 0 ? base : "upload.md";
};

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const uniquePath = async (name: string): Promise<string> => {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = join(STAGING_DIR, name);
  let n = 1;
  while (await fileExists(candidate)) {
    candidate = join(STAGING_DIR, `${stem}-${n}${ext}`);
    n++;
  }
  return candidate;
};

const stageUploads = async (uploads: ReadonlyArray<Upload>): Promise<StagedFile[]> => {
  await mkdir(STAGING_DIR, { recursive: true });
  const staged: StagedFile[] = [];
  for (const upload of uploads) {
    const path = await uniquePath(sanitizeName(upload.name));
    await writeFile(path, upload.bytes);
    staged.push({ id: randomUUID(), name: upload.name, path });
  }
  return staged;
};

// ---- Bridge subprocess -----------------------------------------------------
/**
 * Spawn the bridge for a single command, forwarding every validated event to
 * `onEvent`. Resolves on clean exit; rejects with the bridge's `fatal` message
 * (or stderr) on failure.
 */
const spawnBridge = (
  command: BridgeCommand,
  onEvent: (event: BridgeEvent) => void,
): Promise<void> =>
  new Promise<void>((resolvePromise, reject) => {
    const child = spawn(BUN_BIN, ["run", BRIDGE_PATH, EVENT_SENTINEL], {
      cwd: INGEST_PKG_DIR,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let buffer = "";
    let stderr = "";
    let fatal: string | undefined;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith(EVENT_SENTINEL)) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line.slice(EVENT_SENTINEL.length));
        } catch {
          continue;
        }
        const event = BridgeEventSchema.safeParse(parsed);
        if (!event.success) continue;
        if (event.data.type === "fatal") fatal = event.data.message;
        onEvent(event.data);
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(fatal ?? stderr.slice(0, 2000) ?? `bridge exited ${code}`));
    });

    child.stdin.end(JSON.stringify(command));
  });

// ---- Public API ------------------------------------------------------------
/**
 * Stage `uploads` to disk and run the full pipeline over them, streaming each
 * `BridgeEvent` to `onEvent`. On `run_start` the staged paths are recorded in
 * the manifest so a later wipe can delete them.
 */
export const runIngest = async (
  uploads: ReadonlyArray<Upload>,
  onEvent: (event: BridgeEvent) => void,
): Promise<void> =>
  withWriteLock(async () => {
    const staged = await stageUploads(uploads);
    const byId = new Map(staged.map((s) => [s.id, s] as const));
    const manifest = await readManifest();

    await spawnBridge({ cmd: "ingest", files: staged }, (event) => {
      if (event.type === "run_start") {
        for (const f of event.files) {
          const path = byId.get(f.id)?.path;
          if (path) manifest[f.docId] = { path, name: f.name };
        }
      }
      onEvent(event);
    });

    await writeManifest(manifest);
  });

/** List every latest document from the sidecar, flagging which have a staged file. */
export const listDocuments = async (): Promise<DocumentRow[]> => {
  const rows: DocumentRow[] = [];
  await spawnBridge({ cmd: "list" }, (event) => {
    if (event.type === "documents") rows.push(...event.documents);
  });
  const manifest = await readManifest();
  return rows.map((row) => ({ ...row, hasStagedFile: Boolean(manifest[row.docId]) }));
};

/** Hard-delete a document (Qdrant + SQLite) and unlink its staged file, if any. */
export const purgeDocument = async (
  docId: string,
): Promise<{ purgedVersions: number; purgedChunks: number }> =>
  withWriteLock(async () => {
    let result: { purgedVersions: number; purgedChunks: number } | undefined;
    await spawnBridge({ cmd: "purge", docId }, (event) => {
      if (event.type === "purged") {
        result = { purgedVersions: event.purgedVersions, purgedChunks: event.purgedChunks };
      }
    });

    const manifest = await readManifest();
    const entry = manifest[docId];
    if (entry?.path) {
      await rm(entry.path, { force: true });
      delete manifest[docId];
      await writeManifest(manifest);
    }

    return result ?? { purgedVersions: 0, purgedChunks: 0 };
  });
