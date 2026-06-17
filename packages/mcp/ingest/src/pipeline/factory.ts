// author: Claude
import { getConfig } from "#internal/lib/config";
import { createOllamaEmbedder } from "#internal/lib/embedder/ollama";
import { createQdrantStorage } from "#internal/lib/storage/qdrant";
import { createSqliteSidecar } from "#internal/lib/storage/sqlite/index";
import { createOllamaSummarizer } from "#internal/lib/summarizer/ollama";
import {
  createAnthropicSummarizer,
  createDeepseekSummarizer,
} from "#internal/lib/summarizer/anthropic-compat";
import { createStubSummarizer } from "#internal/lib/summarizer/stub";
import type { Embedder } from "#internal/lib/embedder/types";
import type { SidecarStorage, StorageInterface, VectorStorage } from "#internal/lib/storage/types";
import type { Summarizer } from "#internal/lib/summarizer/types";

/**
 * Dependency assembly for the ingest pipeline ([§32.3](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#323-pipeline-factory)).
 *
 * Each consumer (CLI, tests, benchmark harness) can override any field; the
 * default factories honor `config.yaml` (e.g. `summarizer.implementation =
 * "stub"` bypasses Ollama).
 */

export type PipelineDeps = {
  summarizer: Summarizer;
  embedder: Embedder;
  storage: StorageInterface;
};

export type PipelineOptions = Partial<PipelineDeps>;

const buildSummarizer = (override: Summarizer | undefined): Summarizer => {
  if (override) return override;
  const mode = getConfig().summarizer.implementation;
  switch (mode) {
    case "stub":
    case "mock":
      return createStubSummarizer();
    case "deepseek":
      return createDeepseekSummarizer();
    case "anthropic":
      return createAnthropicSummarizer();
    case "ollama":
      return createOllamaSummarizer();
  }
};

const buildEmbedder = async (override: Embedder | undefined): Promise<Embedder> => {
  if (override) return override;
  return createOllamaEmbedder();
};

const buildStorage = async (
  override: StorageInterface | undefined,
  sidecarOverride: SidecarStorage | undefined = undefined,
  vectorOverride: VectorStorage | undefined = undefined,
): Promise<StorageInterface> => {
  if (override) return override;
  const cfg = getConfig();
  const sidecar = sidecarOverride ?? (await createSqliteSidecar(cfg.sidecar.path));
  const vector = vectorOverride ?? createQdrantStorage();
  return { sidecar, vector };
};

/**
 * Build a full dependency set, honoring config and per-field overrides.
 * Every call constructs fresh singletons; callers hold the result for the
 * lifetime of the pipeline invocation.
 */
export const buildDeps = async (opts: PipelineOptions = {}): Promise<PipelineDeps> => {
  const [embedder, storage] = await Promise.all([
    buildEmbedder(opts.embedder),
    buildStorage(opts.storage),
  ]);
  const summarizer = buildSummarizer(opts.summarizer);
  return { summarizer, embedder, storage };
};
