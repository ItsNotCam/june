// author: Claude
/**
 * The narrow LLM provider interface (§24).
 *
 * One method, one normalized shape. SDK-specific escape hatches (streaming,
 * tool use, Anthropic extended thinking) are deliberately out of scope —
 * v1 doesn't need them and adding them invites drift across providers.
 */

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmCallRequest = {
  model: string;
  messages: LlmMessage[];
  max_tokens: number;
  temperature: number;
  /** Optional system prompt — some providers accept a sibling field for this. */
  system?: string;
  /** When `json`, the provider is asked (and the response is expected) to return JSON. */
  response_format?: "text" | "json";
};

export type LlmCallResponse = {
  text: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  /** USD for this single call — computed from tokens × rate (§27). */
  cost_usd: number;
  latency_ms: number;
};

/**
 * Every concrete provider adheres to this shape. The bench composes these:
 * sync providers serve roles 1/2/3; the Batch provider serves role 4.
 */
export type LlmProvider = {
  name: "ollama" | "anthropic" | "openai";
  call: (req: LlmCallRequest) => Promise<LlmCallResponse>;
};

/**
 * Batch API — a parallel interface (§24).
 *
 * The operational contract is genuinely different (submit → poll → retrieve,
 * not one-shot call), and forcing both under a single shape invites the
 * wrong abstraction. The bench deliberately keeps them distinct.
 */
export type BatchSubmitRequest = {
  custom_id: string;
  messages: Array<{ role: "user"; content: string }>;
  model: string;
  max_tokens: number;
  temperature: number;
  system?: string;
};

export type BatchPollStatus =
  | { status: "in_progress"; results_url: null }
  | { status: "ended"; results_url: string };

export type BatchResult = {
  custom_id: string;
  status: "succeeded" | "errored" | "canceled" | "expired";
  text: string | null;
  error: string | null;
  /** Batch pricing is 50% of sync; callers that meter cost get the full cost_usd inline. */
  cost_usd: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
};

export type BatchLlmProvider = {
  name: "anthropic-batch";
  submit: (requests: BatchSubmitRequest[]) => Promise<{ batch_id: string }>;
  poll: (batchId: string) => Promise<BatchPollStatus>;
  retrieve: (resultsUrl: string) => Promise<BatchResult[]>;
};
