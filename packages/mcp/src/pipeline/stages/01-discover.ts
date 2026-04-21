// author: Claude
import { realpath, stat } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { getConfig } from "@/lib/config";
import { FileTooLargeError } from "@/lib/errors";
import { deriveContentHashBytes, deriveDocId } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { SOURCE_SYSTEM_TO_SOURCE_TYPE } from "@/types/vocab";
import type { Document } from "@/types/document";
import type { DocId, RunId, Version } from "@/types/ids";
import type { SourceSystem, SourceType } from "@/types/vocab";
import type { SidecarStorage, Tx } from "@/lib/storage/types";
import { asDocId, asVersion } from "@/types/ids";

/**
 * Stage 1 — File Ingest & Provenance Capture ([§14](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#14-stage-1--file-ingest--provenance-capture)).
 *
 * Reads the file, computes `doc_id` + `content_hash`, resolves a version,
 * consults SQLite for prior state, and either short-circuits (unchanged),
 * inserts a new version row, or signals "resume mid-pipeline".
 */

export type Stage1Input = {
  readonly absolutePath: string;
  readonly runId: RunId;
  readonly runVersion: Version;
  readonly cliVersion: Version | undefined;
  readonly sidecar: SidecarStorage;
  readonly tx: Tx;
  /** When true, skip the unchanged short-circuit and re-ingest even if content hash + status match. */
  readonly force?: boolean;
};

export type Stage1Result =
  | { kind: "ingest"; document: Document; rawBytes: Uint8Array }
  | { kind: "unchanged"; document: Document }
  | { kind: "resume"; document: Document; rawBytes: Uint8Array }
  | { kind: "skipped_too_large"; source_uri: string; bytes: number }
  | { kind: "resurrection"; document: Document; rawBytes: Uint8Array };

