// author: Claude
import { beforeAll, describe, expect, test } from "bun:test";
import type { LlmCallRequest, LlmCallResponse, LlmProvider } from "@/providers/types";
import { createSyncLlmJudge } from "@/judge/sync-llm-judge";
import type { JudgeRequest } from "@/judge/types";
import { loadTestConfig } from "../helpers";

/**
 * In-process fake `LlmProvider` for the sync judge. `respond` maps a request to
 * either a verdict string or a thrown error, so each test pins exactly what the
 * model "returns" — no SDK, no network.
 */
const fakeProvider = (respond: (req: LlmCallRequest) => string): LlmProvider => ({
  name: "deepseek",
  call: async (req: LlmCallRequest): Promise<LlmCallResponse> => ({
    text: respond(req),
    prompt_tokens: null,
    completion_tokens: null,
    cost_usd: 0,
    latency_ms: 1,
  }),
});

const req = (query_id: string): JudgeRequest => ({
  query_id,
  query_text: "?",
  expected_facts: [],
  reader_answer: "a",
  tier: "T1",
  retrieved_context: "",
});

describe("SyncLLMJudge — deepseek sync path mirrors the batch judge contract", () => {
  beforeAll(async () => {
    await loadTestConfig();
  });

  test("valid JSON verdict parses", async () => {
    const judge = createSyncLlmJudge({
      provider: fakeProvider(() => JSON.stringify({ verdict: "CORRECT", rationale: "ok" })),
      model: "deepseek-v4-pro",
      max_tokens: 512,
      concurrency: 4,
    });
    const out = await judge.judge_all([req("q-1")]);
    expect(out[0]!.verdict).toBe("CORRECT");
    expect(out[0]!.unjudged_reason).toBeNull();
  });

  test("malformed output becomes UNJUDGED", async () => {
    const judge = createSyncLlmJudge({
      provider: fakeProvider(() => "not json"),
      model: "deepseek-v4-pro",
      max_tokens: 512,
      concurrency: 4,
    });
    const out = await judge.judge_all([req("q-1")]);
    expect(out[0]!.verdict).toBe("UNJUDGED");
    expect(out[0]!.unjudged_reason).toBe("malformed or unparseable judge output");
  });

  test("a thrown provider error becomes UNJUDGED with the reason", async () => {
    const judge = createSyncLlmJudge({
      provider: fakeProvider(() => {
        throw new Error("model overloaded");
      }),
      model: "deepseek-v4-pro",
      max_tokens: 512,
      concurrency: 4,
    });
    const out = await judge.judge_all([req("q-1")]);
    expect(out[0]!.verdict).toBe("UNJUDGED");
    expect(out[0]!.unjudged_reason).toBe("model overloaded");
  });

  test("accepts JSON wrapped in a ```json fence", async () => {
    const judge = createSyncLlmJudge({
      provider: fakeProvider(() => '```json\n{"verdict":"PARTIAL","rationale":"x"}\n```'),
      model: "deepseek-v4-pro",
      max_tokens: 512,
      concurrency: 4,
    });
    const out = await judge.judge_all([req("q-1")]);
    expect(out[0]!.verdict).toBe("PARTIAL");
  });

  test("preserves per-query order across concurrent calls", async () => {
    // mapConcurrent must keep output aligned to input even when calls race; the
    // outcome's query_id comes from the request, so order is the real assertion.
    const judge = createSyncLlmJudge({
      provider: fakeProvider(() => JSON.stringify({ verdict: "CORRECT", rationale: "ok" })),
      model: "deepseek-v4-pro",
      max_tokens: 512,
      concurrency: 4,
    });
    const ids = ["q-1", "q-2", "q-3", "q-4", "q-5"];
    const out = await judge.judge_all(ids.map(req));
    expect(out.map((o) => o.query_id)).toEqual(ids);
  });

  test("empty input returns no outcomes", async () => {
    const judge = createSyncLlmJudge({
      provider: fakeProvider(() => "{}"),
      model: "deepseek-v4-pro",
      max_tokens: 512,
      concurrency: 4,
    });
    expect(await judge.judge_all([])).toEqual([]);
  });
});
