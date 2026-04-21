// author: Claude
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import type { Root as MdastRoot } from "mdast";
import { ParseError } from "@/lib/errors";

/**
 * Parse a UTF-8 markdown string to a CommonMark + GFM mdast tree ([§15.3](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#153-mdast-parsing)).
 *
 * Wraps `mdast-util-from-markdown` with the GFM extension pair so that tables,
 * footnotes, and strikethrough are first-class nodes. The raw `fromMarkdown`
 * almost never throws; when it does, the document is unsalvageable ([§15.6](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#156-malformed-markdown-handling)) —
 * we wrap the cause in `ParseError` so the orchestrator can surface a clean
 * document-scoped failure.
 */
export const parseMarkdown = (body: string, source_uri: string): MdastRoot => {
  try {
    return fromMarkdown(body, {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    });
  } catch (err) {
    throw new ParseError(source_uri, err instanceof Error ? err.message : String(err));
  }
};
