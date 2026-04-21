// author: Claude
import type { Root as MdastRoot, RootContent } from "mdast";
import { logger } from "@/lib/logger";
import { approximateTokens } from "@/lib/tokenize";
import { computeProtectedRanges, isInsideProtected, type ProtectedRange } from "./protect";

/**
 * Recursive overflow splitter ([§16.2](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#162-within-section-chunking-3b--the-recursive-overflow-splitter)). Given a section's text span and the
 * section's mdast subtree, produce one or more `{ start, end, content }`
 * chunks that:
 *   - never split inside a protected region (code, table, list item, blockquote),
 *   - aim for `target_tokens` per chunk,
 *   - never exceed `max_tokens × 4` characters,
 *   - overlap adjacent chunks by `overlap_pct` from the left into the right,
 *   - prefer paragraph > sentence > hard-character boundaries in that order.
 */

export type ChunkSpan = {
  char_offset_start: number;
  char_offset_end: number;
  content: string;
};

export type SplitOpts = {
  targetTokens: number;
  minTokens: number;
  maxTokens: number;
  overlapPct: number;
};

const isBlockBoundary = (ast: MdastRoot, start: number, end: number): number[] => {
  // Paragraph-style boundaries are the offsets between two consecutive
  // top-level block children that both lie within [start, end).
  const points: number[] = [];
  const children = ast.children as ReadonlyArray<RootContent>;
  for (let i = 0; i < children.length - 1; i++) {
    const current = children[i];
    const next = children[i + 1];
    const curEnd = current?.position?.end?.offset ?? -1;
    const nextStart = next?.position?.start?.offset ?? -1;
    if (curEnd >= start && nextStart <= end && curEnd <= nextStart) {
      points.push(nextStart);
    }
  }
  return points;
};

const SENTENCE_RE = /[.!?](\s)+[A-Z]/g;

const findSentenceBoundaries = (span: string, absStart: number): number[] => {
  const points: number[] = [];
  SENTENCE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SENTENCE_RE.exec(span)) !== null) {
    // Boundary is just after the punctuation (+1 for the whitespace).
    points.push(absStart + match.index + 2);
  }
  return points;
};

const pickClosest = (candidates: ReadonlyArray<number>, target: number): number | null => {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = Math.abs(c - target);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
};

const filterProtected = (
  cands: ReadonlyArray<number>,
  ranges: ReadonlyArray<ProtectedRange>,
): number[] => cands.filter((c) => !isInsideProtected(c, ranges));

const sliceSpan = (
  body: string,
  start: number,
  end: number,
  overlapFromLeft: string,
): ChunkSpan => {
  // Overlap is prepended to the body; char offsets reflect the boundary, not
  // the overlap start ([§16.2](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#162-within-section-chunking-3b--the-recursive-overflow-splitter)).
  const content =
    overlapFromLeft.length > 0 ? overlapFromLeft + body.slice(start, end) : body.slice(start, end);
  return {
    char_offset_start: start,
    char_offset_end: end,
    content,
  };
};

/**
 * Split the `[start, end)` span into chunks according to `opts`. Recurses on
 * oversize spans; emits a single chunk for under-target spans. `overlapChars`
 * from the left neighbor is prepended to the first emitted chunk of each
 * recursive call (but never to the first chunk of the section, which the
 * caller signals via `overlapChars = ""`).
 */
export const splitSpan = (
  body: string,
  ast: MdastRoot,
  start: number,
  end: number,
  protectedRanges: ReadonlyArray<ProtectedRange>,
  opts: SplitOpts,
  overlapChars = "",
  section_id?: string,
): ChunkSpan[] => {
  const spanLen = end - start;
  const maxChars = opts.maxTokens * 4;
  const targetChars = opts.targetTokens * 4;
  const minChars = opts.minTokens * 4;

  if (spanLen <= maxChars) {
    return [sliceSpan(body, start, end, overlapChars)];
  }

  // Try paragraph, sentence, character in order.
  const targetAbs = start + targetChars;
  let cut: number | null = null;

  const paraCandidates = filterProtected(
    isBlockBoundary(ast, start, end).filter((p) => p > start && p < end),
    protectedRanges,
  );
  // Only accept boundaries that produce left ≥ minChars and right ≥ minChars.
  const paraValid = paraCandidates.filter((p) => p - start >= minChars && end - p >= minChars);
  cut = pickClosest(paraValid, targetAbs);

  if (cut === null) {
    const sentSpan = body.slice(start, end);
    const sentCandidates = filterProtected(
      findSentenceBoundaries(sentSpan, start).filter((p) => p > start && p < end),
      protectedRanges,
    );
    const sentValid = sentCandidates.filter(
      (p) => p - start >= minChars && end - p >= minChars,
    );
    cut = pickClosest(sentValid, targetAbs);
  }

  if (cut === null) {
    // Hard-character fallback.
    const hardCut = Math.min(end, start + targetChars);
    if (isInsideProtected(hardCut, protectedRanges)) {
      // The whole span is dominated by one oversize protected region —
      // emit it as a single chunk and let the embedder truncate ([§16.2](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#162-within-section-chunking-3b--the-recursive-overflow-splitter)).
      logger.warn("oversize_protected_region", {
        event: "oversize_protected_region",
        size_chars: spanLen,
        reason: "no_clean_boundary",
        ...(section_id && { section_id }),
      });
      return [sliceSpan(body, start, end, overlapChars)];
    }
    cut = hardCut;
  }

  // Left chunk (possibly with incoming overlap).
  const leftChunk = sliceSpan(body, start, cut, overlapChars);

  // Overlap into the right chunk — last overlapPct of the left's raw span
  // (not the overlap-augmented content).
  const leftRaw = body.slice(start, cut);
  const overlapLen = Math.floor(leftRaw.length * opts.overlapPct);
  const rightOverlap = overlapLen > 0 ? leftRaw.slice(leftRaw.length - overlapLen) : "";
  const rightChunks = splitSpan(
    body,
    ast,
    cut,
    end,
    protectedRanges,
    opts,
    rightOverlap,
    section_id,
  );

  return [leftChunk, ...rightChunks];
};

/**
 * Apply the splitter to a section. Returns one or more chunk spans covering
 * the section's content. Spans outside the max cap get recursed.
 */
export const chunkSection = (
  body: string,
  ast: MdastRoot,
  sectionStart: number,
  sectionEnd: number,
  opts: SplitOpts,
  section_id: string,
): ChunkSpan[] => {
  const ranges = computeProtectedRanges(ast);
  const spans = splitSpan(
    body,
    ast,
    sectionStart,
    sectionEnd,
    ranges,
    opts,
    "",
    section_id,
  );
  return spans;
};

/** Convenience — compute how many approximate tokens a chunk holds. */
export const tokensOf = (span: ChunkSpan): number => approximateTokens(span.content);
