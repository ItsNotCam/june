import { Database } from "bun:sqlite";
import { getConfig, loadConfig } from "@/lib/config";
import { getEnv } from "@/lib/env";
import { bootstrap, parseCommonFlags } from "./shared";

/**
 * `june status [doc_id]` ([§27.1](../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#271-commands) / [§26.6](../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#266-june-status-as-the-operator-front-door)). Read-only: prints run + document
 * counts and, if a `doc_id` is given, the version history for that document.
 */

type RunRow = {
  run_id: string;
  started_at: string;
  completed_at: string | null;
  doc_count: number | null;
  chunk_count: number | null;
  error_count: number | null;
  trigger: string;
};

type DocRow = {
  doc_id: string;
  version: string;
  is_latest: number;
  status: string;
  source_uri: string;
};

const openReadonly = async (): Promise<Database> => {
  const env = getEnv();
  await loadConfig(env.CONFIG_PATH);
  const cfg = getConfig();
  return new Database(cfg.sidecar.path, { readonly: true, create: false });
};

export const runStatus = async (argv: ReadonlyArray<string>): Promise<number> => {
  const { positional, flags } = parseCommonFlags(argv);
  await bootstrap(flags);

  const db = await openReadonly();
  try {
    const doc_id = positional[0];
    if (doc_id) {
      const rows = db
        .query<DocRow, [string]>(
          `SELECT doc_id, version, is_latest, status, source_uri
             FROM documents WHERE doc_id = ? ORDER BY ingested_at DESC`,
        )
        .all(doc_id);
      if (rows.length === 0) {
        process.stdout.write(`Document ${doc_id}: not found\n`);
        return 0;
      }
      process.stdout.write(`Document: ${doc_id}\n`);
      process.stdout.write(`Source: ${rows[0]!.source_uri}\n`);
      process.stdout.write(`Versions:\n`);
      for (const r of rows) {
        process.stdout.write(
          `  ${r.version} (is_latest=${r.is_latest === 1}, ${r.status})\n`,
        );
      }
      return 0;
    }

    const lastRun = db
      .query<RunRow, []>(
        `SELECT * FROM ingestion_runs ORDER BY started_at DESC LIMIT 1`,
      )
      .get();
    if (lastRun) {
      process.stdout.write(
        `Last run: ${lastRun.run_id} (${lastRun.completed_at ?? "in-flight"}, docs=${lastRun.doc_count ?? 0}, chunks=${lastRun.chunk_count ?? 0}, errors=${lastRun.error_count ?? 0}, trigger=${lastRun.trigger})\n`,
      );
    } else {
      process.stdout.write("Last run: none\n");
    }

    const docStats = db
      .query<{ status: string; n: number }, []>(
        `SELECT status, COUNT(*) AS n FROM documents WHERE is_latest = 1 GROUP BY status`,
      )
      .all();
    const parts = docStats
      .map((r) => `${r.n} ${r.status}`)
      .join(", ");
    process.stdout.write(`Documents: ${parts || "none"}\n`);

    const errCount = db
      .query<{ n: number }, []>(
        `SELECT COUNT(*) AS n FROM ingestion_errors
          WHERE occurred_at > datetime('now', '-24 hour')`,
      )
      .get();
    process.stdout.write(`Errors (last 24h): ${errCount?.n ?? 0}\n`);

    const lock = db
      .query<{ run_id: string; last_heartbeat_at: string }, []>(
        `SELECT run_id, last_heartbeat_at FROM ingestion_lock`,
      )
      .get();
    if (lock) {
      process.stdout.write(
        `Lock: held by ${lock.run_id} (heartbeat ${lock.last_heartbeat_at})\n`,
      );
    } else {
      process.stdout.write("Lock: not held\n");
    }
    return 0;
  } finally {
    db.close();
  }
};