const pickFrontmatterVersion = (raw: string): Version | undefined => {
  // Lightweight pre-parse for Stage 1's version resolution: look for
  // `version:` inside the frontmatter block only. The real frontmatter
  // parse runs in Stage 2 with the zod schema.
  if (!raw.startsWith("---\n")) return undefined;
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return undefined;
  const block = raw.slice(4, end);
  const match = block.match(/^\s*version\s*:\s*(.+?)\s*$/m);
  if (!match || !match[1]) return undefined;
  const cleaned = match[1].trim().replace(/^["']|["']$/g, "");
  if (cleaned.length === 0) return undefined;
  return asVersion(cleaned);
};

/**
 * Resolve the final version per [§14.6](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#146-version-resolution): CLI flag > frontmatter > run timestamp.
 * The raw-bytes parameter lets us peek at frontmatter before Stage 2 runs.
 */
export const resolveVersion = (
  cliVersion: Version | undefined,
  rawBytesUtf8: string,
  runVersion: Version,
): Version => {
  if (cliVersion) return cliVersion;
  const fm = pickFrontmatterVersion(rawBytesUtf8);
  if (fm) return fm;
  return runVersion;
};

export const sourceTypeFor = (source_system: SourceSystem): SourceType =>
  SOURCE_SYSTEM_TO_SOURCE_TYPE[source_system] ?? "internal";

/**
 * Convert an absolute filesystem path into the canonical `file://` URI form
 * used for `doc_id` derivation ([§14.5](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#145-doc_id-derivation)). Symlinks are resolved first so two
 * paths to the same file produce the same `doc_id`.
 */
export const toCanonicalFileUri = async (path: string): Promise<string> => {
  const real = await realpath(resolvePath(path));
  return pathToFileURL(real).toString();
};

/** Stage 1's configured source-system/namespace overrides ([§17.1](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#171-document-level-fields-computed-once-per-document-applied-to-every-chunk) + config `sources`). */
type SourceBinding = {
  source_system: SourceSystem;
  source_type: SourceType;
  namespace: string;
  project: string | undefined;
};

/**
 * Look up the per-path `sources` override from config ([§29.2](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#292-the-configyaml-reference)). Glob matching
 * is not yet supported — only exact `source_uri` prefix match — because v1
 * operators are expected to set system-wide defaults until they need more.
 */
export const bindingFor = (source_uri: string): SourceBinding => {
  const cfg = getConfig();
  for (const [prefix, override] of Object.entries(cfg.sources)) {
    if (source_uri.startsWith(prefix)) {
      const system = override.source_system ?? "local";
      return {
        source_system: system,
        source_type: override.source_type ?? sourceTypeFor(system),
        namespace: override.namespace ?? "personal",
        project: override.project,
      };
    }
  }
  return {
    source_system: "local",
    source_type: "internal",
    namespace: "personal",
    project: undefined,
  };
};

/**
 * Execute Stage 1 for a single file. Returns a discriminated union that tells
 * the orchestrator what to do next (proceed to Stage 2, skip, or resume from
 * the document's current status).
 */
export const runStage1 = async (input: Stage1Input): Promise<Stage1Result> => {
  const cfg = getConfig();
  const file = Bun.file(input.absolutePath);
  const byteLength = file.size;
  if (byteLength > cfg.ingest.max_file_bytes) {
    logger.warn("file_too_large", {
      event: "file_too_large",
      source_uri: input.absolutePath,
      size_chars: byteLength,
    });
    await input.sidecar.recordError({
      run_id: input.runId,
      doc_id: undefined,
      version: undefined,
      chunk_id: undefined,
      stage: "1",
      error_type: "file_too_large",
      error_message: new FileTooLargeError(
        input.absolutePath,
        byteLength,
        cfg.ingest.max_file_bytes,
      ).message,
      occurred_at: new Date().toISOString(),
    });
    return {
      kind: "skipped_too_large",
      source_uri: input.absolutePath,
      bytes: byteLength,
    };
  }

  const rawBytes = new Uint8Array(await file.arrayBuffer());
  const sourceUri = await toCanonicalFileUri(input.absolutePath);
  const doc_id: DocId = deriveDocId(sourceUri);
  const content_hash = deriveContentHashBytes(rawBytes);

  // Peek at frontmatter for version + title. A strict-UTF8 decode may fail
  // for exotic encodings; that's fine — Stage 2 does the authoritative
  // normalization and will surface any failure.
  let utf8Peek = "";
  try {
    utf8Peek = new TextDecoder("utf-8", { fatal: false }).decode(rawBytes);
  } catch {
    utf8Peek = "";
  }

  const version = resolveVersion(input.cliVersion, utf8Peek, input.runVersion);
  const binding = bindingFor(sourceUri);

  let source_modified_at: string | undefined;
  try {
    const st = await stat(input.absolutePath);
    source_modified_at = st.mtime.toISOString();
  } catch {
    source_modified_at = undefined;
  }

  const existing = await input.sidecar.getLatestDocumentByUri(sourceUri);

  const baseDoc: Document = {
    doc_id,
    version,
    schema_version: 1,
    source_uri: sourceUri,
    source_system: binding.source_system,
    source_type: binding.source_type,
    namespace: binding.namespace,
    project: binding.project,
    document_title: "",
    content_hash,
    byte_length: byteLength,
    source_modified_at,
    ingested_at: new Date().toISOString(),
    ingested_by: input.runId,
    status: "pending",
    is_latest: true,
    deleted_at: undefined,
    doc_category: undefined,
    doc_sensitivity: undefined,
    doc_lifecycle_status: undefined,
    frontmatter: {},
  };

  if (!existing) {
    // First-time ingest.
    await input.sidecar.upsertDocument(input.tx, baseDoc);
    logger.info("doc_ingest_new", {
      event: "doc_ingest_new",
      doc_id: doc_id as string,
      source_uri: sourceUri,
    });
    return { kind: "ingest", document: baseDoc, rawBytes };
  }

  // Row exists — four subcases ([§14.8](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#148-existing-state-lookup-and-re-ingest-decision)).
  if (
    !input.force &&
    existing.content_hash === content_hash &&
    existing.status === "stored" &&
    !existing.deleted_at
  ) {
    logger.info("doc_unchanged", {
      event: "doc_unchanged",
      doc_id: doc_id as string,
      source_uri: sourceUri,
    });
    return { kind: "unchanged", document: existing };
  }

  if (existing.deleted_at) {
    // Soft-deleted — resurrection path. Insert fresh version.
    await input.sidecar.upsertDocument(input.tx, baseDoc);
    logger.info("doc_resurrected", {
      event: "doc_resurrected",
      doc_id: doc_id as string,
      source_uri: sourceUri,
    });
    return { kind: "resurrection", document: baseDoc, rawBytes };
  }

  if (existing.content_hash !== content_hash) {
    // New version.
    await input.sidecar.upsertDocument(input.tx, baseDoc);
    logger.info("doc_new_version", {
      event: "doc_new_version",
      doc_id: doc_id as string,
      source_uri: sourceUri,
    });
    return { kind: "ingest", document: baseDoc, rawBytes };
  }

  // Content_hash matches but status != 'stored' — prior ingest crashed.
  logger.info("doc_resume", {
    event: "doc_resume",
    doc_id: doc_id as string,
    source_uri: sourceUri,
    status: existing.status,
  });
  return { kind: "resume", document: existing, rawBytes };
};

export const _internal = { asDocId, pickFrontmatterVersion } as const;
