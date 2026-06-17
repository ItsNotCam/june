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
import { BASELINE_QUERY_PREFIX } from "@/types/judge";
import type { JudgeTask, JudgeTasksFile } from "@/types/judge-tasks";
import type { BatchLlmProvider, LlmProvider } from "@/providers/types";
import type { Judge, JudgeRequest } from "@/judge/types";
import { createLlmJudge } from "@/judge/llm-judge";
import { createSyncLlmJudge } from "@/judge/sync-llm-judge";
import { writeJsonAtomic } from "@/lib/artifacts";
import { promptTemplateHash } from "@/lib/prompts";
import { JudgeIntegrityError } from "@/lib/errors";
import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import { join } from "path";
import { openJuneDatabase, renderChunksById } from "@/lib/sqlite";
import type { Database } from "bun:sqlite";
import type { ReaderAnswer } from "@/types/reader";

/**
 * Stage 8 — judging (§22).
 *
 * Builds one `JudgeRequest` per reader answer (+ per baseline answer if the
 * sibling pass ran), then judges via the selected provider: `anthropic-batch`
 * submits a single batch (v1's N=500 ceiling fits under Anthropic's 10k/batch
 * limit), polls, retrieves; `deepseek` fans the same prompts out as bounded
 * concurrent sync calls. Both route per query back to the originating answer.
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
  /**
   * Resolved judge selection. `anthropic-batch` uses the Batch API (Sonnet,
   * system-of-record); `deepseek` uses concurrent sync calls (deepseek-v4-pro).
   * `checkpoint_path`/`resume_batch_id` apply to the batch path only.
   */
  judge: {
    providerName: "anthropic-batch" | "deepseek";
    batchProvider: BatchLlmProvider;
    syncProvider: LlmProvider | null;
    model: string;
    max_tokens: number;
    concurrency: number;
  };
  checkpoint_path: string;
  resume_batch_id: string | undefined;
  out_path: string;
  /** Called on each batch poll with elapsed time + status — drives live progress (batch path only). */
  onPoll?: (info: { elapsed_ms: number; status: string }) => void;
  /** Scratch dir holding june.db — the judge hydrates retrieved chunk text from it for grounding. */
  scratch_path: string;
}): Promise<JudgeResultsFile> => {
  const cfg = getConfig();
  const factById = new Map(args.facts.facts.map((f) => [f.id, f]));
  const queryById = new Map(args.queries.queries.map((q) => [q.id, q]));

  const db = openJuneDatabase(join(args.scratch_path, "june.db"));
  let readerRequests: JudgeRequest[];
  let baselineRequests: JudgeRequest[] | null = null;
  try {
    readerRequests = buildRequests(args.reader.answers, queryById, factById, db);
    if (args.baseline) {
      baselineRequests = buildRequests(
        args.baseline.answers,
        queryById,
        factById,
        db,
      );
    }
  } finally {
    db.close();
  }

  const isBatch = args.judge.providerName === "anthropic-batch";

  // Build a Judge for one stream. The batch path keeps checkpoint/resume; the
  // sync path has no batch to resume, so it ignores those.
  const makeJudge = (
    stream_prefix: "reader" | "baseline",
    resume: { checkpoint_path?: string; resume_batch_id?: string } = {},
  ): Judge => {
    if (isBatch) {
      return createLlmJudge({
        provider: args.judge.batchProvider,
        model: args.judge.model,
        max_tokens: args.judge.max_tokens,
        checkpoint_path: resume.checkpoint_path,
        resume_batch_id: resume.resume_batch_id,
        stream_prefix,
        onPoll: args.onPoll,
      });
    }
    if (!args.judge.syncProvider) {
      throw new Error(
        `Judge provider '${args.judge.providerName}' selected but its sync provider is unavailable (is DEEPSEEK_API_KEY set?)`,
      );
    }
    return createSyncLlmJudge({
      provider: args.judge.syncProvider,
      model: args.judge.model,
      max_tokens: args.judge.max_tokens,
      concurrency: args.judge.concurrency,
      stream_prefix,
    });
  };

  const readerJudge = makeJudge("reader", {
    checkpoint_path: args.checkpoint_path,
    resume_batch_id: args.resume_batch_id,
  });
  const readerOutcomes = await readerJudge.judge_all(readerRequests);

  let baselineOutcomes: Awaited<ReturnType<Judge["judge_all"]>> = [];
  if (args.baseline && baselineRequests) {
    const baselineJudge = makeJudge("baseline");
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
      provider: args.judge.providerName,
      model: args.judge.model,
      batch_api: isBatch,
    },
    // Sync judging has no batch to track — only record it for the batch path.
    ...(isBatch
      ? {
          batch: {
            batch_id: args.resume_batch_id ?? "batch-submitted",
            submitted_at: submittedAt,
            retrieved_at: new Date().toISOString(),
          },
        }
      : {}),
    verdicts: [
      ...readerVerdicts,
      ...baselineOutcomes.map((o) => ({
        query_id: `${BASELINE_QUERY_PREFIX}${o.query_id}`,
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

/**
 * Stage 8 (external judge path) — emit `judge_tasks.json`, call NO LLM.
 *
 * The no-API architecture: instead of judging in-process, the bench writes a
 * self-contained task per reader answer (+ per baseline answer) and halts. The
 * Claude Code RSI orchestrator's Sonnet sub-agents grade these and write
 * `verdicts.json`, which `june-eval score` then ingests. Reuses the same
 * `buildRequests` (so the task's `retrieved_context` is byte-identical to what
 * the in-bench judge would have seen) and stamps the judge prompt's hash so the
 * regression gate can refuse cross-prompt comparisons. Baseline tasks carry the
 * `BASELINE_QUERY_PREFIX` so Stage 9 splits the streams.
 */
export const buildJudgeTasks = async (args: {
  facts: FactsFile;
  queries: QueriesFile;
  reader: ReaderAnswersFile;
  baseline: BaselineAnswersFile | null;
  run_id: string;
  /** Scratch dir holding june.db — chunk text is hydrated from it for grounding. */
  scratch_path: string;
  out_path: string;
}): Promise<JudgeTasksFile> => {
  const factById = new Map(args.facts.facts.map((f) => [f.id, f]));
  const queryById = new Map(args.queries.queries.map((q) => [q.id, q]));

  const db = openJuneDatabase(join(args.scratch_path, "june.db"));
  let tasks: JudgeTask[];
  try {
    const readerTasks = buildRequests(
      args.reader.answers,
      queryById,
      factById,
      db,
    ).map((r): JudgeTask => ({ ...r, is_baseline: false }));
    const baselineTasks = args.baseline
      ? buildRequests(args.baseline.answers, queryById, factById, db).map(
          (r): JudgeTask => ({
            ...r,
            query_id: `${BASELINE_QUERY_PREFIX}${r.query_id}`,
            is_baseline: true,
          }),
        )
      : [];
    tasks = [...readerTasks, ...baselineTasks];
  } finally {
    db.close();
  }

  const file: JudgeTasksFile = {
    fixture_id: args.facts.fixture_id,
    run_id: args.run_id,
    schema_version: 1,
    prompt_template: "judge",
    prompt_template_hash: await promptTemplateHash("judge"),
    tasks,
  };
  await writeJsonAtomic(args.out_path, file);

  logger.info("stage.8.tasks_emitted", {
    fixture_id: args.facts.fixture_id,
    run_id: args.run_id,
    reader_tasks: args.reader.answers.length,
    baseline_tasks: args.baseline?.answers.length ?? 0,
    out_path: args.out_path,
  });
  return file;
};

const buildRequests = (
  answers: readonly ReaderAnswer[],
  queryById: Map<string, QueriesFile["queries"][number]>,
  factById: Map<string, FactsFile["facts"][number]>,
  db: Database,
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
      // Same chunk text the reader saw — empty for the no-RAG baseline pass,
      // whose answers carry no retrieved_chunk_ids.
      retrieved_context: renderChunksById(db, answer.retrieved_chunk_ids),
    });
  }
  return out;
};
