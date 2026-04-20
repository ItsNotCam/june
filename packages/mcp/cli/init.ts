import { getConfig } from "@/lib/config";
import { createOllamaEmbedder } from "@/lib/embedder/ollama";
import { logger } from "@/lib/logger";
import { createQdrantStorage } from "@/lib/storage/qdrant";
import { openSidecar } from "@/lib/storage/sqlite/migrate";
import { bootstrap, parseCommonFlags } from "./shared";

/**
 * `june init` ([§27.1](../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#271-commands)).
 *
 * Idempotent first-run setup:
 *   1. Install the offline guard (I10).
 *   2. Open the SQLite sidecar (runs the DDL migration).
 *   3. Probe Ollama for the embedding dimension.
 *   4. Ensure Qdrant collections + aliases + payload indexes.
 *
 * Safe to re-run at any time — every step uses `IF NOT EXISTS` / try-create
 * semantics.
 */
export const runInit = async (argv: ReadonlyArray<string> = []): Promise<void> => {
  const { flags } = parseCommonFlags(argv);
  await bootstrap(flags);
  const cfg = getConfig();

  logger.info("init_start", { event: "init_start" });

  const db = await openSidecar(cfg.sidecar.path);
  db.close();

  const embedder = await createOllamaEmbedder();
  logger.info("embedder_ready", {
    event: "embedder_ready",
    model_name: embedder.name,
    model_version: embedder.version,
    count: embedder.dim,
  });

  await createQdrantStorage().ensureCollections(embedder.dim);

  logger.info("init_complete", { event: "init_complete" });
};
