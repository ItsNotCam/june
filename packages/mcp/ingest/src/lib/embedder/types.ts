// author: Claude
import type { ChunkId } from "#internal/types/ids";
import type { EmbeddingResult } from "#internal/types/pipeline";

/**
 * Swappable dense-embedding backend ([§31.1](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#311-what-must-be-swappable)). Implementations: `OllamaEmbedder`
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

  /**
   * Evict the embedding model from the backend's memory (best-effort, never
   * throws). Called at operation boundaries (end of a query, ingest run, or
   * re-embed) so the embedder never stays resident in VRAM while a downstream
   * reader/generation model (e.g. gemma) needs it. No-op for local stubs.
   */
  unload(): Promise<void>;
};

/** Convenience — the `EmbeddingResult` type from pipeline types. Re-exported for consumers who only import from embedder. */
export type { EmbeddingResult };
/** Convenience type re-export. */
export type { ChunkId };
