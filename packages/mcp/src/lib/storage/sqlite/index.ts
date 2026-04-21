// author: Claude
import { Database } from "bun:sqlite";
import { hostname } from "node:os";
import { SidecarLockHeldError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { asChunkId, asDocId, asRunId, asSectionId, asVersion } from "@/types/ids";
import type { Chunk } from "@/types/chunk";
import type { Document } from "@/types/document";
import type { Section } from "@/types/section";
import type { ChunkStatus, DocumentStatus } from "@/types/vocab";
import type { SidecarStorage, Tx } from "../types";
import { openSidecar } from "./migrate";

/**
 * SQLite-backed SidecarStorage ([§10](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#10-sqlite-sidecar-schema)). Handles:
 *   - Single-writer lock with 30s heartbeat + 90s stale-break (I2).
 *   - `ingestion_runs` / `documents` / `sections` / `chunks` CRUD.
 *   - `ingestion_errors` + `reconcile_events` append-only audit trails.
 *
 * The interface is dialect-agnostic ([§32](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#32-public-api-surface) / I13); callers never see `Database`.
 */

const LOCK_ID = 1;
const STALE_LOCK_S = 90;

type DocumentRow = {
  doc_id: string;
  version: string;
  source_uri: string;
  content_hash: string;
  is_latest: number;
  source_modified_at: string | null;
  ingested_at: string;
  schema_version: number;
  status: string;
  deleted_at: string | null;
  ingestion_run_id: string;
};

type ChunkRow = {
  chunk_id: string;
  doc_id: string;
  version: string;
  section_id: string;
  chunk_index: number;
  status: string;
  content_hash: string;
  raw_content: string;
  contextual_summary: string | null;
  embedding_model_name: string | null;
  embedding_model_version: string | null;
  embedded_at: string | null;
  created_at: string;
};

type SectionRow = {
  section_id: string;
  version: string;
  doc_id: string;
  heading_path: string;
  content: string;
  char_start: number;
  char_end: number;
  created_at: string;
};

type LockRow = {
  lock_id: number;
  run_id: string;
  acquired_at: string;
  last_heartbeat_at: string;
  host: string;
  pid: number;
};

const nowIso = (): string => new Date().toISOString();
const toBool = (n: number): boolean => n === 1;
const fromBool = (b: boolean): number => (b ? 1 : 0);

const rowToDocument = (r: DocumentRow): Document => ({
  doc_id: asDocId(r.doc_id),
  version: asVersion(r.version),
  schema_version: r.schema_version,
  source_uri: r.source_uri,
  source_system: "local",
  source_type: "internal",
  namespace: "personal",
  project: undefined,
  document_title: "",
  content_hash: r.content_hash,
  byte_length: 0,
  source_modified_at: r.source_modified_at ?? undefined,
  ingested_at: r.ingested_at,
  ingested_by: asRunId(r.ingestion_run_id),
  status: r.status as DocumentStatus,
  is_latest: toBool(r.is_latest),
  deleted_at: r.deleted_at ?? undefined,
  doc_category: undefined,
  doc_sensitivity: undefined,
  doc_lifecycle_status: undefined,
  frontmatter: {},
});

/** SQLite transaction handle. `commit` / `rollback` are idempotent once called. */
class SqliteTx implements Tx {
  private closed = false;

  constructor(private readonly db: Database) {
    db.exec("BEGIN");
  }

  commit(): void {
    if (this.closed) return;
    this.db.exec("COMMIT");
    this.closed = true;
  }

  rollback(): void {
    if (this.closed) return;
    this.db.exec("ROLLBACK");
    this.closed = true;
  }
}

/**
 * Factory — opens the SQLite file at `path`, runs migrations, returns a
 * `SidecarStorage`. Caller invokes `.close()` on shutdown ([§24.5](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#245-graceful-shutdown-per-i8)).
 */
export const createSqliteSidecar = async (
  path: string,
): Promise<SidecarStorage> => {
  const db = await openSidecar(path);

  const begin = (): Tx => new SqliteTx(db);

  const acquireWriteLock: SidecarStorage["acquireWriteLock"] = async (
    run_id,
  ) => {
    const now = nowIso();
    const host = hostname();
    const pid = process.pid;
    try {
      db.query(
        `INSERT INTO ingestion_lock
          (lock_id, run_id, acquired_at, last_heartbeat_at, host, pid)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(LOCK_ID, run_id as string, now, now, host, pid);
      logger.info("lock_acquired", { event: "lock_acquired", run_id: run_id as string });
      return;
    } catch (err) {
      // PK conflict — existing lock row. Check staleness.
      const existing = db
        .query<LockRow, [number]>("SELECT * FROM ingestion_lock WHERE lock_id = ?")
        .get(LOCK_ID);
      if (!existing) throw err;
      const heartbeatAgeS = Math.floor(
        (Date.now() - new Date(existing.last_heartbeat_at).getTime()) / 1000,
      );
      if (heartbeatAgeS > STALE_LOCK_S) {
        logger.warn("lock_broken_stale", {
          event: "lock_broken_stale",
          run_id: existing.run_id,
          heartbeat_age_s: heartbeatAgeS,
        });
        db.query("DELETE FROM ingestion_lock WHERE lock_id = ?").run(LOCK_ID);
        db.query(
          `INSERT INTO ingestion_lock
            (lock_id, run_id, acquired_at, last_heartbeat_at, host, pid)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(LOCK_ID, run_id as string, now, now, host, pid);
        logger.info("lock_acquired", { event: "lock_acquired", run_id: run_id as string });
        return;
      }
      throw new SidecarLockHeldError(asRunId(existing.run_id), heartbeatAgeS);
    }
  };

  const heartbeat: SidecarStorage["heartbeat"] = async (run_id) => {
    db.query(
      "UPDATE ingestion_lock SET last_heartbeat_at = ? WHERE lock_id = ? AND run_id = ?",
    ).run(nowIso(), LOCK_ID, run_id as string);
  };

  const releaseWriteLock: SidecarStorage["releaseWriteLock"] = async (
    run_id,
  ) => {
    db.query("DELETE FROM ingestion_lock WHERE lock_id = ? AND run_id = ?").run(
      LOCK_ID,
      run_id as string,
    );
    logger.info("lock_released", { event: "lock_released", run_id: run_id as string });
  };

  const putRun: SidecarStorage["putRun"] = async (run) => {
    db.query(
      `INSERT OR REPLACE INTO ingestion_runs
        (run_id, started_at, completed_at, doc_count, chunk_count, error_count, trigger)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      run.run_id as string,
      run.started_at,
      run.completed_at ?? null,
      run.doc_count ?? null,
      run.chunk_count ?? null,
      run.error_count ?? null,
      run.trigger,
    );
  };

  const updateRun: SidecarStorage["updateRun"] = async (run_id, patch) => {
    const sets: string[] = [];
    const args: Array<string | number | null> = [];
    if ("completed_at" in patch) {
      sets.push("completed_at = ?");
      args.push(patch.completed_at ?? null);
    }
    if ("doc_count" in patch) {
      sets.push("doc_count = ?");
      args.push(patch.doc_count ?? null);
    }
    if ("chunk_count" in patch) {
      sets.push("chunk_count = ?");
      args.push(patch.chunk_count ?? null);
    }
    if ("error_count" in patch) {
      sets.push("error_count = ?");
      args.push(patch.error_count ?? null);
    }
    if (sets.length === 0) return;
    args.push(run_id as string);
    db.query(
      `UPDATE ingestion_runs SET ${sets.join(", ")} WHERE run_id = ?`,
    ).run(...args);
  };

  const upsertDocument: SidecarStorage["upsertDocument"] = async (_tx, doc) => {
    db.query(
      `INSERT OR REPLACE INTO documents
        (doc_id, version, source_uri, content_hash, is_latest,
         source_modified_at, ingested_at, schema_version, status, deleted_at,
         ingestion_run_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      doc.doc_id as string,
      doc.version as string,
      doc.source_uri,
      doc.content_hash,
      fromBool(doc.is_latest),
      doc.source_modified_at ?? null,
      doc.ingested_at,
      doc.schema_version,
      doc.status,
      doc.deleted_at ?? null,
      doc.ingested_by as string,
    );
  };

  const getLatestDocumentByUri: SidecarStorage["getLatestDocumentByUri"] =
    async (source_uri) => {
      const row = db
        .query<DocumentRow, [string]>(
          `SELECT * FROM documents
            WHERE source_uri = ? AND is_latest = 1
            ORDER BY ingested_at DESC
            LIMIT 1`,
        )
        .get(source_uri);
      return row ? rowToDocument(row) : undefined;
    };

  const getLatestDocument: SidecarStorage["getLatestDocument"] = async (
    doc_id,
  ) => {
    const row = db
      .query<DocumentRow, [string]>(
        `SELECT * FROM documents
          WHERE doc_id = ? AND is_latest = 1
          ORDER BY ingested_at DESC
          LIMIT 1`,
      )
      .get(doc_id as string);
    return row ? rowToDocument(row) : undefined;
  };

  const getDocument: SidecarStorage["getDocument"] = async (doc_id, version) => {
    const row = db
      .query<DocumentRow, [string, string]>(
        "SELECT * FROM documents WHERE doc_id = ? AND version = ?",
      )
      .get(doc_id as string, version as string);
    return row ? rowToDocument(row) : undefined;
  };

  const setDocumentStatus: SidecarStorage["setDocumentStatus"] = async (
    _tx,
    doc_id,
    version,
    status,
  ) => {
    db.query(
      "UPDATE documents SET status = ? WHERE doc_id = ? AND version = ?",
    ).run(status, doc_id as string, version as string);
  };

  const flipPriorIsLatest: SidecarStorage["flipPriorIsLatest"] = async (
    _tx,
    doc_id,
    new_version,
  ) => {
    db.query(
      `UPDATE documents SET is_latest = 0
        WHERE doc_id = ? AND version != ? AND is_latest = 1`,
    ).run(doc_id as string, new_version as string);
  };

  const clearDeletedAt: SidecarStorage["clearDeletedAt"] = async (
    _tx,
    doc_id,
  ) => {
    db.query(
      "UPDATE documents SET deleted_at = NULL WHERE doc_id = ? AND deleted_at IS NOT NULL",
    ).run(doc_id as string);
  };

  const listLatestDocuments: SidecarStorage["listLatestDocuments"] =
    async () => {
      const rows = db
        .query<DocumentRow, []>(
          "SELECT * FROM documents WHERE is_latest = 1 AND deleted_at IS NULL",
        )
        .all();
      return rows.map(rowToDocument);
    };

  const listDocumentsByStatus: SidecarStorage["listDocumentsByStatus"] = async (
    status,
  ) => {
    const rows = db
      .query<DocumentRow, [string]>(
        "SELECT * FROM documents WHERE status = ? AND is_latest = 1",
      )
      .all(status);
    return rows.map(rowToDocument);
  };

  const listVersionsForDoc: SidecarStorage["listVersionsForDoc"] = async (
    doc_id,
  ) => {
    const rows = db
      .query<DocumentRow, [string]>(
        "SELECT * FROM documents WHERE doc_id = ? ORDER BY ingested_at DESC",
      )
      .all(doc_id as string);
    return rows.map(rowToDocument);
  };

  const putSections: SidecarStorage["putSections"] = async (_tx, sections) => {
    const stmt = db.query(
      `INSERT OR REPLACE INTO sections
        (section_id, version, doc_id, heading_path, content,
         char_start, char_end, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const createdAt = nowIso();
    for (const s of sections) {
      stmt.run(
        s.section_id as string,
        s.version as string,
        s.doc_id as string,
        JSON.stringify(s.heading_path),
        s.content,
        s.char_offset_start,
        s.char_offset_end,
        createdAt,
      );
    }
  };

  const getSectionsForDoc: SidecarStorage["getSectionsForDoc"] = async (
    doc_id,
    version,
  ) => {
    const rows = db
      .query<SectionRow, [string, string]>(
        "SELECT * FROM sections WHERE doc_id = ? AND version = ? ORDER BY char_start",
      )
      .all(doc_id as string, version as string);
    return rows.map((r): Section => {
      const headingPath = JSON.parse(r.heading_path) as string[];
      return {
        section_id: asSectionId(r.section_id),
        doc_id: asDocId(r.doc_id),
        version: asVersion(r.version),
        parent_section_id: undefined,
        heading_level: 1,
        heading_text: headingPath[headingPath.length - 1] ?? "",
        heading_path: headingPath,
        ordinal: 0,
        byte_offset_start: r.char_start,
        byte_offset_end: r.char_end,
        char_offset_start: r.char_start,
        char_offset_end: r.char_end,
        content_hash: "",
        content: r.content,
        raw_markdown: r.content,
      };
    });
  };

  const putChunks: SidecarStorage["putChunks"] = async (_tx, chunks) => {
    const stmt = db.query(
      `INSERT OR REPLACE INTO chunks
        (chunk_id, doc_id, version, section_id, chunk_index, status,
         content_hash, raw_content, contextual_summary,
         embedding_model_name, embedding_model_version, embedded_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const createdAt = nowIso();
    for (const c of chunks) {
      stmt.run(
        c.chunk_id as string,
        c.doc_id as string,
        c.version as string,
        c.section_id as string,
        c.chunk_index_in_document,
        c.status,
        c.content_hash,
        c.content,
        c.contextual_summary.length > 0 ? c.contextual_summary : null,
        c.embedding_model_name.length > 0 ? c.embedding_model_name : null,
        c.embedding_model_version.length > 0 ? c.embedding_model_version : null,
        c.embedded_at.length > 0 ? c.embedded_at : null,
        createdAt,
      );
    }
  };

  const setChunkStatus: SidecarStorage["setChunkStatus"] = async (
    _tx,
    chunk_id,
    status,
  ) => {
    db.query("UPDATE chunks SET status = ? WHERE chunk_id = ?").run(
      status,
      chunk_id as string,
    );
  };

  const setChunkSummary: SidecarStorage["setChunkSummary"] = async (
    _tx,
    chunk_id,
    contextual_summary,
  ) => {
    db.query(
      `UPDATE chunks
          SET contextual_summary = ?,
              status = 'contextualized'
        WHERE chunk_id = ? AND status = 'pending'`,
    ).run(contextual_summary, chunk_id as string);
  };

  const setChunkEmbedded: SidecarStorage["setChunkEmbedded"] = async (
    _tx,
    chunk_id,
    model_name,
    model_version,
    embedded_at,
  ) => {
    db.query(
      `UPDATE chunks
          SET embedding_model_name = ?,
              embedding_model_version = ?,
              embedded_at = ?,
              status = 'embedded'
        WHERE chunk_id = ? AND status = 'contextualized'`,
    ).run(model_name, model_version, embedded_at, chunk_id as string);
  };

  const rowToChunk = (r: ChunkRow): Chunk => ({
    chunk_id: asChunkId(r.chunk_id),
    doc_id: asDocId(r.doc_id),
    version: asVersion(r.version),
    section_id: asSectionId(r.section_id),
    source_type: "internal",
    content_type: "doc",
    schema_version: 1,
    chunk_index_in_document: r.chunk_index,
    chunk_index_in_section: 0,
    is_latest: true,
    source_uri: "",
    source_system: "local",
    document_title: "",
    heading_path: [],
    span: {
      byte_offset_start: 0,
      byte_offset_end: 0,
      char_offset_start: 0,
      char_offset_end: 0,
      line_start: 0,
      line_end: 0,
    },
    content_hash: r.content_hash,
    source_modified_at: undefined,
    ingested_at: r.created_at,
    ingested_by: asRunId("00000000000000000000000000"),
    classification: {
      namespace: "personal",
      project: undefined,
      category: "reference",
      section_role: "reference",
      answer_shape: "concept",
      audience: ["engineering"],
      audience_technicality: 3,
      sensitivity: "internal",
      lifecycle_status: "published",
      stability: "stable",
      temporal_scope: "current",
      source_trust_tier: "derived",
      prerequisites: [],
      self_contained: true,
      negation_heavy: false,
      tags: [],
    },
    structural_features: {
      token_count: 0,
      char_count: r.raw_content.length,
      contains_code: false,
      code_languages: [],
      has_table: false,
      has_list: false,
      link_density: 0,
      language: undefined,
    },
    runtime_signals: {
      quality_score: 0.5,
      freshness_decay_profile: "medium",
      authority_source_score: 0.5,
      authority_author_score: 0.5,
      retrieval_count: 0,
      citation_count: 0,
      user_marked_wrong_count: 0,
      last_validated_at: undefined,
      deprecated: false,
    },
    contextual_summary: r.contextual_summary ?? "",
    embed_text: "",
    is_continuation: false,
    relationships: {
      references: [],
      external_links: [],
      unresolved_links: [],
      canonical_for: [],
      siblings: [],
      previous_chunk_id: undefined,
      next_chunk_id: undefined,
      supersedes: undefined,
      superseded_by: undefined,
    },
    type_specific: { content_type: "doc", version: r.version },
    content: r.raw_content,
    embedding_model_name: r.embedding_model_name ?? "",
    embedding_model_version: r.embedding_model_version ?? "",
    embedding_dim: 0,
    embedded_at: r.embedded_at ?? "",
    status: r.status as ChunkStatus,
  });

  const getChunksForDoc: SidecarStorage["getChunksForDoc"] = async (
    doc_id,
    version,
  ) => {
    const rows = db
      .query<ChunkRow, [string, string]>(
        "SELECT * FROM chunks WHERE doc_id = ? AND version = ? ORDER BY chunk_index",
      )
      .all(doc_id as string, version as string);
    return rows.map(rowToChunk);
  };

  const getChunksByStatus: SidecarStorage["getChunksByStatus"] = async (
    doc_id,
    version,
    status,
  ) => {
    const rows = db
      .query<ChunkRow, [string, string, string]>(
        `SELECT * FROM chunks
          WHERE doc_id = ? AND version = ? AND status = ?
          ORDER BY chunk_index`,
      )
      .all(doc_id as string, version as string, status);
    return rows.map(rowToChunk);
  };

  const chunkExistsInSidecar: SidecarStorage["chunkExistsInSidecar"] = async (
    chunk_id,
  ) => {
    const row = db
      .query<{ n: number }, [string]>(
        "SELECT 1 AS n FROM chunks WHERE chunk_id = ? LIMIT 1",
      )
      .get(chunk_id as string);
    return row !== null;
  };

  const countChunksWithDifferentEmbeddingModel: SidecarStorage["countChunksWithDifferentEmbeddingModel"] =
    async (expected_model) => {
      const row = db
        .query<{ n: number }, [string]>(
          `SELECT COUNT(*) AS n FROM chunks
            WHERE status IN ('embedded', 'stored')
              AND embedding_model_name IS NOT NULL
              AND embedding_model_name != ?`,
        )
        .get(expected_model);
      return row?.n ?? 0;
    };

  const recordError: SidecarStorage["recordError"] = async (err) => {
    const stmt = db.query(
      `INSERT INTO ingestion_errors
        (run_id, doc_id, version, chunk_id, stage, error_type, error_message, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    );
    const row = stmt.get(
      err.run_id as string,
      err.doc_id ? (err.doc_id as string) : null,
      err.version ? (err.version as string) : null,
      err.chunk_id ? (err.chunk_id as string) : null,
      err.stage,
      err.error_type,
      err.error_message,
      err.occurred_at,
    ) as { id: number } | null;
    return row?.id ?? 0;
  };

  const recordReconcileEvent: SidecarStorage["recordReconcileEvent"] = async (
    ev,
  ) => {
    const stmt = db.query(
      `INSERT INTO reconcile_events
        (run_id, event_type, doc_id, version, chunk_id, source_uri, reason, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    );
    const row = stmt.get(
      ev.run_id as string,
      ev.event_type,
      ev.doc_id ? (ev.doc_id as string) : null,
      ev.version ? (ev.version as string) : null,
      ev.chunk_id ? (ev.chunk_id as string) : null,
      ev.source_uri ?? null,
      ev.reason,
      ev.occurred_at,
    ) as { id: number } | null;
    return row?.id ?? 0;
  };

  const probeReachable: SidecarStorage["probeReachable"] = async () => {
    try {
      db.query("SELECT 1").get();
      return true;
    } catch {
      return false;
    }
  };

  const close: SidecarStorage["close"] = () => {
    db.close();
  };

  return {
    dialect: "sqlite",
    begin,
    acquireWriteLock,
    heartbeat,
    releaseWriteLock,
    putRun,
    updateRun,
    upsertDocument,
    getLatestDocumentByUri,
    getLatestDocument,
    getDocument,
    setDocumentStatus,
    flipPriorIsLatest,
    clearDeletedAt,
    listLatestDocuments,
    listDocumentsByStatus,
    listVersionsForDoc,
    putSections,
    getSectionsForDoc,
    putChunks,
    setChunkStatus,
    setChunkSummary,
    setChunkEmbedded,
    getChunksForDoc,
    getChunksByStatus,
    chunkExistsInSidecar,
    countChunksWithDifferentEmbeddingModel,
    recordError,
    recordReconcileEvent,
    close,
    probeReachable,
  };
};

/** Test-hook for lock constants. Not part of the public API. */
export const _internal = { LOCK_ID, STALE_LOCK_S } as const;
