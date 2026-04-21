// author: Claude
import { describe, expect, test } from "bun:test";
import { bm25Vectorize } from "@/retriever/bm25";

/**
 * Sparse-vector constants mirror `packages/mcp/src/lib/embedder/bm25.ts`
 * exactly. These tests pin the FNV-1a hash values so regressions blow up
 * loud — drifting from mcp's hash means stored vectors and query vectors
 * stop lining up in Qdrant (R2).
 */

describe("bm25Vectorize — mcp mirror", () => {
  test("empty input produces empty vector", () => {
    expect(bm25Vectorize("")).toEqual({ indices: [], values: [] });
  });

  test("drops tokens shorter than 2 chars", () => {
    // "a" and "b" are 1 char — dropped. "is" has length 2 — kept (MIN=2 inclusive).
    const v = bm25Vectorize("a is b");
    expect(v.indices.length).toBe(1);
  });

  test("single-character tokens are dropped entirely", () => {
    const v = bm25Vectorize("a b c d");
    expect(v.indices.length).toBe(0);
  });

  test("hashes a known token deterministically", () => {
    // FNV-1a 32-bit of "port" (with mcp's offset/prime).
    // h = 0x811c9dc5; for each char: h ^= c; h = imul(h, 0x01000193) >>> 0
    let h = 0x811c9dc5 >>> 0;
    for (const c of "port") {
      h ^= c.charCodeAt(0);
      h = Math.imul(h, 0x01000193) >>> 0;
    }

    const v = bm25Vectorize("port");
    expect(v.indices).toEqual([h]);
    expect(v.values).toEqual([1]);
  });

  test("term-frequency counts repeated tokens", () => {
    const v = bm25Vectorize("port port port");
    expect(v.indices.length).toBe(1);
    expect(v.values[0]).toBe(3);
  });

  test("filters by stopwords argument", () => {
    const plain = bm25Vectorize("port glorbulon");
    const filtered = bm25Vectorize("port glorbulon", ["glorbulon"]);
    expect(plain.indices.length).toBe(2);
    expect(filtered.indices.length).toBe(1);
  });

  test("splits on unicode whitespace + punctuation", () => {
    const v = bm25Vectorize("port,glorbulon protocol!");
    expect(v.indices.length).toBe(3);
  });
});
