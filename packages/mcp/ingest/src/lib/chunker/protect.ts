// author: Claude
import type { Root as MdastRoot, RootContent } from "mdast";

/**
 * Identify "protected regions" — byte ranges in the body where the splitter
 * MUST NOT place a boundary ([§16.2](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#162-within-section-chunking-3b--the-recursive-overflow-splitter)). Code fences, tables, list items, and
 * blockquotes are atomic.
 *
 * A split point at offset `p` is valid iff for every protected range
 * `[start, end)`, `p <= start || p >= end`. The splitter calls `isProtected`
 * for each candidate; see `split.ts`.
 */

export type ProtectedRange = { start: number; end: number };

const PROTECTED_TYPES: ReadonlySet<string> = new Set([
  "code",
  "table",
  "blockquote",
]);

const collect = (node: RootContent, out: ProtectedRange[]): void => {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (typeof start === "number" && typeof end === "number") {
    if (PROTECTED_TYPES.has(node.type)) {
      out.push({ start, end });
      // Don't recurse into a protected node's children — it's opaque.
      return;
    }
    if (node.type === "listItem") {
      out.push({ start, end });
      return;
    }
  }
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      collect(child as RootContent, out);
    }
  }
};

/** Compute all protected ranges inside an mdast tree, relative to `body` char offsets. */
export const computeProtectedRanges = (ast: MdastRoot): ReadonlyArray<ProtectedRange> => {
  const out: ProtectedRange[] = [];
  for (const node of ast.children) {
    collect(node, out);
  }
  out.sort((a, b) => a.start - b.start);
  return out;
};

/**
 * Return true iff `offset` lies strictly inside any protected range — used
 * to veto a candidate split point.
 */
export const isInsideProtected = (
  offset: number,
  ranges: ReadonlyArray<ProtectedRange>,
): boolean => {
  for (const r of ranges) {
    if (offset > r.start && offset < r.end) return true;
  }
  return false;
};
