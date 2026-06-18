// author: Claude
import { describe, expect, test } from "bun:test";
import {
  __test__,
  createSummarizerFromGenerate,
  type GenerateFn,
} from "@/lib/summarizer/core";
import { asChunkId } from "@/types/ids";
import type { SummarizerInput } from "@/lib/summarizer/types";

const { extractJsonObject, extractSummary, checkSummary, fallbackSummary } =
  __test__;

const CHUNK_ID = asChunkId("a".repeat(64));

const baseInput = (): SummarizerInput => ({
  chunk_id: CHUNK_ID,
  chunk_content: "The Viznet Exchange handshake completes in two seconds.",
  document_title: "Viznet Protocol",
  heading_path: ["Networking", "Handshake"],
  containing_text: "The Viznet Exchange handshake completes in two seconds.",
  outline: undefined,
});

const constGenerate =
  (text: string): GenerateFn =>
  async () =>
    text;

describe("extractJsonObject", () => {
  test("parses a clean JSON object", () => {
    expect(extractJsonObject('{"summary":"hi"}')).toEqual({ summary: "hi" });
  });

  test("recovers JSON wrapped in prose", () => {
    const raw = 'Here is the result: {"summary":"hi there"} — done.';
    expect(extractJsonObject(raw)).toEqual({ summary: "hi there" });
  });

  test("recovers JSON inside a code fence", () => {
    const raw = '```json\n{"summary":"fenced"}\n```';
    expect(extractJsonObject(raw)).toEqual({ summary: "fenced" });
  });

  test("ignores braces inside string literals", () => {
    const raw = '{"summary":"a } brace in text"}';
    expect(extractJsonObject(raw)).toEqual({ summary: "a } brace in text" });
  });

  test("returns null when no object is present", () => {
    expect(extractJsonObject("no json here")).toBeNull();
  });
});

describe("extractSummary", () => {
  test("returns the trimmed summary string", () => {
    expect(extractSummary('{"summary":"  spaced  "}')).toBe("spaced");
  });

  test("returns null when the shape is wrong", () => {
    expect(extractSummary('{"notsummary":"x"}')).toBeNull();
  });
});

describe("checkSummary", () => {
  test("rejects too-short and accepts in-bounds, with reasons", () => {
    expect(checkSummary("short")).toEqual({ ok: false, reason: "too_short" });
    expect(checkSummary("x".repeat(80))).toEqual({ ok: true });
  });

  test("rejects JSON-looking, fenced, and heading-led output, with reasons", () => {
    expect(checkSummary(`{${"x".repeat(80)}`)).toEqual({
      ok: false,
      reason: "leading_json",
    });
    expect(checkSummary("```" + "x".repeat(80))).toEqual({
      ok: false,
      reason: "code_fence",
    });
    expect(checkSummary("# Heading\n" + "x".repeat(80))).toEqual({
      ok: false,
      reason: "heading_line",
    });
  });
});

describe("createSummarizerFromGenerate.summarizeChunk", () => {
  test("returns a grounded summary when generate yields valid JSON", async () => {
    const summary = "x".repeat(80);
    const s = createSummarizerFromGenerate({
      name: "fake",
      generate: constGenerate(`prefix {"summary":"${summary}"} suffix`),
    });
    const out = await s.summarizeChunk(baseInput());
    expect(out.contextual_summary).toBe(summary);
    expect(out.chunk_id).toBe(CHUNK_ID);
  });

  test("falls back to the heading-path blurb when generate throws", async () => {
    const s = createSummarizerFromGenerate({
      name: "fake",
      generate: async () => {
        throw new Error("boom");
      },
    });
    const out = await s.summarizeChunk(baseInput());
    expect(out.contextual_summary).toBe(fallbackSummary(baseInput()));
  });

  test("falls back when the summary is out of bounds", async () => {
    const s = createSummarizerFromGenerate({
      name: "fake",
      generate: constGenerate('{"summary":"too short"}'),
    });
    const out = await s.summarizeChunk(baseInput());
    expect(out.contextual_summary).toBe(fallbackSummary(baseInput()));
  });

  test("re-rolls on unparseable output and accepts a later valid attempt", async () => {
    const good = "y".repeat(80);
    let calls = 0;
    const s = createSummarizerFromGenerate({
      name: "fake",
      // Attempt 0 returns an unterminated JSON string (a degeneration loop's
      // signature → extract_null); attempt 1 returns valid JSON.
      generate: async (_prompt, _jsonMode, attempt) => {
        calls++;
        return (attempt ?? 0) === 0
          ? '{"summary": "never closes'
          : `{"summary":"${good}"}`;
      },
    });
    const out = await s.summarizeChunk(baseInput());
    expect(out.contextual_summary).toBe(good);
    expect(calls).toBe(2);
  });
});
