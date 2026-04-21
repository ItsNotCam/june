// author: Claude
import Anthropic from "@anthropic-ai/sdk";
import type { APIError } from "@anthropic-ai/sdk";
import type {
  BatchLlmProvider,
  BatchPollStatus,
  BatchResult,
  BatchSubmitRequest,
} from "./types";
import { withRateLimitRetry } from "./retry";
import { costFor, rateFor } from "@/lib/cost";

/**
 * Anthropic Batch API provider (§24, §26).
 *
 * The judge is always Batch (DD-3). Three methods:
 *
 * - `submit(requests)` — `POST /v1/messages/batches`. Anthropic accepts up to
 *   10,000 requests per batch; bench v1's hard N=500 ceiling guarantees a
 *   single batch suffices.
 * - `poll(batch_id)` — `GET /v1/messages/batches/{id}`. Returns `in_progress`
 *   or `ended` with a `results_url`.
 * - `retrieve(url)` — streams the results JSONL and decodes one `BatchResult`
 *   per line, routed back to the originating query via `custom_id`.
 *
 * Per-request outcomes (`succeeded` / `errored` / `canceled` / `expired`) are
 * preserved as-is; Stage 8 maps failures to `UNJUDGED`.
 */
export const createAnthropicBatchProvider = (
  apiKey: string,
): BatchLlmProvider => {
  const client = new Anthropic({ apiKey });

  const submit = async (
    requests: BatchSubmitRequest[],
  ): Promise<{ batch_id: string }> => {
    return withRateLimitRetry({
      provider: "anthropic-batch",
      isRateLimited: isAnthropicRateLimited,
      run: async () => {
        const batchRequests = requests.map((r) => ({
          custom_id: r.custom_id,
          params: {
            model: r.model,
            max_tokens: r.max_tokens,
            temperature: r.temperature,
            system: r.system,
            messages: r.messages,
          },
        }));

        const res = await client.messages.batches.create({
          requests: batchRequests as Parameters<
            typeof client.messages.batches.create
          >[0]["requests"],
        });
        return { batch_id: res.id };
      },
    });
  };

  const poll = async (batchId: string): Promise<BatchPollStatus> => {
    return withRateLimitRetry({
      provider: "anthropic-batch",
      isRateLimited: isAnthropicRateLimited,
      run: async () => {
        const res = await client.messages.batches.retrieve(batchId);
        if (res.processing_status === "ended" && res.results_url) {
          return { status: "ended", results_url: res.results_url };
        }
        return { status: "in_progress", results_url: null };
      },
    });
  };

  const retrieve = async (resultsUrl: string): Promise<BatchResult[]> => {
    const res = await fetch(resultsUrl, {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });
    if (!res.ok) {
      throw new Error(
        `Batch results fetch failed: HTTP ${res.status} ${await safeText(res)}`,
      );
    }
    const body = await res.text();
    const lines = body.split("\n").filter((l) => l.trim().length > 0);
    const out: BatchResult[] = [];
    for (const line of lines) {
      out.push(parseBatchResultLine(line));
    }
    return out;
  };

  return { name: "anthropic-batch", submit, poll, retrieve };
};

/**
 * Parses a single JSONL line from a Batch results URL and normalizes it into
 * `BatchResult`.
 *
 * The Messages API's `content` array is an array of blocks; the judge returns
 * one `{type: "text"}` block whose `text` holds the JSON verdict. Non-text
 * blocks are ignored — Stage 8 then JSON-parses the extracted text.
 */
const parseBatchResultLine = (line: string): BatchResult => {
  const parsed = JSON.parse(line) as BatchLine;
  const { custom_id, result } = parsed;
  const empty = {
    cost_usd: 0,
    prompt_tokens: null,
    completion_tokens: null,
  };
  if (result.type === "succeeded") {
    const text = extractText(result.message?.content);
    const prompt_tokens = result.message?.usage?.input_tokens ?? null;
    const completion_tokens = result.message?.usage?.output_tokens ?? null;
    const model = result.message?.model ?? "unknown";
    return {
      custom_id,
      status: "succeeded",
      text,
      error: null,
      cost_usd: costFor(
        rateFor("anthropic-batch", model),
        prompt_tokens,
        completion_tokens,
      ),
      prompt_tokens,
      completion_tokens,
    };
  }
  if (result.type === "errored") {
    return {
      custom_id,
      status: "errored",
      text: null,
      error: result.error?.message ?? "unspecified error",
      ...empty,
    };
  }
  return {
    custom_id,
    status: result.type,
    text: null,
    error: null,
    ...empty,
  };
};

type BatchLine = {
  custom_id: string;
  result:
    | {
        type: "succeeded";
        message?: {
          content?: Array<{ type: string; text?: string }>;
          model?: string;
          usage?: { input_tokens?: number; output_tokens?: number };
        };
      }
    | { type: "errored"; error?: { message?: string } }
    | { type: "canceled" }
    | { type: "expired" };
};

const extractText = (content: unknown): string => {
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const block of content as Array<{ type: string; text?: string }>) {
    if (block.type === "text" && typeof block.text === "string") {
      out += block.text;
    }
  }
  return out;
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

const safeText = async (res: Response): Promise<string> => {
  try {
    return await res.text();
  } catch {
    return "";
  }
};
