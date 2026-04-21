// author: Claude
import { buildDeps } from "@/pipeline/factory";
import { purge } from "@/pipeline/purge";
import { SidecarLockHeldError } from "@/lib/errors";
import { asDocId } from "@/types/ids";
import { bootstrap, parseCommonFlags } from "./shared";

/**
 * `june purge <doc_id> [--all-versions] [--yes]` ([§27.1](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#271-commands)).
 */
export const runPurge = async (argv: ReadonlyArray<string>): Promise<number> => {
  const { positional, flags, remaining } = parseCommonFlags(argv);
  const doc_id_str = positional[0];
  if (!doc_id_str) {
    process.stderr.write("june: purge requires a doc_id\n");
    return 64;
  }
  const allVersions = remaining.includes("--all-versions");

  if (!flags.yes) {
    process.stderr.write(
      `june: purge is destructive. Re-run with --yes to confirm.\n`,
    );
    return 4;
  }

  try {
    await bootstrap(flags);
    const deps = await buildDeps();
    const res = await purge({ deps, doc_id: asDocId(doc_id_str), allVersions });
    process.stdout.write(
      `purged versions=${res.purgedVersions} chunks=${res.purgedChunks}\n`,
    );
    return 0;
  } catch (err) {
    if (err instanceof SidecarLockHeldError) {
      process.stderr.write(`june: another ingest is running. Exiting.\n`);
      return 2;
    }
    throw err;
  }
};
