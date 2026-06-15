// author: Claude
/**
 * Model catalog for the `/test` per-role pickers.
 *
 * Ollama models are auto-detected at runtime (`/test/api/ollama-models`); Claude
 * and DeepSeek are curated here. Provider `value`s are the backend names
 * (`ollama` / `anthropic` / `deepseek`) used by the ingest summarizer config and
 * the bench `--reader-provider` flag; the `label` is the UI-facing name.
 */

export const PROVIDERS = [
  { value: "ollama", label: "Ollama" },
  { value: "anthropic", label: "Claude" },
  { value: "deepseek", label: "DeepSeek" },
] as const;

export type ProviderValue = (typeof PROVIDERS)[number]["value"];

/** Curated Claude models (most → least capable). */
export const CLAUDE_MODELS = [
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
] as const;

/** Curated DeepSeek v4 models. */
export const DEEPSEEK_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"] as const;

/**
 * Judge (role 4) providers. Distinct from the sync `PROVIDERS` list: the judge
 * runs either as the Anthropic Batch API (Sonnet, system-of-record) or as sync
 * deepseek-v4-pro — no Ollama/OpenAI. `value`s match the bench `--judge-provider`
 * flag and `roles.judge.provider`.
 */
export const JUDGE_PROVIDERS = [
  { value: "deepseek", label: "DeepSeek" },
  { value: "anthropic-batch", label: "Claude (Batch)" },
] as const;

export type JudgeProviderValue = (typeof JUDGE_PROVIDERS)[number]["value"];

/** Selectable judge models for a provider — Claude curated for batch, DeepSeek v4 otherwise. */
export const judgeModelsFor = (provider: JudgeProviderValue): readonly string[] => {
  if (provider === "anthropic-batch") return CLAUDE_MODELS;
  return DEEPSEEK_MODELS;
};

/**
 * Returns the selectable models for a non-ollama provider. Ollama's list is
 * fetched at runtime, so callers handle that case separately.
 */
export const curatedModelsFor = (provider: ProviderValue): readonly string[] => {
  if (provider === "anthropic") return CLAUDE_MODELS;
  if (provider === "deepseek") return DEEPSEEK_MODELS;
  return [];
};
