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
  /** Called on each poll iteration with elapsed time + batch status — drives live progress. */
  onPoll?: (info: { elapsed_ms: number; status: string }) => void;
}): Judge => {
  const { provider, model, max_tokens, checkpoint_path, resume_batch_id, onPoll } = args;
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

    const resultsUrl = await pollUntilEnded(provider, batch_id, onPoll);
    logger.info("judge.ended", { batch_id });

    const results = await provider.retrieve(resultsUrl);
    return results.map((r) => buildOutcome(r, prefix));
  };

  return { name: "anthropic-batch-llm-judge", judge_all };
};

/**
 * Renders the judge prompt for one request — the SINGLE source of truth for
 * what the judge sees. Both the batch path (`buildBatchRequest`) and the sync
 * deepseek path (`createSyncLlmJudge`) call this so the two judges are graded on
 * byte-identical prompts; the only difference between them is the model + transport.
 */
export const renderJudgePrompt = async (req: JudgeRequest): Promise<string> =>
  renderPrompt("judge", {
    query_tier: req.tier,
    query_text: req.query_text,
    expected_surface_hints_bulleted:
      req.expected_facts.length > 0
        ? req.expected_facts.map((f) => `- ${f.surface_hint}`).join("\n")
        : "- (no expected facts — T5 negative query)",
    reader_answer: req.reader_answer,
    retrieved_context:
      req.retrieved_context.length > 0
        ? req.retrieved_context
        : "(no retrieved context — this is a no-RAG baseline answer)",
  });

const buildBatchRequest = async (
  req: JudgeRequest,
  model: string,
  max_tokens: number,
  prefix: string,
): Promise<BatchSubmitRequest> => {
  const content = await renderJudgePrompt(req);
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
  onPoll?: (info: { elapsed_ms: number; status: string }) => void,
): Promise<string> => {
  const cfg = getConfig().judge;
  const started = Date.now();
  let delay = cfg.poll_initial_ms;

  while (Date.now() - started < cfg.batch_timeout_ms) {
    const status = await provider.poll(batch_id);
    onPoll?.({ elapsed_ms: Date.now() - started, status: status.status });
    if (status.status === "ended") return status.results_url;
    await Bun.sleep(delay);
    delay = Math.min(delay * 2, cfg.poll_max_ms);
  }

  throw new JudgeBatchExpiredError(batch_id);
};

/**
 * Maps a raw judge message (or a failure) to a `JudgeOutcome` — shared by the
 * batch and sync judge paths so verdict parsing is identical across both.
 * `text === null` yields UNJUDGED carrying `errorReason`; unparseable text
 * yields UNJUDGED with the standard malformed reason (L14).
 */
export const outcomeFromText = (
  query_id: string,
  text: string | null,
  errorReason?: string,
): JudgeOutcome => {
  if (text === null) {
    return {
      query_id,
      verdict: "UNJUDGED",
      rationale: "",
      unjudged_reason: errorReason ?? "no judge output",
    };
  }
  const parsed = parseVerdictPayload(text);
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

const buildOutcome = (result: BatchResult, prefix: string): JudgeOutcome => {
  const query_id = result.custom_id.startsWith(`${prefix}_`)
    ? result.custom_id.slice(prefix.length + 1)
    : result.custom_id;

  if (result.status !== "succeeded" || result.text === null) {
    return outcomeFromText(query_id, null, result.error ?? result.status);
  }
  return outcomeFromText(query_id, result.text);
};

/**
 * Extracts the judge's JSON from the model's message text.
 *
 * Accepts plain JSON, a fenced ```json block, or JSON embedded in surrounding
 * prose — judges occasionally prepend a sentence of reasoning before the object
 * even when asked not to. Tries, in order: the whole text, any fenced block,
 * and the widest brace-balanced `{...}` span. Zod-validates each candidate;
 * returns `null` on total failure so Stage 8 maps it to `UNJUDGED` (L14).
 *
 * Exported so the judge golden-set test validates the exact parser production
 * uses, not a re-implementation that could drift.
 */
export const parseVerdictPayload = (text: string): {
  verdict: "CORRECT" | "PARTIAL" | "INCORRECT" | "REFUSED" | "HALLUCINATED";
  rationale: string;
} | null => {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenceMatch && fenceMatch[1]) candidates.push(fenceMatch[1].trim());
  // Widest balanced object — handles "Here is my verdict: {…}" preambles.
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(trimmed.slice(first, last + 1));

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
