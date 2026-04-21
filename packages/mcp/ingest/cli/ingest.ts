// author: Claude
import { ingestPath } from "@/pipeline/ingest";
import { buildDeps } from "@/pipeline/factory";
import { asVersion } from "@/types/ids";
import { SidecarLockHeldError } from "@/lib/errors";
import { createProgressReporter, createSilentReporter } from "@/lib/progress";
import { bootstrap, parseCommonFlags } from "./shared";

/**
 * `june ingest <path> [--version <s>]` ([§27.1](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#271-commands)).
 *
 * Exit codes:
 *   0 — success
 *   1 — catastrophic / fatal config error
 *   2 — lock held (another run live)
 *   64 — usage error (no path given)
 */
export const runIngest = async (argv: ReadonlyArray<string>): Promise<number> => {
  const { positional, flags, remaining } = parseCommonFlags(argv);

  let cliVersion: string | undefined;
  let force = false;
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i] === "--version") {
      cliVersion = remaining[i + 1];
      i++;
    } else if (remaining[i] === "--force") {
      force = true;
    }
  }

  const path = positional[0];
  if (!path) {
    process.stderr.write("june: ingest requires a path argument\n");
    return 64;
  }

  try {
    await bootstrap(flags);
    const deps = await buildDeps();
    const progress =
      flags.quiet || flags.jsonLog ? createSilentReporter() : createProgressReporter();
    const result = await ingestPath({
      path,
      cliVersion: cliVersion ? asVersion(cliVersion) : undefined,
      deps,
      progress,
      force,
    });
    if (!flags.quiet) {
      process.stdout.write(
        `processed=${result.processed} skipped=${result.skipped} errored=${result.errored}\n`,
      );
    }
    return result.errored > 0 && result.processed === 0 ? 1 : 0;
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
