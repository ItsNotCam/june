// author: Claude
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  __test__,
  createSummarizerFromGenerate,
  type GenerateFn,
} from "@/lib/summarizer/core";
import { loadConfig } from "@/lib/config";
import { asChunkId } from "@/types/ids";
import type { SummarizerInput } from "@/lib/summarizer/types";

const { extractJsonObject, extractSummary, checkSummary, fallbackSummary } =
  __test__;

// summarizeChunk now reads `summarizer.on_failure` at the fallback point, so the
// config must be loaded. Default to shipped defaults (on_failure="template") and
// reset before every test; the error-mode test loads its own config in-test.
let errorConfigPath: string;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "june-core-"));
  errorConfigPath = join(tmpDir, "error.yaml");
  await writeFile(errorConfigPath, "summarizer:\n  on_failure: error\n");
});

beforeEach(async () => {
  await loadConfig(undefined); // shipped defaults: on_failure="template"
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

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

  test("on_failure=error throws instead of templating when generate keeps throwing", async () => {
    await loadConfig(errorConfigPath);
    const s = createSummarizerFromGenerate({
      name: "fake",
      generate: async () => {
        throw new Error("boom");
      },
    });
    // No fallback: the ingest must abort, not ship a heading-path template.
    await expect(s.summarizeChunk(baseInput())).rejects.toThrow(
      /on_failure="error"/,
    );
  });

  test("on_failure=error throws when output is persistently invalid", async () => {
    await loadConfig(errorConfigPath);
    const s = createSummarizerFromGenerate({
      name: "fake",
      generate: constGenerate('{"summary":"too short"}'),
    });
    await expect(s.summarizeChunk(baseInput())).rejects.toThrow(
      /could not produce a valid summary/,
    );
  });
});
