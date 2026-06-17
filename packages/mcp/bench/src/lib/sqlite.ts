// author: Claude
import { Database } from "bun:sqlite";

/**
 * Read-only connection to june's SQLite sidecar.
 *
 * The bench never mutates june's store — it reads chunks, documents, and
 * ingestion runs for Stages 4, 5, 6. Opening with `readonly: true` makes the
 * intent explicit and makes accidental writes fail loud.
 */
export type JuneChunkRow = {
  chunk_id: string;
  doc_id: string;
  chunk_index: number;
  raw_content: string;
  embedding_model_name: string;
  embedding_model_version: string;
};

export const openJuneDatabase = (path: string): Database => {
  return new Database(path, { readonly: true });
};

/**
 * Returns every chunk for the given doc that belongs to the latest version.
 *
 * Used by Stage 5's Tier-1 resolver. Filtering on `is_latest` guards against
 * the pathological case where a bench-scratch store somehow contains multiple
 * versions of the same doc — the bench assumes the most recent is the one
 * queried by retrieval.
 */
export const chunksForDoc = (db: Database, doc_id: string): JuneChunkRow[] => {
  const stmt = db.query<JuneChunkRow, [string]>(
    `SELECT c.chunk_id, c.doc_id, c.chunk_index, c.raw_content,
            c.embedding_model_name, c.embedding_model_version
     FROM chunks c
     JOIN documents d ON c.doc_id = d.doc_id AND c.version = d.version
     WHERE c.doc_id = ? AND d.is_latest = 1`,
  );
  return stmt.all(doc_id);
};

/**
 * Renders the given chunks as `<chunk id="…">raw_content</chunk>` blocks in the
 * order requested, joined by blank lines. Missing chunk_ids are skipped.
 *
 * Shared by Stage 7 (reader context) and Stage 8 (grounding-aware judge): both
 * need the exact same passage text the reader saw, fetched by `chunk_id` from
 * `chunks.raw_content`. Keeping one renderer guarantees the judge grounds its
 * verdict against byte-identical context.
 */
export const renderChunksById = (
  db: Database,
  chunkIds: readonly string[],
): string => {
  if (chunkIds.length === 0) return "";
  const stmt = db.query<{ chunk_id: string; raw_content: string }, [string]>(
    `SELECT chunk_id, raw_content FROM chunks WHERE chunk_id = ?`,
  );
  const parts: string[] = [];
  for (const id of chunkIds) {
    const row = stmt.get(id);
    if (!row) continue;
    parts.push(`<chunk id="${row.chunk_id}">\n${row.raw_content}\n</chunk>`);
  }
  return parts.join("\n\n");
};

/** Returns the single newest `ingestion_runs` row by `started_at`. */
export const latestIngestionRun = (
  db: Database,
): { run_id: string; started_at: string } | null => {
  const row = db
    .query<
      { run_id: string; started_at: string },
      []
    >(`SELECT run_id, started_at FROM ingestion_runs ORDER BY started_at DESC LIMIT 1`)
    .get();
  return row ?? null;
};

/**
 * Snapshots the ingest metadata the bench depends on (§18):
 * - `schema_version` from the most-recent document row
 * - `embedding_model_name` + `embedding_model_version` from the first chunk
 *   of the latest version of any doc (all chunks share the value per
 *   `SPEC.md §6` Pillar 4)
 */
export const ingestMetadataSnapshot = (
  db: Database,
): {
  schema_version: number | null;
  embedding_model: string | null;
  embedding_model_version: string | null;
} => {
  const schemaRow = db
    .query<
      { schema_version: number },
      []
    >(`SELECT schema_version FROM documents ORDER BY ingested_at DESC LIMIT 1`)
    .get();

  const embedRow = db
    .query<
      { embedding_model_name: string | null; embedding_model_version: string | null },
      []
    >(
      `SELECT c.embedding_model_name, c.embedding_model_version
         FROM chunks c
         JOIN documents d ON c.doc_id = d.doc_id AND c.version = d.version
        WHERE d.is_latest = 1
          AND c.embedding_model_name IS NOT NULL
        ORDER BY c.embedded_at DESC
        LIMIT 1`,
    )
    .get();

  return {
    schema_version: schemaRow?.schema_version ?? null,
    embedding_model: embedRow?.embedding_model_name ?? null,
    embedding_model_version: embedRow?.embedding_model_version ?? null,
  };
};

/** Count of chunks across all latest documents — used for progress output. */
export const countLatestChunks = (db: Database): number => {
  const row = db
    .query<
      { count: number },
      []
    >(
      `SELECT COUNT(*) AS count
         FROM chunks c
         JOIN documents d ON c.doc_id = d.doc_id AND c.version = d.version
        WHERE d.is_latest = 1`,
    )
    .get();
  return row?.count ?? 0;
};
