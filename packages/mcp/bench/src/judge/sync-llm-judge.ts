// author: Claude
import type { Judge, JudgeOutcome, JudgeRequest } from "./types";
import type { LlmProvider } from "@/providers/types";
import { renderJudgePrompt, outcomeFromText } from "./llm-judge";
import { mapConcurrent } from "@/lib/concurrency";
import { logger } from "@/lib/logger";

/**
 * Synchronous LLM judge backed by a one-shot provider (deepseek-v4-pro).
 *
 * Exists because deepseek has no Batch API: where `createLlmJudge` submits one
 * batch and polls, this fans the same per-request judge prompts out as bounded
 * concurrent `provider.call()`s. It shares `renderJudgePrompt` and
 * `outcomeFromText` with the batch judge, so verdict prompting and parsing are
 * byte-identical — the gauge difference is only the model + transport. A read-only
 * screen validated deepseek-v4-pro mirrors the Sonnet batch judge (κ=0.894).
 *
 * Unlike the batch judge there is no checkpoint/resume: a re-run re-issues the
 * calls, and `--cache` covers paying twice for unchanged inputs.
 *
 * `temperature` is pinned to 0 (same reproducibility requirement as the batch
 * path); `response_format: "json"` nudges the provider toward a bare verdict object.
 */
export const createSyncLlmJudge = (args: {
  provider: LlmProvider;
  /** Judge model — e.g. `deepseek-v4-pro`. */
  model: string;
  max_tokens: number;
  /** Max in-flight calls (config `roles.judge.concurrency`). */
  concurrency: number;
  /** Prefix tag for logging parity with the batch judge — `"reader"` or `"baseline"`. */
  stream_prefix?: string;
}): Judge => {
  const { provider, model, max_tokens, concurrency } = args;
  const prefix = args.stream_prefix ?? "reader";

  const judge_all = async (requests: JudgeRequest[]): Promise<JudgeOutcome[]> => {
    if (requests.length === 0) return [];
    logger.info("judge.sync.start", {
      provider: provider.name,
      model,
      request_count: requests.length,
      concurrency,
      stream_prefix: prefix,
    });

    const outcomes = await mapConcurrent(requests, concurrency, async (req) => {
      const content = await renderJudgePrompt(req);
      try {
        const res = await provider.call({
          model,
          messages: [{ role: "user", content }],
          max_tokens,
          temperature: 0,
          response_format: "json",
        });
        return outcomeFromText(req.query_id, res.text);
      } catch (err) {
        return outcomeFromText(
          req.query_id,
          null,
          err instanceof Error ? err.message : String(err),
        );
      }
    });

    logger.info("judge.sync.complete", {
      provider: provider.name,
      unjudged: outcomes.filter((o) => o.verdict === "UNJUDGED").length,
    });
    return outcomes;
  };

  return { name: `${provider.name}-sync-llm-judge`, judge_all };
};
