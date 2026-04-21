// author: Claude
import { getConfig } from "@/lib/config";
import { createOllamaClassifier } from "@/lib/classifier/ollama";
import { createStubClassifier } from "@/lib/classifier/stub";
import { createOllamaEmbedder } from "@/lib/embedder/ollama";
import { createQdrantStorage } from "@/lib/storage/qdrant";
import { createSqliteSidecar } from "@/lib/storage/sqlite";
import { createOllamaSummarizer } from "@/lib/summarizer/ollama";
import { createStubSummarizer } from "@/lib/summarizer/stub";
import type { Classifier } from "@/lib/classifier/types";
import type { Embedder } from "@/lib/embedder/types";
import type { SidecarStorage, StorageInterface, VectorStorage } from "@/lib/storage/types";
import type { Summarizer } from "@/lib/summarizer/types";

/**
 * Dependency assembly for the ingest pipeline ([§32.3](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#323-pipeline-factory)).
 *
 * Each consumer (CLI, tests, benchmark harness) can override any field; the
 * default factories honor `config.yaml` (e.g. `classifier.implementation =
 * "stub"` bypasses Ollama).
 */

export type PipelineDeps = {
  classifier: Classifier;
  summarizer: Summarizer;
  embedder: Embedder;
  storage: StorageInterface;
};

export type PipelineOptions = Partial<PipelineDeps>;

const buildClassifier = async (override: Classifier | undefined): Promise<Classifier> => {
  if (override) return override;
  const mode = getConfig().classifier.implementation;
  if (mode === "stub" || mode === "mock") return createStubClassifier();
  return createOllamaClassifier();
};

const buildSummarizer = (override: Summarizer | undefined): Summarizer => {
  if (override) return override;
  const mode = getConfig().summarizer.implementation;
  if (mode === "stub" || mode === "mock") return createStubSummarizer();
  return createOllamaSummarizer();
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
  const [classifier, embedder, storage] = await Promise.all([
    buildClassifier(opts.classifier),
    buildEmbedder(opts.embedder),
    buildStorage(opts.storage),
  ]);
  const summarizer = buildSummarizer(opts.summarizer);
  return { classifier, summarizer, embedder, storage };
};
