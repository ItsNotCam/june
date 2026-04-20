import { buildDeps } from "@/pipeline/factory";
import { createOllamaEmbedder } from "@/lib/embedder/ollama";
import { reembed } from "@/pipeline/reembed";
import { SidecarLockHeldError } from "@/lib/errors";
import { bootstrap, parseCommonFlags } from "./shared";

/**
 * `june re-embed --embedding-model <name> [--collection internal|external|all] [--yes]` ([§27.6](../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#276-re-embed-command-detailed)).
 */
export const runReEmbed = async (argv: ReadonlyArray<string>): Promise<number> => {
  const { flags, remaining } = parseCommonFlags(argv);
  let modelName: string | undefined;
  let collection: "internal" | "external" | "all" = "all";
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i] === "--embedding-model") modelName = remaining[++i];
    else if (remaining[i] === "--collection") {
      const next = remaining[++i];
      if (next === "internal" || next === "external" || next === "all") collection = next;
    }
  }
  if (!modelName) {
    process.stderr.write("june: re-embed requires --embedding-model <name>\n");
    return 64;
  }
  if (!flags.yes) {
    process.stderr.write(
      `june: re-embed will re-embed the entire corpus. Re-run with --yes to confirm.\n`,
    );
    return 4;
  }

  // Override the env for the embedder factory.
  process.env["OLLAMA_EMBED_MODEL"] = modelName;

  try {
    await bootstrap(flags);
    const deps = await buildDeps();
    const embedder = await createOllamaEmbedder();
    const collections: ReadonlyArray<"internal" | "external"> =
      collection === "all" ? ["internal", "external"] : [collection];
    const res = await reembed({ deps, newEmbedder: embedder, collections });
    process.stdout.write(
      `re-embedded ${res.rechunked} chunks with model ${modelName}\n`,
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
