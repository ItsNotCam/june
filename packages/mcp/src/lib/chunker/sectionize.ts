import type { Root as MdastRoot, Heading } from "mdast";
import { deriveContentHash, deriveSectionId } from "@/lib/ids";
import type { DocId, Version } from "@/types/ids";
import type { Section } from "@/types/section";

/**
 * Heading-aware sectioning ([§16.1](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#161-heading-based-sectioning-3a)). Walks the mdast root's direct children
 * and emits `Section` records bounded by heading-depth transitions.
 *
 * Each emitted section carries the heading breadcrumb (`heading_path`), its
 * char range in `body`, and its content sliced from `body`. Pre-heading
 * prelude becomes its own section labelled with the `document_title` as the
 * single heading-path entry ([§15.5](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#155-degenerate-files) case 4 and [§16.1](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#161-heading-based-sectioning-3a)).
 */

const headingText = (heading: Heading): string =>
  heading.children
    .map((c) => ("value" in c && typeof c.value === "string" ? c.value : ""))
    .join("")
    .trim();

type StackEntry = {
  depth: number;
  text: string;
  charStart: number;
  headingPath: ReadonlyArray<string>;
};

export const sectionize = (
  ast: MdastRoot,
  body: string,
  doc_id: DocId,
  version: Version,
  document_title: string,
): ReadonlyArray<Section> => {
  const sections: Section[] = [];
  const stack: StackEntry[] = [];
  let ordinal = 0;

  const openPrelude = (): void => {
    // If the body starts with non-heading content, open a pseudo-section
    // using the document title as its heading path.
    stack.push({
      depth: 1,
      text: document_title,
      charStart: 0,
      headingPath: [document_title],
    });
  };

  const closeTo = (depth: number, endOffset: number): void => {
    while (stack.length > 0 && stack[stack.length - 1]!.depth >= depth) {
      const top = stack.pop()!;
      const content = body.slice(top.charStart, endOffset);
      sections.push({
        section_id: deriveSectionId(doc_id, top.headingPath, top.charStart),
        doc_id,
        version,
        parent_section_id:
          stack.length > 0
            ? deriveSectionId(
                doc_id,
                stack[stack.length - 1]!.headingPath,
                stack[stack.length - 1]!.charStart,
              )
            : undefined,
        heading_level: Math.max(1, Math.min(6, top.depth)) as 1 | 2 | 3 | 4 | 5 | 6,
        heading_text: top.text,
        heading_path: top.headingPath,
        ordinal: ordinal++,
        byte_offset_start: top.charStart,
        byte_offset_end: endOffset,
        char_offset_start: top.charStart,
        char_offset_end: endOffset,
        content_hash: deriveContentHash(content),
        content,
        raw_markdown: content,
      });
    }
  };

  let firstHeadingSeen = false;
  for (const node of ast.children) {
    if (node.type === "heading") {
      const start = node.position?.start?.offset ?? 0;
      if (!firstHeadingSeen && start > 0) {
        // Pre-heading prelude — open a synthetic section.
        openPrelude();
        closeTo(1, start);
      }
      firstHeadingSeen = true;
      closeTo(node.depth, start);
      const path = stack
        .map((e) => e.headingPath[e.headingPath.length - 1]!)
        .filter((e) => e !== undefined);
      const newPath = [...path, headingText(node)];
      stack.push({
        depth: node.depth,
        text: headingText(node),
        charStart: start,
        headingPath: newPath,
      });
    }
  }

  if (!firstHeadingSeen) {
    // No headings — whole body is one prelude section.
    openPrelude();
  }

  closeTo(0, body.length);
  return sections;
};
