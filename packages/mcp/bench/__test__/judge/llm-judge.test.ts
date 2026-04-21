// author: Claude
import { beforeAll, describe, expect, test } from "bun:test";
import type {
  BatchLlmProvider,
  BatchResult,
  BatchSubmitRequest,
} from "@/providers/types";
import { createLlmJudge } from "@/judge/llm-judge";
import { loadTestConfig } from "../helpers";

/**
 * In-process fake `BatchLlmProvider` — the Judge's contract is narrow enough
 * that we can inject a deterministic stub instead of mocking the Anthropic
 * SDK. Each test specifies the exact `BatchResult[]` the poll+retrieve
 * should surface.
 */
const fakeProvider = (results: BatchResult[]): BatchLlmProvider => ({
  name: "anthropic-batch",
  submit: async (_req: BatchSubmitRequest[]) => ({ batch_id: "test-batch" }),
  poll: async () => ({ status: "ended", results_url: "https://example/results" }),
  retrieve: async () => results,
});

describe("LLMJudge — UNJUDGED on malformed output (L14)", () => {
  beforeAll(async () => {
    await loadTestConfig();
  });

  test("valid JSON verdict parses", async () => {
    const judge = createLlmJudge({
      provider: fakeProvider([
        {
          custom_id: "reader:q-1",
          status: "succeeded",
          text: JSON.stringify({ verdict: "CORRECT", rationale: "ok" }),
          error: null,
          cost_usd: 0,
          prompt_tokens: null,
          completion_tokens: null,
        },
      ]),
      model: "claude-sonnet-4-6",
      max_tokens: 512,
    });
    const out = await judge.judge_all([
      {
        query_id: "q-1",
        query_text: "?",
        expected_facts: [],
        reader_answer: "a",
        tier: "T1",
      },
    ]);
    expect(out[0]!.verdict).toBe("CORRECT");
    expect(out[0]!.unjudged_reason).toBeNull();
  });

  test("malformed JSON becomes UNJUDGED", async () => {
    const judge = createLlmJudge({
      provider: fakeProvider([
        {
          custom_id: "reader:q-1",
          status: "succeeded",
          text: "not json",
          error: null,
          cost_usd: 0,
          prompt_tokens: null,
          completion_tokens: null,
        },
      ]),
      model: "claude-sonnet-4-6",
      max_tokens: 512,
    });
    const out = await judge.judge_all([
      {
        query_id: "q-1",
        query_text: "?",
        expected_facts: [],
        reader_answer: "a",
        tier: "T1",
      },
    ]);
    expect(out[0]!.verdict).toBe("UNJUDGED");
    expect(out[0]!.unjudged_reason).toBe("malformed or unparseable judge output");
  });

  test("batch per-request errors become UNJUDGED with the reason", async () => {
    const judge = createLlmJudge({
      provider: fakeProvider([
        {
          custom_id: "reader:q-1",
          status: "errored",
          text: null,
          error: "model overloaded",
          cost_usd: 0,
          prompt_tokens: null,
          completion_tokens: null,
        },
      ]),
      model: "claude-sonnet-4-6",
      max_tokens: 512,
    });
    const out = await judge.judge_all([
      {
        query_id: "q-1",
        query_text: "?",
        expected_facts: [],
        reader_answer: "a",
        tier: "T1",
      },
    ]);
    expect(out[0]!.verdict).toBe("UNJUDGED");
    expect(out[0]!.unjudged_reason).toBe("model overloaded");
  });

  test("accepts JSON wrapped in a ```json fence", async () => {
    const judge = createLlmJudge({
      provider: fakeProvider([
        {
          custom_id: "reader:q-1",
          status: "succeeded",
          text: "```json\n{\"verdict\":\"PARTIAL\",\"rationale\":\"x\"}\n```",
          error: null,
          cost_usd: 0,
          prompt_tokens: null,
          completion_tokens: null,
        },
      ]),
      model: "claude-sonnet-4-6",
      max_tokens: 512,
    });
    const out = await judge.judge_all([
      {
        query_id: "q-1",
        query_text: "?",
        expected_facts: [],
        reader_answer: "a",
        tier: "T1",
      },
    ]);
    expect(out[0]!.verdict).toBe("PARTIAL");
  });
});
