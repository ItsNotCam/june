// author: Claude
/**
 * Isomorphic protocol between the Next server (`lib/server/ingest-runner.ts`)
 * and the ingest bridge subprocess (`@june/mcp-ingest`'s `cli/web-bridge.ts`).
 *
 * The bridge runs the real pipeline in a Bun child process (cwd = the ingest
 * package, so its internal `@/` aliases resolve) and writes one
 * sentinel-prefixed JSON object per line to stdout. The runner filters stdout
 * by the sentinel, strips it, and validates each line against
 * `BridgeEventSchema`. Pipeline log noise on stdout never matches the sentinel
 * and is ignored.
 *
 * This module imports nothing Node-only — it is safe to import from both the
 * server runner and the client `IngestClient` (which needs only the inferred
 * event type).
 */
import { z } from "zod";

/**
 * Marker prepended to every protocol line the bridge emits. Pure ASCII, no
 * spaces or null bytes (it is passed to the bridge as a spawn argv, which
 * rejects null bytes). Chosen to never collide with human-readable Winston
 * output. Passed to the bridge via argv so the bridge never imports this module.
 */
export const EVENT_SENTINEL = "@@JUNE_EVT@@";

/** Pipeline stages surfaced to the UI, in execution order. Drives the progress bar. */
export const INGEST_STAGES = [
  "parsed",
  "chunked",
  "contextualized",
  "embedded",
  "stored",
] as const;

export const IngestStageSchema = z.enum(INGEST_STAGES);
export type IngestStage = z.infer<typeof IngestStageSchema>;

/** A document as listed from the sidecar for the uploads table. */
export const DocumentRowSchema = z.object({
  docId: z.string(),
  name: z.string(),
  sourceUri: z.string(),
  version: z.string(),
  status: z.string(),
  byteLength: z.number().int().nonnegative(),
  ingestedAt: z.string(),
  /** True when this doc has a staged file on disk the server can delete on wipe. */
  hasStagedFile: z.boolean(),
});
export type DocumentRow = z.infer<typeof DocumentRowSchema>;

const RunStartFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  sourceUri: z.string(),
  docId: z.string(),
});

/**
 * Discriminated union of every event the bridge can emit. The runner validates
 * each parsed line against this; the client switches on `type` to update rows.
 */
export const BridgeEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run_start"), files: z.array(RunStartFileSchema) }),
  z.object({ type: z.literal("file_start"), id: z.string() }),
  z.object({
    type: z.literal("stage"),
    id: z.string(),
    stage: IngestStageSchema,
    detail: z.string().optional(),
  }),
  z.object({ type: z.literal("file_done"), id: z.string(), durationMs: z.number() }),
  z.object({ type: z.literal("file_skipped"), id: z.string(), reason: z.string() }),
  z.object({ type: z.literal("file_error"), id: z.string(), message: z.string() }),
  z.object({
    type: z.literal("run_done"),
    processed: z.number().int(),
    skipped: z.number().int(),
    errored: z.number().int(),
  }),
  z.object({ type: z.literal("documents"), documents: z.array(DocumentRowSchema) }),
  z.object({
    type: z.literal("purged"),
    docId: z.string(),
    purgedVersions: z.number().int(),
    purgedChunks: z.number().int(),
  }),
  z.object({ type: z.literal("fatal"), message: z.string() }),
]);
export type BridgeEvent = z.infer<typeof BridgeEventSchema>;

/** A single file handed to the bridge for ingestion (already staged on disk). */
export const BridgeStagedFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
});
export type BridgeStagedFile = z.infer<typeof BridgeStagedFileSchema>;

/**
 * Command the runner writes to the bridge's stdin (one JSON object, then EOF).
 * Discriminated on `cmd` so the bridge dispatches without ambiguity.
 */
export const BridgeCommandSchema = z.discriminatedUnion("cmd", [
  z.object({ cmd: z.literal("ingest"), files: z.array(BridgeStagedFileSchema) }),
  z.object({ cmd: z.literal("list") }),
  z.object({ cmd: z.literal("purge"), docId: z.string() }),
]);
export type BridgeCommand = z.infer<typeof BridgeCommandSchema>;

/** Request body for the wipe endpoint. */
export const PurgeRequestSchema = z.object({ docId: z.string().min(1) });
export type PurgeRequest = z.infer<typeof PurgeRequestSchema>;
