// author: Claude
import type { APIError } from "@anthropic-ai/sdk";

/**
 * Steering system prompt appended when a caller requests JSON output (§24).
 *
 * The Anthropic Messages API has no native JSON mode and Claude 4.x rejects
 * assistant-prefill, so the Anthropic-compatible providers (Anthropic + the
 * DeepSeek Anthropic endpoint) nudge the model with this instruction instead.
 * The bench's `extractJson` walker tolerates prose-wrapped JSON regardless.
 */
export const JSON_SYSTEM_PROMPT =
  "Respond with a single JSON object and nothing else. No prose, no Markdown fences, no explanatory text before or after.";

/** HTTP 429 — the canonical rate-limit signal across every provider. */
export const HTTP_TOO_MANY_REQUESTS = 429;
/** HTTP 503 — Ollama surfaces this when the local server is saturated. */
export const HTTP_SERVICE_UNAVAILABLE = 503;
/** HTTP 529 — Anthropic's "overloaded" status, treated as rate-limited. */
export const ANTHROPIC_OVERLOADED = 529;

/**
 * Composes the final `system` prompt for an Anthropic-compatible request.
 *
 * Folds an optional caller-supplied base system together with the JSON
 * steering instruction when `wantsJson` — kept here so the Anthropic and
 * DeepSeek providers stay byte-identical on this contract.
 */
export const composeAnthropicSystem = (
  baseSystem: string | undefined,
  wantsJson: boolean,
): string | undefined => {
  if (!wantsJson) return baseSystem;
  if (!baseSystem) return JSON_SYSTEM_PROMPT;
  return `${baseSystem}\n\n${JSON_SYSTEM_PROMPT}`;
};

/** Narrows an unknown thrown value to the Anthropic SDK's `APIError` shape. */
const isApiError = (err: unknown): err is APIError =>
  typeof err === "object" && err !== null;

/**
 * Detects an Anthropic-compatible rate-limit error (429, 529, or a
 * `rate_limit_error` body). Shared by the Anthropic, DeepSeek, and
 * Anthropic-batch providers — they all speak the same wire protocol.
 */
export const isAnthropicRateLimited = (err: unknown): boolean => {
  if (!isApiError(err)) return false;
  const status = err.status;
  if (status === HTTP_TOO_MANY_REQUESTS || status === ANTHROPIC_OVERLOADED) {
    return true;
  }
  const body = err.error;
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { type?: string }).type === "rate_limit_error"
  );
};

/**
 * Extracts the concatenated `text` across all `{type: "text"}` blocks in a
 * Messages API `content` array. Non-text blocks (e.g. `thinking`) are skipped
 * rather than included — the bench only ever asks for text output.
 */
export const extractTextFromContent = (content: unknown): string => {
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as { type?: string }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      out += (block as { text: string }).text;
    }
  }
  return out;
};

/** Reads a Response body as text, swallowing decode errors into `""`. */
export const safeText = async (res: Response): Promise<string> => {
  try {
    return await res.text();
  } catch {
    return "";
  }
};
