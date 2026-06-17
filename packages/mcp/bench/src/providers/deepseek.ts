// author: Claude
import Anthropic from "@anthropic-ai/sdk";
import type { LlmCallRequest, LlmCallResponse, LlmProvider } from "./types";
import { withRateLimitRetry } from "./retry";
import { costFor, rateFor } from "@/lib/cost";
import {
  composeAnthropicSystem,
  extractTextFromContent,
  isAnthropicRateLimited,
} from "./shared";

/**
 * DeepSeek provider over its Anthropic-compatible Messages endpoint.
 *
 * Identical wire protocol to the Anthropic provider — only the `baseURL` and
 * the disabled thinking block differ. DeepSeek-v4 defaults thinking on; for a
 * deterministic reader we force it off (matching the ingest summarizer
 * `anthropic-compat.ts` decision). Rate-limit handling and JSON steering are
 * shared with the Anthropic provider.
 */

const DEEPSEEK_ANTHROPIC_BASE_URL = "https://api.deepseek.com/anthropic";

export const createDeepseekProvider = (apiKey: string): LlmProvider => {
  const client = new Anthropic({ apiKey, baseURL: DEEPSEEK_ANTHROPIC_BASE_URL });

  const call = async (req: LlmCallRequest): Promise<LlmCallResponse> => {
    return withRateLimitRetry({
      provider: "deepseek",
      isRateLimited: isAnthropicRateLimited,
      run: async () => {
        const started = Date.now();

        const messages = req.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }));

        const systemFromMessages = req.messages.find((m) => m.role === "system")?.content;
        const baseSystem = req.system ?? systemFromMessages;
        const system = composeAnthropicSystem(
          baseSystem,
          req.response_format === "json",
        );

        const res = await client.messages.create({
          model: req.model,
          max_tokens: req.max_tokens,
          temperature: req.temperature,
          thinking: { type: "disabled" },
          system,
          messages,
        });

        const text = extractTextFromContent(res.content);
        const prompt_tokens = res.usage?.input_tokens ?? null;
        const completion_tokens = res.usage?.output_tokens ?? null;
        return {
          text,
          prompt_tokens,
          completion_tokens,
          cost_usd: costFor(
            rateFor("deepseek", req.model),
            prompt_tokens,
            completion_tokens,
          ),
          latency_ms: Date.now() - started,
        };
      },
    });
  };

  return { name: "deepseek", call };
};
