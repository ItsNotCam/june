// author: Claude
import type { FactsFile } from "@/types/facts";
import type { QueriesFile } from "@/types/query";
import type {
  BaselineAnswersFile,
  ReaderAnswersFile,
} from "@/types/reader";
import type {
  JudgeResultsFile,
  VerdictRecord,
} from "@/types/judge";
import type { BatchLlmProvider } from "@/providers/types";
import type { Judge, JudgeRequest } from "@/judge/types";
import { createLlmJudge } from "@/judge/llm-judge";
import { writeJsonAtomic } from "@/lib/artifacts";
import { JudgeIntegrityError } from "@/lib/errors";
import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";

/**
 * Stage 8 — judging via Anthropic Batch API (§22).
 *
 * Builds one `JudgeRequest` per reader answer (+ per baseline answer if the
 * sibling pass ran), submits as a single batch (v1's N=500 ceiling fits
 * under Anthropic's 10k/batch limit), polls, retrieves, and routes per
 * `custom_id` back to the originating query.
 *
 * UNJUDGED cap (§22): if more than `config.judge.max_unjudged_pct` of the
 * reader verdicts are `UNJUDGED` (malformed JSON, batch error, expired),
 * the stage exits with `JudgeIntegrityError` (exit 3). Stage 9 writes a stub
 * `results.json` with `run_status: "aborted_integrity_judge"`.
 *
 * `checkpoint_path` is the file the judge persists its `batch_id` to on
 * submit — §32's sub-resume 8b reads this to avoid paying twice.
 */
export const runStage8 = async (args: {
  facts: FactsFile;
  queries: QueriesFile;
  reader: ReaderAnswersFile;
  baseline: BaselineAnswersFile | null;
  provider: BatchLlmProvider;
  model: string;
  max_tokens: number;
  checkpoint_path: string;
  resume_batch_id: string | undefined;
  out_path: string;
}): Promise<JudgeResultsFile> => {
  const cfg = getConfig();
  const factById = new Map(args.facts.facts.map((f) => [f.id, f]));
  const queryById = new Map(args.queries.queries.map((q) => [q.id, q]));

  const readerRequests = buildRequests(args.reader.answers, queryById, factById);

  const readerJudge: Judge = createLlmJudge({
    provider: args.provider,
    model: args.model,
    max_tokens: args.max_tokens,
    checkpoint_path: args.checkpoint_path,
    resume_batch_id: args.resume_batch_id,
    stream_prefix: "reader",
  });
  const readerOutcomes = await readerJudge.judge_all(readerRequests);

  let baselineOutcomes: Awaited<ReturnType<Judge["judge_all"]>> = [];
  if (args.baseline) {
    const baselineRequests = buildRequests(
      args.baseline.answers,
      queryById,
      factById,
    );
    const baselineJudge: Judge = createLlmJudge({
      provider: args.provider,
      model: args.model,
      max_tokens: args.max_tokens,
      stream_prefix: "baseline",
    });
    baselineOutcomes = await baselineJudge.judge_all(baselineRequests);
  }

  const readerVerdicts: VerdictRecord[] = readerOutcomes.map((o) => ({
    query_id: o.query_id,
    verdict: o.verdict,
    rationale: o.rationale,
    unjudged_reason: o.unjudged_reason,
  }));

  const submittedAt =
    args.resume_batch_id === undefined
      ? new Date().toISOString()
      : "resumed";

  const file: JudgeResultsFile = {
    fixture_id: args.facts.fixture_id,
    judge: {
      provider: "anthropic-batch",
      model: args.model,
      batch_api: true,
    },
    batch: {
      batch_id: args.resume_batch_id ?? "batch-submitted",
      submitted_at: submittedAt,
      retrieved_at: new Date().toISOString(),
    },
    verdicts: [
      ...readerVerdicts,
      ...baselineOutcomes.map((o) => ({
        query_id: `baseline_${o.query_id}`,
        verdict: o.verdict,
        rationale: o.rationale,
        unjudged_reason: o.unjudged_reason,
      })),
    ],
  };
  await writeJsonAtomic(args.out_path, file);

  const totalReader = readerVerdicts.length;
  const unjudged = readerVerdicts.filter((v) => v.verdict === "UNJUDGED").length;
  const unjudged_pct = totalReader === 0 ? 0 : unjudged / totalReader;

  logger.info("stage.8.complete", {
    fixture_id: args.facts.fixture_id,
    reader_verdicts: totalReader,
    baseline_verdicts: baselineOutcomes.length,
    unjudged,
    unjudged_pct,
  });

  if (unjudged_pct > cfg.judge.max_unjudged_pct) {
    throw new JudgeIntegrityError(
      `UNJUDGED rate ${(unjudged_pct * 100).toFixed(2)}% exceeds cap ${(cfg.judge.max_unjudged_pct * 100).toFixed(2)}%`,
      unjudged_pct,
      cfg.judge.max_unjudged_pct,
    );
  }

  return file;
};

const buildRequests = (
  answers: readonly { query_id: string; answer_text: string }[],
  queryById: Map<string, QueriesFile["queries"][number]>,
  factById: Map<string, FactsFile["facts"][number]>,
): JudgeRequest[] => {
  const out: JudgeRequest[] = [];
  for (const answer of answers) {
    const q = queryById.get(answer.query_id);
    if (!q) continue;
    const expected = q.expected_fact_ids
      .map((id) => factById.get(id))
      .filter((f): f is NonNullable<typeof f> => f !== undefined)
      .map((f) => ({ surface_hint: f.surface_hint }));
    out.push({
      query_id: q.id,
      query_text: q.text,
      expected_facts: expected,
      reader_answer: answer.answer_text,
      tier: q.tier,
    });
  }
  return out;
};
