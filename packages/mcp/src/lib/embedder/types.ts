// author: Claude
import type { ChunkId } from "@/types/ids";
import type { EmbeddingResult } from "@/types/pipeline";

/**
 * Swappable dense-embedding backend ([§31.1](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#311-what-must-be-swappable)). Implementations: `OllamaEmbedder`
 * (production), `StubEmbedder` (tests).
 */
export type Embedder = {
  readonly name: string;
  readonly version: string;
  readonly dim: number;
  readonly max_input_chars: number;

  /**
   * Embed a batch of strings. Results preserve input order. The pipeline pairs
   * these with `chunk_id`s from its own record of the call site; the embedder
   * itself doesn't know about chunks.
   */
  embed(texts: ReadonlyArray<string>): Promise<ReadonlyArray<ReadonlyArray<number>>>;
};

/** Convenience — the `EmbeddingResult` type from pipeline types. Re-exported for consumers who only import from embedder. */
export type { EmbeddingResult };
/** Convenience type re-export. */
export type { ChunkId };
