// author: Claude
//
// Behavioral test for the post-timeout cold-load escalation in the Ollama
// summarizer. The per-attempt timeout is NOT sent on the wire (it only drives an
// internal AbortController), so we can't assert it off the request body. Instead
// we configure two widely-separated budgets — a tight steady-state timeout and a
// generous first-call/cold-load timeout — and prove escalation *behaviorally*: a
// response slow enough to abort under the tight budget only lands if the retry
// after a timeout is granted the generous budget.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@/lib/config";
import { createOllamaSummarizer } from "@/lib/summarizer/ollama";
import { __test__ } from "@/lib/summarizer/core";
import { asChunkId } from "@/types/ids";
import type { SummarizerInput } from "@/lib/summarizer/types";

const CHUNK_ID = asChunkId("c".repeat(64));
const input = (): SummarizerInput => ({
  chunk_id: CHUNK_ID,
  chunk_content: "Body content long enough to situate the chunk.",
  document_title: "Doc",
  heading_path: ["Section"],
  containing_text: "Body content long enough to situate the chunk.",
  outline: undefined,
});

// Tight steady-state budget vs. generous cold-load budget, far enough apart that
// real-timer jitter can't blur them. The slow response sits strictly between.
const TIGHT_MS = 50;
const ESCALATED_MS = 8000;
const SLOW_RESPONSE_MS = 400;

const GOOD_SUMMARY = "x".repeat(80);
const okResponse = (): Response =>
  new Response(JSON.stringify({ response: `{"summary":"${GOOD_SUMMARY}"}` }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const abortError = (): Error => {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
};

const originalFetch = globalThis.fetch;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "june-esc-"));
  const configPath = join(tmpDir, "config.yaml");
  await writeFile(
    configPath,
    [
      "ollama:",
      `  summarizer_timeout_ms: ${TIGHT_MS}`,
      `  first_call_timeout_ms: ${ESCALATED_MS}`,
      "  summarizer_retry_max_attempts: 2",
      "  retry:",
      "    base_ms: 1",
      "    max_attempts: 2",
    ].join("\n"),
  );
  await loadConfig(configPath);
});

afterAll(async () => {
  globalThis.fetch = originalFetch;
  await loadConfig(undefined); // restore shipped defaults for sibling suites
  await rm(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

describe("ollama summarizer cold-load timeout escalation", () => {
  test("a post-timeout retry escalates to the cold-load budget and recovers", async () => {
    // Call sequence on the shared summarizer:
    //   1 (warm-up)      → immediate success, latches firstCallDone=true
    //   2 (chunk attempt 1) → slow (400ms) under the tight 50ms budget → aborts
    //                         → OllamaTimeoutError → reloadLikely=true
    //   3 (chunk attempt 2) → slow (400ms) under the escalated 8000ms budget
    //                         → lands → success (only possible WITH escalation)
    let calls = 0;
    globalThis.fetch = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      calls++;
      if (calls === 1) return okResponse(); // warm-up: instant
      return await new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        const timer = setTimeout(() => resolve(okResponse()), SLOW_RESPONSE_MS);
        if (signal) {
          if (signal.aborted) {
            clearTimeout(timer);
            reject(abortError());
            return;
          }
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(abortError());
            },
            { once: true },
          );
        }
      });
    }) as typeof fetch;

    const s = createOllamaSummarizer();
    await s.summarizeChunk(input()); // warm-up → firstCallDone

    const out = await s.summarizeChunk(input());

    // Recovered the real summary (not the heading-path template fallback) — only
    // reachable if attempt 2 ran under the escalated cold-load budget.
    expect(out.contextual_summary).toBe(GOOD_SUMMARY);
    expect(out.contextual_summary).not.toBe(__test__.fallbackSummary(input()));
    // 1 warm-up + 2 attempts (timeout → escalated retry) = 3 fetches.
    expect(calls).toBe(3);
  });

  test("a steady-state warm call uses the tight budget and succeeds fast", async () => {
    // Sanity: with a fast response, no escalation is involved and the tight
    // budget is sufficient — confirms the tight path is the default.
    globalThis.fetch = (async () => okResponse()) as unknown as typeof fetch;
    const s = createOllamaSummarizer();
    await s.summarizeChunk(input()); // first (cold) call
    const out = await s.summarizeChunk(input()); // warm, tight budget
    expect(out.contextual_summary).toBe(GOOD_SUMMARY);
  });
});
