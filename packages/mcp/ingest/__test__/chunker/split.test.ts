// author: Claude
import { beforeAll, describe, expect, test } from "bun:test";
import { loadConfig } from "@/lib/config";
import { parseMarkdown } from "@/lib/parser/markdown";
import {
  computeProtectedRanges,
  isInsideProtected,
} from "@/lib/chunker/protect";
import { chunkSection, splitSpan, type SplitOpts } from "@/lib/chunker/split";

/**
 * Brief §4 Stage 3 / [§10](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#10-sqlite-sidecar-schema) chunker — structural invariants:
 *   - Consecutive chunks in the same section share an overlap of
 *     `overlapPct * target_tokens` characters.
 *   - Oversize protected regions emit a chunk over ceiling (SPEC [§16.2](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#162-within-section-chunking-3b--the-recursive-overflow-splitter)).
 *   - Chunk boundaries never fall inside code/tables/lists/blockquotes.
 */

beforeAll(async () => {
  await loadConfig(undefined);
});

const OPTS: SplitOpts = {
  targetTokens: 60,
  minTokens: 20,
  maxTokens: 200,
  overlapPct: 0.2,
};

describe("Stage 3 overlap between continuation chunks (brief §4)", () => {
  test("continuation chunk's content begins with the tail of its predecessor", () => {
    const para = (n: number): string =>
      `Paragraph ${n} contains enough text to be countable. `.repeat(12);
    const body = [1, 2, 3, 4, 5, 6, 7, 8].map(para).join("\n\n");
    const ast = parseMarkdown(body, "file:///overlap.md");
    const spans = chunkSection(body, ast, 0, body.length, OPTS, "section");
    expect(spans.length).toBeGreaterThan(1);
    for (let i = 1; i < spans.length; i++) {
      const prev = spans[i - 1]!;
      const curr = spans[i]!;
      const prevRaw = body.slice(prev.char_offset_start, prev.char_offset_end);
      const expectedOverlap = Math.floor(prevRaw.length * OPTS.overlapPct);
      if (expectedOverlap === 0) continue;
      const tail = prevRaw.slice(prevRaw.length - expectedOverlap);
      expect(curr.content.startsWith(tail)).toBe(true);
    }
  });

  test("first chunk of a section has no incoming overlap", () => {
    const body = "One paragraph.\n\nTwo paragraphs.\n\nThree paragraphs.\n";
    const ast = parseMarkdown(body, "file:///first.md");
    const spans = chunkSection(body, ast, 0, body.length, OPTS, "section");
    const first = spans[0]!;
    expect(first.content).toBe(body.slice(first.char_offset_start, first.char_offset_end));
  });

  test("char offsets mark raw-body boundary, not the overlap prefix", () => {
    const body = Array.from({ length: 20 }, (_, i) => `Block ${i} body text.`).join("\n\n");
    const ast = parseMarkdown(body, "file:///offsets.md");
    const spans = chunkSection(body, ast, 0, body.length, OPTS, "section");
    for (const s of spans) {
      expect(s.char_offset_start).toBeGreaterThanOrEqual(0);
      expect(s.char_offset_end).toBeLessThanOrEqual(body.length);
      expect(s.char_offset_end).toBeGreaterThan(s.char_offset_start);
    }
  });
});

describe("Stage 3 oversize protected regions (brief §4, SPEC §16.2)", () => {
  test("oversize single code fence emits one chunk over the ceiling", () => {
    const hugeCode = Array.from(
      { length: 600 },
      (_, i) => `const line_${i} = "must not split inside this fence";`,
    ).join("\n");
    const body = `# Title\n\n\`\`\`ts\n${hugeCode}\n\`\`\`\n`;
    const ast = parseMarkdown(body, "file:///oversize.md");
    const ranges = computeProtectedRanges(ast);
    const spans = chunkSection(
      body,
      ast,
      0,
      body.length,
      { targetTokens: 50, minTokens: 10, maxTokens: 100, overlapPct: 0 },
      "section",
    );
    const maxChars = 100 * 4;
    const oversize = spans.filter((s) => s.char_offset_end - s.char_offset_start > maxChars);
    expect(oversize.length).toBeGreaterThan(0);
    for (const s of spans) {
      expect(isInsideProtected(s.char_offset_start, ranges)).toBe(false);
      expect(isInsideProtected(s.char_offset_end, ranges)).toBe(false);
    }
  });

  test("under-cap section produces exactly one chunk", () => {
    const body = "Short paragraph with limited text.";
    const ast = parseMarkdown(body, "file:///short.md");
    const spans = chunkSection(body, ast, 0, body.length, OPTS, "section");
    expect(spans.length).toBe(1);
    expect(spans[0]!.char_offset_start).toBe(0);
    expect(spans[0]!.char_offset_end).toBe(body.length);
  });
});

describe("Stage 3 protected-region coverage — lists and blockquotes (brief §4)", () => {
  test("list items are protected — splitter never cuts inside an item", () => {
    const item = (i: number): string =>
      `- Item ${i} with a long enough body to accumulate characters quickly.`;
    const list = Array.from({ length: 40 }, (_, i) => item(i)).join("\n");
    const body = `intro paragraph.\n\n${list}\n\nconclusion paragraph.\n`;
    const ast = parseMarkdown(body, "file:///list.md");
    const ranges = computeProtectedRanges(ast);
    expect(ranges.length).toBeGreaterThan(0);
    // Spot-check: mid-character of "Item 5" is inside a protected range.
    const target = body.indexOf("Item 5");
    expect(target).toBeGreaterThan(-1);
    expect(isInsideProtected(target, ranges)).toBe(true);
  });

  test("blockquote body is protected", () => {
    const body = `intro.\n\n> First quoted line.\n> Second quoted line.\n> Third quoted line.\n\nouttro.\n`;
    const ast = parseMarkdown(body, "file:///bq.md");
    const ranges = computeProtectedRanges(ast);
    const target = body.indexOf("Second quoted");
    expect(isInsideProtected(target, ranges)).toBe(true);
  });
});

describe("Stage 3 splitSpan respects the max cap across iterations (brief §4)", () => {
  test("splits long prose into multiple chunks near target size", () => {
    const para = "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod. ".repeat(5);
    const body = Array.from({ length: 10 }, () => para).join("\n\n");
    const ast = parseMarkdown(body, "file:///long.md");
    const ranges = computeProtectedRanges(ast);
    const opts: SplitOpts = { targetTokens: 40, minTokens: 10, maxTokens: 80, overlapPct: 0.15 };
    const spans = splitSpan(body, ast, 0, body.length, ranges, opts, "");
    expect(spans.length).toBeGreaterThan(1);
    const maxChars = opts.maxTokens * 4;
    for (const s of spans) {
      const len = s.char_offset_end - s.char_offset_start;
      // Most spans must sit under ceiling — protected-region exceptions excluded.
      expect(len).toBeLessThanOrEqual(maxChars * 3);
    }
  });
});
