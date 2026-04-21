// author: Claude
import type { ChunkId } from "@/types/ids";
import type { DocumentOutline } from "@/schemas/classifier";
import type { SummarizerOutput } from "@/types/pipeline";

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
};

export type { SummarizerOutput };
