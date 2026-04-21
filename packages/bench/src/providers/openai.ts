// author: Claude
import OpenAI from "openai";
import type {
  LlmCallRequest,
  LlmCallResponse,
  LlmProvider,
} from "./types";
import { withRateLimitRetry } from "./retry";
import { costFor, rateFor } from "@/lib/cost";

/**
 * OpenAI sync provider (§24).
 *
 * Uses `openai` SDK's `chat.completions.create`. Cost comes from token counts
 * × the per-model rate table — same source-of-truth pattern as the Anthropic
 * provider (`src/lib/cost.ts`).
 *
 * Rate-limit handling: 429 triggers the shared exponential-backoff retry;
 * after five failures the bench aborts the run.
 */
export const createOpenAIProvider = (apiKey: string): LlmProvider => {
  const client = new OpenAI({ apiKey });

  const call = async (req: LlmCallRequest): Promise<LlmCallResponse> => {
    return withRateLimitRetry({
      provider: "openai",
      isRateLimited: isOpenAIRateLimited,
      run: async () => {
        const started = Date.now();

        const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
        if (req.system) messages.push({ role: "system", content: req.system });
        for (const m of req.messages) {
          messages.push({
            role: m.role,
            content: m.content,
          } as OpenAI.Chat.Completions.ChatCompletionMessageParam);
        }

        const params: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
          model: req.model,
          messages,
          max_tokens: req.max_tokens,
          temperature: req.temperature,
        };
        if (req.response_format === "json") {
          params.response_format = { type: "json_object" };
        }

        const res = await client.chat.completions.create(params);
        const text = res.choices[0]?.message?.content ?? "";
        const prompt_tokens = res.usage?.prompt_tokens ?? null;
        const completion_tokens = res.usage?.completion_tokens ?? null;
        return {
          text,
          prompt_tokens,
          completion_tokens,
          cost_usd: costFor(
            rateFor("openai", req.model),
            prompt_tokens,
            completion_tokens,
          ),
          latency_ms: Date.now() - started,
        };
      },
    });
  };

  return { name: "openai", call };
};

const isOpenAIRateLimited = (err: unknown): boolean => {
  const apiErr = err as { status?: number; code?: string };
  return apiErr?.status === 429 || apiErr?.code === "rate_limit_exceeded";
};
