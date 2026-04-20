-- june ingestion-pipeline SQLite schema (§10.4).
-- Applied idempotently by `migrate.ts` on every connection startup.
--
-- Pragmas set separately by the connection opener before any DDL runs:
--   PRAGMA journal_mode = WAL;
--   PRAGMA synchronous = NORMAL;
--   PRAGMA foreign_keys = ON;
--   PRAGMA busy_timeout = 5000;

-- Run log for top-level observability. Inserted at run start; updated at
-- run end. A crashed run leaves `completed_at = NULL`.
CREATE TABLE IF NOT EXISTS ingestion_runs (
  run_id        TEXT    PRIMARY KEY,
  started_at    TEXT    NOT NULL,
  completed_at  TEXT,
  doc_count     INTEGER,
  chunk_count   INTEGER,
  error_count   INTEGER,
  trigger       TEXT    NOT NULL CHECK (trigger IN (
                  'cli', 'api', 'reconcile', 're-embed', 'init'
                ))
);

-- Documents: composite PK (doc_id, version). All versions retained until
-- explicit purge. Column set matches SPEC §10.4 exactly — in-memory Document
-- fields beyond this set (document_title, namespace, frontmatter, etc.) are
-- re-derived from source_uri + raw bytes on resume per §30.3.
CREATE TABLE IF NOT EXISTS documents (
  doc_id              TEXT    NOT NULL,
  version             TEXT    NOT NULL,
  source_uri          TEXT    NOT NULL,
  content_hash        TEXT    NOT NULL,
  is_latest           INTEGER NOT NULL CHECK (is_latest IN (0, 1)),
  source_modified_at  TEXT,
  ingested_at         TEXT    NOT NULL,
  schema_version      INTEGER NOT NULL,
  status              TEXT    NOT NULL CHECK (status IN (
                        'pending', 'parsed', 'chunked', 'contextualized',
                        'embedded', 'stored', 'failed',
                        'skipped_empty', 'skipped_metadata_only', 'deleted'
                      )),
  deleted_at          TEXT,
  ingestion_run_id    TEXT    NOT NULL,
  PRIMARY KEY (doc_id, version),
  FOREIGN KEY (ingestion_run_id) REFERENCES ingestion_runs(run_id)
);
CREATE INDEX IF NOT EXISTS idx_documents_source_uri ON documents(source_uri);
CREATE INDEX IF NOT EXISTS idx_documents_is_latest  ON documents(doc_id, is_latest);
CREATE INDEX IF NOT EXISTS idx_documents_status     ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_deleted_at ON documents(deleted_at);

-- Sections: parent-child, retrievable by (section_id, version).
-- Not embedded (I11). Populated at Stage 3, never overwritten within a version.
CREATE TABLE IF NOT EXISTS sections (
  section_id    TEXT    NOT NULL,
  version       TEXT    NOT NULL,
  doc_id        TEXT    NOT NULL,
  heading_path  TEXT    NOT NULL,
  content       TEXT    NOT NULL,
  char_start    INTEGER NOT NULL,
  char_end      INTEGER NOT NULL,
  created_at    TEXT    NOT NULL,
  PRIMARY KEY (section_id, version),
  FOREIGN KEY (doc_id, version) REFERENCES documents(doc_id, version)
);
CREATE INDEX IF NOT EXISTS idx_sections_doc ON sections(doc_id, version);

-- Chunks: chunk_id already encodes version, so PK is chunk_id alone.
-- raw_content + contextual_summary persisted to enable re-embed (§27.6)
-- without re-parse or re-classify.
CREATE TABLE IF NOT EXISTS chunks (
  chunk_id                TEXT    PRIMARY KEY,
  doc_id                  TEXT    NOT NULL,
  version                 TEXT    NOT NULL,
  section_id              TEXT    NOT NULL,
  chunk_index             INTEGER NOT NULL,
  status                  TEXT    NOT NULL CHECK (status IN (
                            'pending', 'contextualized', 'embedded', 'stored', 'failed'
                          )),
  content_hash            TEXT    NOT NULL,
  raw_content             TEXT    NOT NULL,
  contextual_summary      TEXT,
  embedding_model_name    TEXT,
  embedding_model_version TEXT,
  embedded_at             TEXT,
  created_at              TEXT    NOT NULL,
  FOREIGN KEY (doc_id, version) REFERENCES documents(doc_id, version)
);
CREATE INDEX IF NOT EXISTS idx_chunks_doc_version ON chunks(doc_id, version);
CREATE INDEX IF NOT EXISTS idx_chunks_status      ON chunks(status);
CREATE INDEX IF NOT EXISTS idx_chunks_section     ON chunks(section_id, version);

-- Error audit trail. Append-only; never mutated, never cleared on retry.
-- `error_message` MUST NOT contain raw chunk content (I7) — enforced at the
-- application layer by the typed Logger (logger.ts) + SPEC §25.5.
CREATE TABLE IF NOT EXISTS ingestion_errors (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id         TEXT    NOT NULL,
  doc_id         TEXT,
  version        TEXT,
  chunk_id       TEXT,
  stage          TEXT    NOT NULL,
  error_type     TEXT    NOT NULL,
  error_message  TEXT    NOT NULL,
  occurred_at    TEXT    NOT NULL,
  FOREIGN KEY (run_id) REFERENCES ingestion_runs(run_id)
);
CREATE INDEX IF NOT EXISTS idx_errors_doc   ON ingestion_errors(doc_id, version);
CREATE INDEX IF NOT EXISTS idx_errors_chunk ON ingestion_errors(chunk_id);
CREATE INDEX IF NOT EXISTS idx_errors_run   ON ingestion_errors(run_id);
CREATE INDEX IF NOT EXISTS idx_errors_type  ON ingestion_errors(error_type);
CREATE INDEX IF NOT EXISTS idx_errors_time  ON ingestion_errors(occurred_at);

-- Reconciliation audit trail. Distinct from ingestion_errors because
-- compliance queries (what did we delete?) are distinct from operational
-- ones (what retries happened?).
CREATE TABLE IF NOT EXISTS reconcile_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id       TEXT    NOT NULL,
  event_type   TEXT    NOT NULL CHECK (event_type IN (
                 'soft_delete_document', 'hard_delete_chunks',
                 'qdrant_orphan_deleted', 'dry_run_would_delete'
               )),
  doc_id       TEXT,
  version      TEXT,
  chunk_id     TEXT,
  source_uri   TEXT,
  reason       TEXT    NOT NULL CHECK (reason IN (
                 'file_vanished', 'qdrant_orphan', 'manual_purge'
               )),
  occurred_at  TEXT    NOT NULL,
  FOREIGN KEY (run_id) REFERENCES ingestion_runs(run_id)
);
CREATE INDEX IF NOT EXISTS idx_reconcile_doc  ON reconcile_events(doc_id, version);
CREATE INDEX IF NOT EXISTS idx_reconcile_run  ON reconcile_events(run_id);
CREATE INDEX IF NOT EXISTS idx_reconcile_time ON reconcile_events(occurred_at);

-- Single-writer lock with heartbeat-based staleness detection (I2).
-- Container-safe: does not rely on pid or hostname for liveness.
CREATE TABLE IF NOT EXISTS ingestion_lock (
  lock_id             INTEGER PRIMARY KEY CHECK (lock_id = 1),
  run_id              TEXT    NOT NULL,
  acquired_at         TEXT    NOT NULL,
  last_heartbeat_at   TEXT    NOT NULL,
  host                TEXT    NOT NULL,
  pid                 INTEGER NOT NULL
);
