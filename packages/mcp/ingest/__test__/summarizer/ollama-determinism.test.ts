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
  test("sends a fixed seed and bounded temperature on /api/generate", async () => {
    const s = createOllamaSummarizer();
    await s.summarizeChunk(input());

    expect(captured).not.toBeNull();
    const body = captured!.body as {
      options?: { temperature?: number; seed?: number; num_ctx?: number };
      format?: { type?: string; properties?: { summary?: unknown }; required?: string[] };
      think?: boolean;
    };
    expect(captured!.url).toContain("/api/generate");
    // num_ctx is capped (not the model's 32K default) so the KV-cache doesn't
    // spill the model to CPU on a VRAM-tight host.
    expect(typeof body.options?.num_ctx).toBe("number");
    expect(body.options?.num_ctx).toBeLessThanOrEqual(32768);
    // Reasoning disabled (thinking models collapse to `{}` under forced JSON).
    expect(body.think).toBe(false);
    // Reproducibility comes from the fixed seed; a low (<1) non-zero temperature
    // escapes greedy repetition loops without sacrificing it.
    expect(typeof body.options?.seed).toBe("number");
    expect(body.options?.temperature).toBeGreaterThan(0);
    expect(body.options?.temperature).toBeLessThan(1);
    // FORCED JSON: `format` is the actual schema (grammar-constrained decode),
    // not the loose "json" mode — so the output can't be an empty `{}`.
    expect(body.format?.type).toBe("object");
    expect(body.format?.properties?.summary).toBeDefined();
    expect(body.format?.required).toContain("summary");
  });

  test("pins the model resident with a top-level keep_alive", async () => {
    const s = createOllamaSummarizer();
    await s.summarizeChunk(input());

    const body = captured!.body as {
      keep_alive?: unknown;
      options?: Record<string, unknown>;
    };
    // keep_alive must be a top-level sibling of model/prompt (NOT inside
    // `options`) so Ollama keeps gemma loaded across calls and avoids the ~18s
    // cold reload that otherwise trips the per-call timeout → template fallback.
    expect(body.keep_alive).toBeDefined();
    expect(body.options?.["keep_alive"]).toBeUndefined();
  });

  test("sends an anti-degeneration repetition penalty (breaks greedy loops)", async () => {
    const s = createOllamaSummarizer();
    await s.summarizeChunk(input());

    const body = captured!.body as {
      options?: { repeat_penalty?: number; repeat_last_n?: number };
    };
    // Pure greedy decoding loops on some chunks ("fulfulful…" → unterminated
    // JSON → silent fallback). A >1 repetition penalty breaks the loop and stays
    // deterministic given the fixed seed.
    expect(body.options?.repeat_penalty).toBeGreaterThan(1);
    expect(typeof body.options?.repeat_last_n).toBe("number");
  });
});
