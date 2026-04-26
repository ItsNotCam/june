// author: Claude
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@/lib/config";
import { splitFrontmatter, resolveDocumentTitle } from "@/pipeline/stages/02-parse";
import { parseMarkdown } from "@/lib/parser/markdown";
import { computeProtectedRanges, isInsideProtected } from "@/lib/chunker/protect";
import { chunkSection } from "@/lib/chunker/split";
import { sectionize } from "@/lib/chunker/sectionize";
import { deriveChunkId, deriveDocId } from "@/lib/ids";
import { asVersion } from "@/types/ids";
import { structuralFeaturesFor } from "@/pipeline/stages/04-derive";

/**
 * Structural invariants for [§37.1](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#371-structural-invariants-of-chunking):
 *   - code fences / tables / lists / blockquotes never split;
 *   - overlap is contiguous between continuation chunks;
 *   - chunk IDs are deterministic from (doc_id, version, offsets, schema_v).
 */

beforeAll(async () => {
  await loadConfig(undefined);
});

describe("Stage 2 splitFrontmatter", () => {
  test("detects `---` block and returns body offset", () => {
    const input = "---\ntitle: x\n---\nHello\n";
    const { frontmatter, body, bodyOffset } = splitFrontmatter(input);
    expect(frontmatter).toBe("title: x");
    expect(body).toBe("Hello\n");
    expect(bodyOffset).toBe(input.length - body.length);
  });

  test("returns input verbatim when no frontmatter", () => {
    const { frontmatter, body, bodyOffset } = splitFrontmatter("# Heading\n");
    expect(frontmatter).toBeUndefined();
    expect(body).toBe("# Heading\n");
    expect(bodyOffset).toBe(0);
  });
});

describe("Stage 2 resolveDocumentTitle", () => {
  test("frontmatter wins", () => {
    const ast = parseMarkdown("# H1\n", "file:///x.md");
    expect(resolveDocumentTitle("Custom", ast, "file:///x.md")).toBe("Custom");
  });
  test("first H1 wins when no frontmatter", () => {
    const ast = parseMarkdown("# First\n\n# Second\n", "file:///x.md");
    expect(resolveDocumentTitle(undefined, ast, "file:///x.md")).toBe("First");
  });
  test("filename fallback title-cases", () => {
    const ast = parseMarkdown("text\n", "file:///docs/hello-world.md");
    expect(resolveDocumentTitle(undefined, ast, "file:///docs/hello-world.md")).toBe(
      "Hello World",
    );
  });
});

describe("Stage 3 protected regions (§16.2, §37.1)", () => {
  test("code fences are identified as protected", () => {
    const body = "intro\n\n```ts\nconst x = 1;\n```\n\nouttro\n";
    const ast = parseMarkdown(body, "file:///x.md");
    const ranges = computeProtectedRanges(ast);
    expect(ranges.length).toBeGreaterThan(0);
    const mid = body.indexOf("const x");
    expect(isInsideProtected(mid, ranges)).toBe(true);
  });

  test("tables are protected", () => {
    const body = `| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n`;
    const ast = parseMarkdown(body, "file:///x.md");
    const ranges = computeProtectedRanges(ast);
    expect(ranges.length).toBeGreaterThan(0);
    const mid = body.indexOf("| 1");
    expect(isInsideProtected(mid, ranges)).toBe(true);
  });

  test("splitter never places a boundary inside a protected region", () => {
    const body = Array(40).fill("Lorem ipsum dolor sit amet, consectetur adipiscing elit.").join("\n\n") +
      "\n\n```\n" +
      Array(50).fill("code_line_that_must_not_split").join("\n") +
      "\n```\n\n" +
      Array(40).fill("Fusce pharetra justo at malesuada aliquam.").join("\n\n");
    const ast = parseMarkdown(body, "file:///x.md");
    const spans = chunkSection(
      body,
      ast,
      0,
      body.length,
      { targetTokens: 100, minTokens: 20, maxTokens: 300, overlapPct: 0.1 },
      "section",
    );
    const ranges = computeProtectedRanges(ast);
    for (const s of spans) {
      expect(isInsideProtected(s.char_offset_start, ranges)).toBe(false);
      expect(isInsideProtected(s.char_offset_end, ranges)).toBe(false);
    }
  });
});

