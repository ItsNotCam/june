import { fileURLToPath } from "node:url";
import { buildDeps } from "@/pipeline/factory";
import { SidecarLockHeldError } from "@/lib/errors";
import { ingestPath } from "@/pipeline/ingest";
import { purge } from "@/pipeline/purge";
import { asDocId } from "@/types/ids";
import { bootstrap, parseCommonFlags } from "./shared";

/**
 * `june reindex <doc_id>` ([§27.1](../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#271-commands)). Hard-deletes the latest version's chunks
 * then re-runs ingest from the recorded `source_uri`.
 */
export const runReindex = async (argv: ReadonlyArray<string>): Promise<number> => {
  const { positional, flags } = parseCommonFlags(argv);
  const doc_id_str = positional[0];
  if (!doc_id_str) {
    process.stderr.write("june: reindex requires a doc_id argument\n");
    return 64;
  }

  try {
    await bootstrap(flags);
    const deps = await buildDeps();
    const doc_id = asDocId(doc_id_str);
    const existing = await deps.storage.sidecar.getLatestDocument(doc_id);
    if (!existing) {
      process.stderr.write(`june: no document for doc_id ${doc_id_str}\n`);
      return 1;
    }
    await purge({ deps, doc_id, allVersions: false });
    const fsPath = fileURLToPath(existing.source_uri);
    const res = await ingestPath({ path: fsPath, deps });
    if (!flags.quiet) {
      process.stdout.write(
        `reindexed doc_id=${doc_id_str} processed=${res.processed}\n`,
      );
    }
    return 0;
  } catch (err) {
    if (err instanceof SidecarLockHeldError) {
      process.stderr.write(
        `june: another ingest is running (${err.message}). Exiting.\n`,
      );
      return 2;
    }
    throw err;
  }
};
