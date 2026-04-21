// author: Claude
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { normalizeBytes } from "@/lib/encoding";

/**
 * [§37.11](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#3711-encoding-normalization-i3) — encoding normalization produces canonical UTF-8, LF-only,
 * zero-width-stripped text that hashes identically across source encodings.
 */

const hash = (s: string): string =>
  createHash("sha256").update(s, "utf8").digest("hex");

describe("normalizeBytes (§15.1, I3)", () => {
  test("UTF-8 without BOM passes through", () => {
    const s = "hello world\n";
    const bytes = new TextEncoder().encode(s);
    expect(normalizeBytes(bytes, "x")).toBe(s);
  });

  test("UTF-8 with BOM is stripped", () => {
    const s = "hello world\n";
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const body = new TextEncoder().encode(s);
    const combined = new Uint8Array(bom.length + body.length);
    combined.set(bom, 0);
    combined.set(body, bom.length);
    expect(normalizeBytes(combined, "x")).toBe(s);
  });

  test("UTF-16 LE with BOM hashes same as UTF-8 equivalent", () => {
    const s = "abc\n";
    const utf8 = new TextEncoder().encode(s);
    // Build UTF-16 LE bytes by hand.
    const utf16: number[] = [0xff, 0xfe];
    for (let i = 0; i < s.length; i++) {
      utf16.push(s.charCodeAt(i) & 0xff, (s.charCodeAt(i) >> 8) & 0xff);
    }
    const normalizedLE = normalizeBytes(new Uint8Array(utf16), "x");
    const normalizedUtf8 = normalizeBytes(utf8, "x");
    expect(hash(normalizedLE)).toBe(hash(normalizedUtf8));
  });

  test("CRLF and lone CR normalize to LF", () => {
    const bytes = new TextEncoder().encode("a\r\nb\rc\n");
    const out = normalizeBytes(bytes, "x");
    expect(out).toBe("a\nb\nc\n");
  });

  test("zero-width characters are stripped", () => {
    const bytes = new TextEncoder().encode("hel\u200Blo\u200C wor\uFEFFld");
    expect(normalizeBytes(bytes, "x")).toBe("hello world");
  });

  test("mid-document U+FEFF is stripped (I3)", () => {
    const a = new TextEncoder().encode("foo\uFEFFbar");
    const b = new TextEncoder().encode("foobar");
    expect(hash(normalizeBytes(a, "x"))).toBe(hash(normalizeBytes(b, "x")));
  });
});