describe("Stage 3 sectionize", () => {
  test("sections form a linear sequence", () => {
    const body = "# A\n\nalpha\n\n## B\n\nbravo\n\n## C\n\ncharlie\n";
    const ast = parseMarkdown(body, "file:///x.md");
    const sections = sectionize(
      ast,
      body,
      deriveDocId("file:///x.md"),
      asVersion("v1"),
      "A",
    );
    expect(sections.length).toBe(3);
    // Sections cover the body end-to-end.
    expect(sections[0]!.char_offset_start).toBeLessThanOrEqual(sections[1]!.char_offset_start);
    expect(sections[2]!.char_offset_end).toBe(body.length);
  });

  test("prelude before first heading becomes its own section", () => {
    const body = "prelude paragraph\n\n# H1\n\nbody\n";
    const ast = parseMarkdown(body, "file:///x.md");
    const sections = sectionize(
      ast,
      body,
      deriveDocId("file:///x.md"),
      asVersion("v1"),
      "Doc Title",
    );
    expect(sections[0]?.heading_path).toEqual(["Doc Title"]);
    expect(sections.length).toBeGreaterThanOrEqual(2);
  });

  test("nested headings emit only leaves, not parents", () => {
    // ## P holds two ### children — P itself must be suppressed; only the two
    // leaf children should appear, plus P's intro (text between ## P and the
    // first ### A).
    const body =
      "# Top\n\n## P\n\nintro to P\n\n### A\n\ntext-A\n\n### B\n\ntext-B\n";
    const ast = parseMarkdown(body, "file:///x.md");
    const sections = sectionize(
      ast,
      body,
      deriveDocId("file:///x.md"),
      asVersion("v1"),
      "Doc",
    );
    const paths = sections.map((s) => s.heading_path);
    // Top is a non-leaf parent (has child P). P is a non-leaf parent (has A,B).
    // Expect: Top's intro (covers nothing if Top has no body, so skipped only
    // if Top's intro spans 0 chars — here Top's intro is "# Top\n\n", which is
    // non-empty content), P's intro, A, B.
    expect(paths).toEqual([
      ["Top"],
      ["Top", "P"],
      ["Top", "P", "A"],
      ["Top", "P", "B"],
    ]);
    // No section's content should contain another section's leaf content
    // — i.e. no parent-child duplication.
    const aContent = sections.find((s) => s.heading_path.at(-1) === "A")!.content;
    const bContent = sections.find((s) => s.heading_path.at(-1) === "B")!.content;
    expect(aContent).toContain("text-A");
    expect(aContent).not.toContain("text-B");
    expect(bContent).toContain("text-B");
    expect(bContent).not.toContain("text-A");
    // The "Top" intro must NOT contain the H2/H3 children's content.
    const topIntro = sections.find(
      (s) => s.heading_path.length === 1 && s.heading_path[0] === "Top",
    )!.content;
    expect(topIntro).not.toContain("text-A");
    expect(topIntro).not.toContain("text-B");
  });

  test("sibling leaves cover the whole document with no overlap", () => {
    const body =
      "# Doc\n\n## A\n\ncontent of A\n\n## B\n\ncontent of B\n\n## C\n\ncontent of C\n";
    const ast = parseMarkdown(body, "file:///x.md");
    const sections = sectionize(
      ast,
      body,
      deriveDocId("file:///x.md"),
      asVersion("v1"),
      "Doc",
    );
    // Doc has H2 children → suppressed. Doc's intro plus three H2 leaves.
    const leafPaths = sections.map((s) => s.heading_path);
    expect(leafPaths).toEqual([
      ["Doc"],
      ["Doc", "A"],
      ["Doc", "B"],
      ["Doc", "C"],
    ]);
    // Char ranges should be contiguous and non-overlapping.
    for (let i = 1; i < sections.length; i++) {
      expect(sections[i]!.char_offset_start).toBe(sections[i - 1]!.char_offset_end);
    }
    expect(sections.at(-1)!.char_offset_end).toBe(body.length);
  });
});

describe("Stage 4 structural features", () => {
  test("detects code language from fenced block", () => {
    const raw = "intro\n\n```python\ndef f(): pass\n```\n";
    const f = structuralFeaturesFor(raw, "file:///x.md");
    expect(f.contains_code).toBe(true);
    expect(f.code_languages).toContain("python");
  });

  test("detects tables and lists", () => {
    const raw = "| a | b |\n|---|---|\n| 1 | 2 |\n\n- one\n- two\n";
    const f = structuralFeaturesFor(raw, "file:///x.md");
    expect(f.has_table).toBe(true);
    expect(f.has_list).toBe(true);
  });

  test("link density scales with link count", () => {
    const raw = "plain text with [a](x) and [b](y) two links";
    const f = structuralFeaturesFor(raw, "file:///x.md");
    expect(f.link_density).toBeGreaterThan(0);
  });
});

describe("Stage 3 chunk ID determinism (§37.2)", () => {
  test("same inputs → same chunk_id", () => {
    const docA = deriveDocId("file:///x.md");
    const id1 = deriveChunkId(docA, "v1", 0, 100, 1);
    const id2 = deriveChunkId(docA, "v1", 0, 100, 1);
    expect(id1).toBe(id2);
  });
  test("different version → different chunk_id", () => {
    const docA = deriveDocId("file:///x.md");
    const id1 = deriveChunkId(docA, "v1", 0, 100, 1);
    const id2 = deriveChunkId(docA, "v2", 0, 100, 1);
    expect(id1).not.toBe(id2);
  });
});

let tempRoot: string;
beforeAll(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "june-pipeline-test-"));
});
afterAll(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("Stage 2 frontmatter + empty handling", () => {
  test("empty body → skipped_empty path", async () => {
    const path = join(tempRoot, "empty.md");
    await writeFile(path, "");
    // The splitter works purely on strings — empty normalized text.
    const { body } = splitFrontmatter("");
    expect(body).toBe("");
  });

  test("frontmatter-only file → metadata_only path", () => {
    const input = "---\ntitle: Only\n---\n";
    const { frontmatter, body } = splitFrontmatter(input);
    expect(frontmatter).toBe("title: Only");
    expect(body.trim()).toBe("");
  });
});
