// author: Claude
import type { Summarizer, SummarizerInput } from "./types";

/**
 * Deterministic summarizer emitting the heading-path fallback blurb ([§19.5](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#195-output-validation-and-bounds)).
 * Used for tests and `config.summarizer.implementation = "stub"`.
 */
const makeBlurb = (input: SummarizerInput): string => {
  const path = input.heading_path.join(" > ");
  const first = input.chunk_content.trim().split(/[.!?]\s/)[0]?.slice(0, 160) ?? "";
  return `This excerpt is from the section '${path}' of ${input.document_title}, covering ${first}.`;
};

export const createStubSummarizer = (): Summarizer => ({
  name: "stub",
  version: "0",
  summarizeChunk: async (input) => ({
    chunk_id: input.chunk_id,
    contextual_summary: makeBlurb(input),
    used_long_doc_path: false,
  }),
  summarizeDocument: async (input) => ({
    title: input.document_title,
    purpose: "Stubbed outline — no model call.",
    sections: [{ heading_path: [input.document_title], one_line: "document" }],
  }),
});
