// author: Claude
import type { Judge, JudgeOutcome, JudgeRequest } from "./types";
import type {
  BatchLlmProvider,
  BatchSubmitRequest,
  BatchResult,
} from "@/providers/types";
import { JudgeVerdictSchema } from "@/schemas/verdict";
import { JudgeBatchExpiredError } from "@/lib/errors";
import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import { renderPrompt } from "@/lib/prompts";
import { writeJsonAtomic } from "@/lib/artifacts";

/**
 * LLM judge backed by the Anthropic Batch API (§§22, 35, DD-3).
 *
 * Submits one request per judge input as a single batch, polls with
 * exponential backoff (30s → 300s, capped), streams the results JSONL on
 * `ended`, and maps per-request outcomes to verdicts.
 *
 * `judge_all` is the only method on this adapter. Stage 8 invokes it once;
 * everything about async, polling, and parsing is internal to the judge.
 *
 * `checkpoint_path` (optional) is where the adapter persists
 * `batch_submission.json` so a resumed run can re-poll an in-flight batch
 * instead of resubmitting (§32's sub-resume 8b).
 */
export const createLlmJudge = (args: {
  provider: BatchLlmProvider;
  /** Tier-agnostic judge model. v1 default: `claude-sonnet-4-6`. */
  model: string;
  max_tokens: number;
  /** If provided, the judge writes `batch_submission.json` here on submit. */
  checkpoint_path?: string;
  /** When provided, the judge resumes this batch id instead of submitting a new one. */
  resume_batch_id?: string;
  /** Prefix tag for custom_ids — `"reader"` or `"baseline"` per §23. */
  stream_prefix?: string;
}): Judge => {
  const { provider, model, max_tokens, checkpoint_path, resume_batch_id } = args;
  const prefix = args.stream_prefix ?? "reader";

  const judge_all = async (
    requests: JudgeRequest[],
  ): Promise<JudgeOutcome[]> => {
    if (requests.length === 0) return [];

    let batch_id: string;
    if (resume_batch_id) {
      batch_id = resume_batch_id;
      logger.info("judge.resume", { batch_id });
    } else {
      const submitRequests = await Promise.all(
        requests.map(async (r) => buildBatchRequest(r, model, max_tokens, prefix)),
      );
      const res = await provider.submit(submitRequests);
      batch_id = res.batch_id;
      if (checkpoint_path) {
        await writeJsonAtomic(checkpoint_path, {
          batch_id,
          submitted_at: new Date().toISOString(),
          stream_prefix: prefix,
          request_count: requests.length,
        });
      }
      logger.info("judge.submit", {
        batch_id,
        request_count: requests.length,
      });
    }

    const resultsUrl = await pollUntilEnded(provider, batch_id);
    logger.info("judge.ended", { batch_id });

    const results = await provider.retrieve(resultsUrl);
    return results.map((r) => buildOutcome(r, prefix));
  };

  return { name: "anthropic-batch-llm-judge", judge_all };
};

const buildBatchRequest = async (
  req: JudgeRequest,
  model: string,
  max_tokens: number,
  prefix: string,
): Promise<BatchSubmitRequest> => {
  const content = await renderPrompt("judge", {
    query_tier: req.tier,
    query_text: req.query_text,
    expected_surface_hints_bulleted:
      req.expected_facts.length > 0
        ? req.expected_facts
            .map((f) => `- ${f.surface_hint}`)
            .join("\n")
        : "- (no expected facts — T5 negative query)",
    reader_answer: req.reader_answer,
  });
  return {
    // Anthropic Batch API: custom_id must match ^[a-zA-Z0-9_-]{1,64}$.
    // Underscore separator keeps the prefix recoverable on retrieve.
    custom_id: `${prefix}_${req.query_id}`,
    model,
    max_tokens,
    temperature: 0,
    messages: [{ role: "user", content }],
  };
};

/**
 * Polls the batch until `processing_status === "ended"` with exponential
 * backoff starting at `poll_initial_ms`, doubling to `poll_max_ms`, giving
 * up at `batch_timeout_ms` with `JudgeBatchExpiredError` (§26).
 */
const pollUntilEnded = async (
  provider: BatchLlmProvider,
  batch_id: string,
): Promise<string> => {
  const cfg = getConfig().judge;
  const started = Date.now();
  let delay = cfg.poll_initial_ms;

  while (Date.now() - started < cfg.batch_timeout_ms) {
    const status = await provider.poll(batch_id);
    if (status.status === "ended") return status.results_url;
    await Bun.sleep(delay);
    delay = Math.min(delay * 2, cfg.poll_max_ms);
  }

  throw new JudgeBatchExpiredError(batch_id);
};

const buildOutcome = (result: BatchResult, prefix: string): JudgeOutcome => {
  const query_id = result.custom_id.startsWith(`${prefix}_`)
    ? result.custom_id.slice(prefix.length + 1)
    : result.custom_id;

  if (result.status !== "succeeded" || result.text === null) {
    return {
      query_id,
      verdict: "UNJUDGED",
      rationale: "",
      unjudged_reason: result.error ?? result.status,
    };
  }

  const parsed = parseVerdictPayload(result.text);
  if (!parsed) {
    return {
      query_id,
      verdict: "UNJUDGED",
      rationale: "",
      unjudged_reason: "malformed or unparseable judge output",
    };
  }

  return {
    query_id,
    verdict: parsed.verdict,
    rationale: parsed.rationale,
    unjudged_reason: null,
  };
};

/**
 * Extracts the judge's JSON from the model's message text.
 *
 * Accepts plain JSON or a fenced ```json block — judges occasionally wrap
 * their output in a code fence even when asked not to. Zod-validates the
 * extracted object; returns `null` on any failure so Stage 8 maps it to
 * `UNJUDGED` (L14).
 */
const parseVerdictPayload = (text: string): {
  verdict: "CORRECT" | "PARTIAL" | "INCORRECT" | "REFUSED" | "HALLUCINATED";
  rationale: string;
} | null => {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenceMatch && fenceMatch[1]) candidates.push(fenceMatch[1].trim());

  for (const candidate of candidates) {
    try {
      const obj = JSON.parse(candidate);
      const result = JudgeVerdictSchema.safeParse(obj);
      if (result.success) return result.data;
    } catch {
      // fall through to the next candidate
    }
  }
  return null;
};
