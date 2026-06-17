// author: Claude
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { loadConfig } from "@/lib/config";
import { createOllamaSummarizer } from "@/lib/summarizer/ollama";
import { asChunkId } from "@/types/ids";
import type { SummarizerInput } from "@/lib/summarizer/types";

const CHUNK_ID = asChunkId("b".repeat(64));

const input = (): SummarizerInput => ({
  chunk_id: CHUNK_ID,
  chunk_content: "Body content long enough to situate.",
  document_title: "Doc",
  heading_path: ["Section"],
  containing_text: "Body content long enough to situate.",
  outline: undefined,
});

const originalFetch = globalThis.fetch;

let captured: { url: string; body: unknown } | null = null;

beforeAll(async () => {
  await loadConfig(undefined);
});

beforeEach(() => {
  captured = null;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured = {
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };
    const summary = "x".repeat(80);
    return new Response(JSON.stringify({ response: `{"summary":"${summary}"}` }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("ollama summarizer determinism", () => {
  test("sends temperature 0 and a fixed seed on /api/generate", async () => {
    const s = createOllamaSummarizer();
    await s.summarizeChunk(input());

    expect(captured).not.toBeNull();
    const body = captured!.body as {
      options?: { temperature?: number; seed?: number };
      format?: string;
    };
    expect(captured!.url).toContain("/api/generate");
    expect(body.options?.temperature).toBe(0);
    expect(typeof body.options?.seed).toBe("number");
    // JSON-mode decode is still requested.
    expect(body.format).toBe("json");
  });
});
