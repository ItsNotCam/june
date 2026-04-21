// author: Claude
import { health } from "@/pipeline/health";
import { bootstrap, parseCommonFlags } from "./shared";

/**
 * `june health` ([§27.1](../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#271-commands)). Exit 0 = healthy, 3 = unhealthy.
 */
export const runHealth = async (argv: ReadonlyArray<string>): Promise<number> => {
  const { flags } = parseCommonFlags(argv);
  await bootstrap(flags);
  const report = await health();
  if (!flags.quiet) {
    process.stdout.write(
      `sqlite=${report.sqlite} qdrant=${report.qdrant} ollama=${report.ollama}\n`,
    );
    for (const e of report.errors) process.stderr.write(`  ${e}\n`);
  }
  return report.ok ? 0 : 3;
};
