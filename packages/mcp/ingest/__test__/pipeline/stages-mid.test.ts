// author: Claude
import { describe, expect, test, beforeAll } from "bun:test";
import { loadConfig } from "@/lib/config";
import { composeEmbedText } from "@/pipeline/stages/08-embed-text";
import { bm25Vectorize } from "@/lib/embedder/bm25";
import { createStubEmbedder } from "@/lib/embedder/stub";

/**
 * [§37](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#37-testing-philosophy) coverage for the middle stages: embed-text composition + truncation
 * hierarchy ([§21.3](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#213-length-management)), BM25 sparse vector shape, and stub embedder
 * determinism.
 */

beforeAll(async () => {
  await loadConfig(undefined);
});

describe("Stage 8 embed-text composition (§21)", () => {
  test("composes in title → path → summary → content order", () => {
    const { text } = composeEmbedText({
      document_title: "Title",
      heading_path: ["A", "B"],
      contextual_summary: "Situating blurb.",
      content: "body",
      maxChars: 1000,
    });
    const tIdx = text.indexOf("Title");
    const pathIdx = text.indexOf("A > B");
    const summaryIdx = text.indexOf("Situating blurb.");
    const bodyIdx = text.indexOf("body");
    expect(tIdx).toBeLessThan(pathIdx);
    expect(pathIdx).toBeLessThan(summaryIdx);
    expect(summaryIdx).toBeLessThan(bodyIdx);
  });

  test("truncates content when total exceeds the max", () => {
    const long = "a".repeat(5000);
    const { text, truncated } = composeEmbedText({
      document_title: "Title",
      heading_path: ["A"],
      contextual_summary: "Summary.",
      content: long,
      maxChars: 100,
    });
    expect(truncated).toBe(true);
    expect(text.length).toBeLessThanOrEqual(200);
    // Structure is still recognizable.
    expect(text.startsWith("Title")).toBe(true);
  });

  test("preserves heading path tail under truncation", () => {
    const long = "c".repeat(2000);
    const { text } = composeEmbedText({
      document_title: "Title",
      heading_path: ["A", "B", "C", "D", "E"],
      contextual_summary: "S",
      content: long,
      maxChars: 200,
    });
    // At least "D > E" survives even after the front of the path is cut.
    expect(text.includes("D > E")).toBe(true);
  });
});

describe("Stage 9 BM25 sparse vector", () => {
  test("produces deterministic indices + values", () => {
    const a = bm25Vectorize("the quick brown fox jumps");
    const b = bm25Vectorize("the quick brown fox jumps");
    expect(a.indices).toEqual(b.indices);
    expect(a.values).toEqual(b.values);
  });

  test("ignores tokens shorter than 2 chars", () => {
    const v = bm25Vectorize("a ab abc");
    // "a" is dropped; "ab" and "abc" remain.
    expect(v.values.reduce((s, x) => s + x, 0)).toBe(2);
  });

  test("term frequency counts repeats", () => {
    const v = bm25Vectorize("banana banana banana");
    // Only "banana" after filtering; value is 3.
    expect(v.values).toEqual([3]);
  });
});

describe("Stage 9 stub embedder", () => {
  test("produces unit-length vectors", async () => {
    const embed = createStubEmbedder(32);
    const vecs = await embed.embed(["hello world", "second text"]);
    expect(vecs.length).toBe(2);
    for (const v of vecs) {
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
      expect(Math.abs(norm - 1)).toBeLessThan(1e-6);
    }
  });

  test("deterministic — same input, same vector", async () => {
    const e = createStubEmbedder(16);
    const [a] = await e.embed(["foo"]);
    const [b] = await e.embed(["foo"]);
    expect(a).toEqual(b);
  });
});
