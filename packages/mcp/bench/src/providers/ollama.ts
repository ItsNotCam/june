// author: Claude
import type {
  LlmCallRequest,
  LlmCallResponse,
  LlmProvider,
} from "./types";
import { withRateLimitRetry } from "./retry";
import { costFor, ollamaEnergyCost, rateFor } from "@/lib/cost";

/**
 * Ollama provider (§24).
 *
 * Plain `fetch` against `${OLLAMA_URL}/api/chat`. Cost is always `0`
 * (local inference, no per-token charge). Token counts come from the Ollama
 * response when surfaced (`prompt_eval_count`, `eval_count`) — both `null`
 * for streaming or partial responses.
 *
 * Ollama does not rate-limit per se, but it will queue requests and time
 * out under load. The retry helper catches `HTTP 503 / server overloaded`
 * as rate-limit-equivalents so the bench backs off during saturation.
 */
export const createOllamaProvider = (ollamaUrl: string): LlmProvider => {
  const call = async (req: LlmCallRequest): Promise<LlmCallResponse> => {
    return withRateLimitRetry({
      provider: "ollama",
      isRateLimited: isOllamaRateLimited,
      run: async () => {
        const started = Date.now();
        const body: Record<string, unknown> = {
          model: req.model,
          messages: req.system
            ? [{ role: "system", content: req.system }, ...req.messages]
            : req.messages,
          stream: false,
          options: {
            temperature: req.temperature,
            num_predict: req.max_tokens,
          },
        };
        if (req.response_format === "json") body["format"] = "json";

        const res = await fetch(`${ollamaUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          throw new OllamaHttpError(res.status, await safeText(res));
        }
        const json = (await res.json()) as OllamaChatResponse;
        const latency = Date.now() - started;
        const prompt_tokens = json.prompt_eval_count ?? null;
        const completion_tokens = json.eval_count ?? null;
        return {
          text: json.message?.content ?? "",
          prompt_tokens,
          completion_tokens,
          // Token cost is always $0 for Ollama; the only spend is electricity.
          // `ollamaEnergyCost` returns 0 when the operator hasn't opted into
          // GPU-wattage / $/kWh tracking — silent fallback by design.
          cost_usd:
            costFor(rateFor("ollama", req.model), prompt_tokens, completion_tokens) +
            ollamaEnergyCost(latency),
          latency_ms: latency,
        };
      },
    });
  };

  return { name: "ollama", call };
};

/**
 * Embeds `input` via `POST ${OLLAMA_URL}/api/embed` with the configured model.
 *
 * Stage 5's Tier-2 resolver calls this directly (not through the `LlmProvider`
 * interface) — embedding has a different request/response shape than chat,
 * and widening the interface for one use case is over-engineering.
 *
 * `kind` selects the asymmetric-embedding side:
 *   - `"document"` (default): pass text raw — matches how ingest stores chunks.
 *   - `"query"`: prepend `"query: "` — `snowflake-arctic-embed2` was trained
 *     to expect this prefix on the query side. Without it, the query and
 *     document vectors live in slightly different sub-spaces and dense
 *     retrieval recall drops noticeably.
 */
export const embedViaOllama = async (args: {
  ollamaUrl: string;
  model: string;
  input: string;
  kind?: "query" | "document";
}): Promise<number[]> => {
  const text = args.kind === "query" ? `query: ${args.input}` : args.input;
  const res = await fetch(`${args.ollamaUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: args.model, input: [text] }),
  });
  if (!res.ok) {
    throw new OllamaHttpError(res.status, await safeText(res));
  }
  const json = (await res.json()) as OllamaEmbedResponse;
  const first = json.embeddings?.[0];
  if (!first) throw new Error("Ollama returned an empty embedding response");
  return first;
};

class OllamaHttpError extends Error {
  constructor(
    readonly status: number,
    readonly bodyText: string,
  ) {
    super(`Ollama HTTP ${status}: ${bodyText.slice(0, 200)}`);
    this.name = "OllamaHttpError";
  }
}

const isOllamaRateLimited = (err: unknown): boolean => {
  if (!(err instanceof OllamaHttpError)) return false;
  return err.status === 429 || err.status === 503;
};

const safeText = async (res: Response): Promise<string> => {
  try {
    return await res.text();
  } catch {
    return "";
  }
};

type OllamaChatResponse = {
  message?: { role: string; content: string };
  prompt_eval_count?: number;
  eval_count?: number;
};

type OllamaEmbedResponse = {
  embeddings?: number[][];
};
