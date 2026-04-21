// author: Claude
import type { ChunkId } from "@/types/ids";
import type { ClassifierOutput } from "@/types/pipeline";

/**
 * Swappable classifier backend ([§18](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#18-stage-5--classifier-pass-model-driven-metadata), [§31.1](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#311-what-must-be-swappable)). Implementations:
 *   - `OllamaClassifier` — production, JSON-mode Ollama call.
 *   - `StubClassifier` — test; emits configured fallbacks for every chunk.
 *   - `MockClassifier` — test; emits canned outputs keyed by `chunk_id`.
 */
export type ClassifierInput = {
  chunk_id: ChunkId;
  chunk_content: string;
  document_title: string;
  heading_path: ReadonlyArray<string>;
};

export type Classifier = {
  readonly name: string;
  readonly version: string;
  classify(input: ClassifierInput): Promise<ClassifierOutput>;
};

export type { ClassifierOutput };
