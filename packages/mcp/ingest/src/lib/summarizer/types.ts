// author: Claude
import type { ChunkId } from "#internal/types/ids";
import type { DocumentOutline } from "#internal/schemas/classifier";
import type { SummarizerOutput } from "#internal/types/pipeline";

/**
 * Swappable summarizer backend ([§19](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#19-stage-6--contextual-summary-generation), [§31.1](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#311-what-must-be-swappable)). Implementations:
 *   - `OllamaSummarizer` — production; single-pass < threshold, two-pass over.
 *   - `StubSummarizer` — test; deterministic heading-path blurb.
 *   - `MockSummarizer` — test; canned outputs keyed by `chunk_id`.
 */
export type SummarizerInput = {
  chunk_id: ChunkId;
  chunk_content: string;
  document_title: string;
  heading_path: ReadonlyArray<string>;
  /** Full document body when under the long-doc threshold; otherwise the containing section. */
  containing_text: string;
  /** Only set on the long-doc two-pass path; summarizer uses this as background. */
  outline: DocumentOutline | undefined;
};

export type Summarizer = {
  readonly name: string;
  readonly version: string;
  summarizeChunk(input: SummarizerInput): Promise<SummarizerOutput>;
  summarizeDocument(input: {
    document_title: string;
    document_body: string;
  }): Promise<DocumentOutline>;
  /**
   * Evict the summarizer model from the backend's memory (best-effort, never
   * throws). Called between ingest phases so the summarizer never stays resident
   * in VRAM while the embedder needs the GPU. No-op for stubs and API-backed
   * (Anthropic/DeepSeek) backends that hold no local VRAM.
   */
  unload(): Promise<void>;
};

export type { SummarizerOutput };
