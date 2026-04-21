// author: Claude
import { buildFallbackClassifierJson, toChunkClassification } from "./fallback";
import type { Classifier } from "./types";

/**
 * Deterministic classifier that emits configured fallbacks for every chunk
 * ([§18.9](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#189-interface)). Fast, offline, no Ollama dependency — the default for tests and
 * `config.classifier.implementation = "stub"`.
 */
export const createStubClassifier = (): Classifier => ({
  name: "stub",
  version: "0",
  classify: async (input) => ({
    chunk_id: input.chunk_id,
    classification: toChunkClassification(buildFallbackClassifierJson(), {
      namespace: "personal",
      project: undefined,
    }),
    raw_response: "",
  }),
});
