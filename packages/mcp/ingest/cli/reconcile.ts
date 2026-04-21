// author: Claude
import { buildDeps } from "@/pipeline/factory";
import { reconcile } from "@/pipeline/reconcile";
import { SidecarLockHeldError } from "@/lib/errors";
import { bootstrap, parseCommonFlags } from "./shared";

/**
 * `june reconcile [--dry-run] [--purge]` ([§27.5](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#275-reconcile-command-detailed)).
 */
export const runReconcile = async (argv: ReadonlyArray<string>): Promise<number> => {
  const { flags, remaining } = parseCommonFlags(argv);
  const dryRun = remaining.includes("--dry-run");
  const purge = remaining.includes("--purge");

  try {
    await bootstrap(flags);
    const deps = await buildDeps();
    const res = await reconcile({ deps, dryRun, purge });
    process.stdout.write(
      `soft_deleted=${res.softDeleted} hard_deleted=${res.hardDeleted} orphans=${res.orphansDeleted}\n`,
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
