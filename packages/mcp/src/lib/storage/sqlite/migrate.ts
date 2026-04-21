// author: Claude
import { Database } from "bun:sqlite";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { logger } from "@/lib/logger";

/**
 * Applies the SQLite DDL idempotently ([§10](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#10-sqlite-sidecar-schema)). Every DDL statement uses
 * `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` so running the
 * migration on a fresh DB and an existing DB both succeed without data loss.
 *
 * Called by `init` and implicitly by every pipeline startup that opens the
 * sidecar — catching a never-initialized database early is cheap.
 */

const SCHEMA_FILE = "schema.sql";

const loadSchema = async (): Promise<string> => {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFile(join(here, SCHEMA_FILE), "utf8");
};

/**
 * Sets the pragmas every connection must have ([§10](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#10-sqlite-sidecar-schema) Pragmas). Idempotent —
 * safe to call at connection open time.
 */
export const applyPragmas = (db: Database): void => {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
};

/**
 * Runs the full DDL against the given database. Expects pragmas already set.
 * Writes one `info` log on success with the row count of `documents` for
 * quick visibility into "did this hit an existing db or a fresh one".
 */
export const migrate = async (db: Database): Promise<void> => {
  const ddl = await loadSchema();
  db.exec(ddl);
  const count = db
    .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM documents")
    .get();
  logger.info("sqlite_migrated", {
    event: "sqlite_migrated",
    count: count?.n ?? 0,
  });
};

/**
 * Opens a SQLite database at `path`, sets pragmas, applies the DDL, and
 * returns the live `Database`. Caller is responsible for closing it on
 * process shutdown ([§24.5](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#245-graceful-shutdown-per-i8) graceful path).
 *
 * Creates the parent directory tree recursively when `path` is a file path
 * (skipped for the `:memory:` special value used by the benchmark harness).
 */
export const openSidecar = async (path: string): Promise<Database> => {
  if (path !== ":memory:") {
    await mkdir(dirname(path), { recursive: true });
  }
  const db = new Database(path, { create: true });
  applyPragmas(db);
  await migrate(db);
  return db;
};
