// author: Claude
import { describe, expect, test } from "bun:test";
import {
  normalizeForResolution,
  normalizeLikeMcp,
} from "@/lib/normalize";

describe("normalizeLikeMcp — R1 mirror", () => {
  test("converts CRLF and CR to LF", () => {
    expect(normalizeLikeMcp("a\r\nb\rc")).toBe("a\nb\nc");
  });

  test("strips the five zero-width characters mcp strips", () => {
    const input = "a\u200Bb\u200Cc\u200Dd\uFEFFe\u2060f";
    expect(normalizeLikeMcp(input)).toBe("abcdef");
  });

  test("does NOT collapse whitespace (mcp does not)", () => {
    expect(normalizeLikeMcp("a  b")).toBe("a  b");
  });

  test("does NOT apply case folding or NFC", () => {
    expect(normalizeLikeMcp("Glorbulon")).toBe("Glorbulon");
  });
});

describe("normalizeForResolution — mcp mirror + whitespace collapse", () => {
  test("applies mcp normalization and collapses whitespace runs", () => {
    expect(normalizeForResolution("a\r\n\n  b")).toBe("a b");
  });

  test("is idempotent (safe to apply symmetrically)", () => {
    const input = "Glorbulon  Protocol uses\r\n\tport 7733";
    const once = normalizeForResolution(input);
    const twice = normalizeForResolution(once);
    expect(twice).toBe(once);
  });

  test("a surface hint survives the normalization round-trip", () => {
    const hint = "Glorbulon Protocol uses port 7733 for control messages";
    expect(normalizeForResolution(hint)).toBe(hint);
  });
});
