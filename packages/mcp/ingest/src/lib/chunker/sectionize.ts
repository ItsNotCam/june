// author: Claude
import type { Root as MdastRoot, Heading } from "mdast";
import { deriveContentHash, deriveSectionId } from "@/lib/ids";
import type { DocId, Version } from "@/types/ids";
import type { Section } from "@/types/section";

/**
 * Heading-aware sectioning ([§16.1](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#161-heading-based-sectioning-3a)). Walks the mdast root's direct children
 * and emits **leaf-only** `Section` records.
 *
 * A section is "leaf" if no descendant heading is ever opened beneath it. When
 * a parent gets a child heading, the parent itself is suppressed and replaced
 * by an *intro section* spanning from the parent's heading line to the first
 * child heading — so the parent's loose body text is still chunked, but the
 * parent's full char range (which would contain every child verbatim) is not.
 *
 * This avoids the parent/child duplication that pollutes RAG ranking: a parent
 * section's text necessarily contains every child's text, so embedding both
 * the parent and its children gives the parent an artificially broad token
 * footprint and a diluted dense vector. Either signal lets the parent
 * compete with — and outrank — the more focused child for queries about a
 * single sub-topic.
 *
 * Pre-heading prelude becomes its own section labelled with the
 * `document_title` as the single heading-path entry ([§15.5](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#155-degenerate-files) case 4 and [§16.1](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#161-heading-based-sectioning-3a)).
 * Prelude is always emitted (the closeTo() before the first real heading pops
 * it before any child is pushed), so the leaf-only rule never suppresses it.
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
  /**
   * Set to true when a deeper heading is opened beneath this entry. A `true`
   * entry is suppressed at close time — its child leaves (plus the synthetic
   * intro section emitted when the first child arrived) cover its content.
   */
  hadChild: boolean;
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

  const pushSection = (
    entry: StackEntry,
    endOffset: number,
    parentEntry: StackEntry | undefined,
  ): void => {
    const content = body.slice(entry.charStart, endOffset);
    sections.push({
      section_id: deriveSectionId(doc_id, entry.headingPath, entry.charStart),
      doc_id,
      version,
      parent_section_id:
        parentEntry !== undefined
          ? deriveSectionId(doc_id, parentEntry.headingPath, parentEntry.charStart)
          : undefined,
      heading_level: Math.max(1, Math.min(6, entry.depth)) as 1 | 2 | 3 | 4 | 5 | 6,
      heading_text: entry.text,
      heading_path: entry.headingPath,
      ordinal: ordinal++,
      byte_offset_start: entry.charStart,
      byte_offset_end: endOffset,
      char_offset_start: entry.charStart,
      char_offset_end: endOffset,
      content_hash: deriveContentHash(content),
      content,
      raw_markdown: content,
    });
  };

  const openPrelude = (): void => {
    stack.push({
      depth: 1,
      text: document_title,
      charStart: 0,
      headingPath: [document_title],
      hadChild: false,
    });
  };

  const closeTo = (depth: number, endOffset: number): void => {
    while (stack.length > 0 && stack[stack.length - 1]!.depth >= depth) {
      const top = stack.pop()!;
      // Suppress non-leaf parents — their content is already covered by the
      // intro section emitted when the first child arrived plus the child
      // leaves themselves.
      if (top.hadChild) continue;
      const parent = stack.length > 0 ? stack[stack.length - 1] : undefined;
      pushSection(top, endOffset, parent);
    }
  };

  /**
   * About to push a new heading deeper than the current top. The top will
   * become a non-leaf parent — emit its intro (text between the top's heading
   * line and the new child's heading line) as its own section and mark it
   * `hadChild` so the close-time pop suppresses the parent itself.
   */
  const emitParentIntroIfNeeded = (newHeadingStart: number): void => {
    if (stack.length === 0) return;
    const parent = stack[stack.length - 1]!;
    if (parent.hadChild) return;
    const grandparent = stack.length > 1 ? stack[stack.length - 2] : undefined;
    pushSection(parent, newHeadingStart, grandparent);
    parent.hadChild = true;
  };

  let firstHeadingSeen = false;
  for (const node of ast.children) {
    if (node.type !== "heading") continue;
    const start = node.position?.start?.offset ?? 0;
    if (!firstHeadingSeen && start > 0) {
      openPrelude();
      closeTo(1, start);
    }
    firstHeadingSeen = true;
    closeTo(node.depth, start);
    emitParentIntroIfNeeded(start);
    const path = stack
      .map((e) => e.headingPath[e.headingPath.length - 1]!)
      .filter((e) => e !== undefined);
    const newPath = [...path, headingText(node)];
    stack.push({
      depth: node.depth,
      text: headingText(node),
      charStart: start,
      headingPath: newPath,
      hadChild: false,
    });
  }

  if (!firstHeadingSeen) {
    openPrelude();
  }

  closeTo(0, body.length);
  return sections;
};
