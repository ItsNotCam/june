// author: Claude
import Anthropic from "@anthropic-ai/sdk";
import type { APIError } from "@anthropic-ai/sdk";
import type {
  LlmCallRequest,
  LlmCallResponse,
  LlmProvider,
} from "./types";
import { withRateLimitRetry } from "./retry";
import { costFor, rateFor } from "@/lib/cost";

/**
 * Anthropic sync provider (§24).
 *
 * Uses `@anthropic-ai/sdk`'s `messages.create`. Cost is computed from token
 * counts using the per-model rate table in `src/lib/cost.ts` — the module is
 * the sole source of truth for pricing at run time (§27).
 *
 * Rate-limit handling: 429 and `rate_limit_exceeded` responses trigger the
 * exponential-backoff retry in `./retry.ts`.
 */
export const createAnthropicProvider = (apiKey: string): LlmProvider => {
  const client = new Anthropic({ apiKey });

  const call = async (req: LlmCallRequest): Promise<LlmCallResponse> => {
    return withRateLimitRetry({
      provider: "anthropic",
      isRateLimited: isAnthropicRateLimited,
      run: async () => {
        const started = Date.now();

        const messages = req.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }));

        // Anthropic Messages has no native JSON mode and Claude 4.x rejects
        // assistant-prefill, so when callers ask for JSON we steer via the
        // system prompt instead. The bench's `extractJson` already handles
        // prose-wrapped JSON via a balanced-brace walker.
        const systemFromMessages = req.messages.find((m) => m.role === "system")?.content;
        const baseSystem = req.system ?? systemFromMessages;
        const jsonSystem =
          req.response_format === "json"
            ? "Respond with a single JSON object and nothing else. No prose, no Markdown fences, no explanatory text before or after."
            : null;
        const system = jsonSystem
          ? baseSystem
            ? `${baseSystem}\n\n${jsonSystem}`
            : jsonSystem
          : baseSystem;

        const res = await client.messages.create({
          model: req.model,
          max_tokens: req.max_tokens,
          temperature: req.temperature,
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
            rateFor("anthropic", req.model),
            prompt_tokens,
            completion_tokens,
          ),
          latency_ms: Date.now() - started,
        };
      },
    });
  };

  return { name: "anthropic", call };
};

const isAnthropicRateLimited = (err: unknown): boolean => {
  const apiErr = err as APIError;
  return (
    apiErr?.status === 429 ||
    apiErr?.status === 529 ||
    (typeof apiErr?.error === "object" &&
      apiErr?.error !== null &&
      (apiErr.error as { type?: string }).type === "rate_limit_error")
  );
};

type ContentBlock = { type: string; text?: string };

/**
 * Extracts the concatenated `text` across all `{type: "text"}` blocks in the
 * Messages API response. v1 only asks for text blocks, but the type guard
 * keeps us safe if Anthropic ever returns a `thinking` block alongside —
 * we ignore non-text blocks rather than including them in the response.
 */
const extractTextFromContent = (content: unknown): string => {
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const block of content as ContentBlock[]) {
    if (block.type === "text" && typeof block.text === "string") {
      out += block.text;
    }
  }
  return out;
};
