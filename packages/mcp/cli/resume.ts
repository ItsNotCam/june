// author: Claude
import { buildDeps } from "@/pipeline/factory";
import { resumeRun } from "@/pipeline/resume";
import { SidecarLockHeldError } from "@/lib/errors";
import { createProgressReporter, createSilentReporter } from "@/lib/progress";
import { bootstrap, parseCommonFlags } from "./shared";

/**
 * `june resume` ([§27.1](../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#271-commands) / [§24](../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#24-resume-semantics)). Replays every non-terminal document.
 */
export const runResume = async (argv: ReadonlyArray<string>): Promise<number> => {
  const { flags } = parseCommonFlags(argv);
  try {
    await bootstrap(flags);
    const deps = await buildDeps();
    const progress =
      flags.quiet || flags.jsonLog ? createSilentReporter() : createProgressReporter();
    const res = await resumeRun({
      deps,
      embedder: deps.embedder,
      progress,
    });
    if (!flags.quiet) {
      process.stdout.write(`resumed ${res.resumed} documents\n`);
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
