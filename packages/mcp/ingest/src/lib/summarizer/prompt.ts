// author: Claude
import { renderPrompt } from "@/lib/prompts";
import type { DocumentOutline } from "@/schemas/classifier";

/**
 * Prompt builders for Stage 6 ([§19.2](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#192-prompt-template), Appendix C). Each thin wrapper
 * loads its template from `packages/mcp/ingest/prompts/` and substitutes
 * `{{key}}` placeholders. Templates live on disk so prompt iteration is a
 * markdown diff rather than a TypeScript template-literal change.
 *
 * Variants:
 *   - `buildFitsPrompt` — whole-document in the prompt (`summarize-fits.md`).
 *   - `buildLongDocOutlinePrompt` — pass 1 outline (`summarize-long-doc-outline.md`).
 *   - `buildLongDocChunkPrompt` — pass 2 with outline + parent section (`summarize-long-doc-chunk.md`).
 *
 * Every template wraps untrusted data in tags per I6.
 */

export const buildFitsPrompt = (input: {
  document_body: string;
  chunk_content: string;
}): Promise<string> =>
  renderPrompt("summarize-fits", {
    document_body: input.document_body,
    chunk_content: input.chunk_content,
  });

export const buildLongDocOutlinePrompt = (input: {
  document_body_truncated: string;
}): Promise<string> =>
  renderPrompt("summarize-long-doc-outline", {
    document_body_truncated: input.document_body_truncated,
  });

export const buildLongDocChunkPrompt = (input: {
  outline: DocumentOutline;
  local_section: string;
  chunk_content: string;
}): Promise<string> =>
  renderPrompt("summarize-long-doc-chunk", {
    outline: input.outline,
    local_section: input.local_section,
    chunk_content: input.chunk_content,
  });
