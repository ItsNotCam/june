// author: Claude
import { beforeAll, describe, expect, test } from "bun:test";
import { loadConfig } from "@/lib/config";
import { getEnv } from "@/lib/env";
import {
  createApiSummarizer,
  createAnthropicSummarizer,
  createDeepseekSummarizer,
  DEEPSEEK_ANTHROPIC_BASE_URL,
} from "@/lib/summarizer/anthropic-compat";
import { MissingSummarizerApiKeyError } from "@/lib/errors";
import { asChunkId } from "@/types/ids";
import type { SummarizerInput } from "@/lib/summarizer/types";

beforeAll(async () => {
  await loadConfig(undefined);
});

const CHUNK_ID = asChunkId("c".repeat(64));

const input = (): SummarizerInput => ({
  chunk_id: CHUNK_ID,
  chunk_content: "Body content long enough to situate this chunk.",
  document_title: "Doc",
  heading_path: ["Section"],
  containing_text: "Body content long enough to situate this chunk.",
  outline: undefined,
});

/** Minimal Anthropic Messages response carrying a valid summary payload. */
const messageResponse = (summary: string): Response =>
  new Response(
    JSON.stringify({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "deepseek-v4-flash",
      content: [{ type: "text", text: `{"summary":"${summary}"}` }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 20 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

type CapturedBody = {
  model?: unknown;
  temperature?: unknown;
  max_tokens?: unknown;
  thinking?: { type?: string };
  system?: unknown;
  messages?: unknown;
};

describe("createApiSummarizer request shape", () => {
  test("sends temperature 0, thinking disabled, JSON system, and uses the given baseURL/model", async () => {
    let captured: { url: string; body: CapturedBody } | null = null;
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      captured = {
        url: String(url),
        body: JSON.parse(String(init?.body ?? "{}")),
      };
      return messageResponse("x".repeat(80));
    }) as typeof fetch;

    const s = createApiSummarizer({
      apiKey: "test-key",
      model: "deepseek-v4-flash",
      maxTokens: 1024,
      baseURL: DEEPSEEK_ANTHROPIC_BASE_URL,
      fetch: fakeFetch,
    });
    const out = await s.summarizeChunk(input());

    expect(out.contextual_summary).toBe("x".repeat(80));
    expect(captured).not.toBeNull();
    const { url, body } = captured!;
    expect(url).toContain("api.deepseek.com/anthropic");
    expect(body.model).toBe("deepseek-v4-flash");
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(1024);
    expect(body.thinking?.type).toBe("disabled");
    expect(String(body.system)).toContain("single JSON object");
    expect(Array.isArray(body.messages)).toBe(true);
  });

  test("unload() is a no-op (API backend holds no local VRAM) — resolves, never throws", async () => {
    const s = createApiSummarizer({
      apiKey: "test-key",
      model: "deepseek-v4-flash",
      maxTokens: 1024,
      baseURL: DEEPSEEK_ANTHROPIC_BASE_URL,
      fetch: (async (_url: string | URL | Request, _init?: RequestInit) =>
        messageResponse("x".repeat(80))) as typeof fetch,
    });
    await expect(s.unload()).resolves.toBeUndefined();
  });
});

describe("API key guard", () => {
  // The key may or may not be present in the test environment; assert the
  // guard's behaviour matches whichever state we're in (no network at
  // construction either way).
  test("deepseek factory throws iff DEEPSEEK_API_KEY is absent", () => {
    if (getEnv().DEEPSEEK_API_KEY) {
      expect(() => createDeepseekSummarizer()).not.toThrow();
    } else {
      expect(() => createDeepseekSummarizer()).toThrow(MissingSummarizerApiKeyError);
    }
  });

  test("anthropic factory throws iff ANTHROPIC_API_KEY is absent", () => {
    if (getEnv().ANTHROPIC_API_KEY) {
      expect(() => createAnthropicSummarizer()).not.toThrow();
    } else {
      expect(() => createAnthropicSummarizer()).toThrow(MissingSummarizerApiKeyError);
    }
  });
});
