// author: Claude
import { join } from "path";
import type { QueriesFile } from "@/types/query";
import type { RetrievalResultsFile } from "@/types/retrieval";
import type { IngestManifestFile } from "@/types/ingest";
import type {
  BaselineAnswersFile,
  ReaderAnswer,
  ReaderAnswersFile,
} from "@/types/reader";
import type { LlmProvider } from "@/providers/types";
import { openJuneDatabase } from "@/lib/sqlite";
import { writeJsonAtomic } from "@/lib/artifacts";
import { renderPrompt } from "@/lib/prompts";
import { mapConcurrent } from "@/lib/concurrency";
import { BudgetMeter } from "@/lib/cost";
import { logger } from "@/lib/logger";
import { getConfig } from "@/lib/config";

/**
 * Stage 7 — reader evaluation (§21).
 *
 * Feeds the top-K retrieved chunks + the query to the reader model. Uses the
 * **raw chunk content** from `chunks.raw_content` (Option B per Q3) — not
 * mcp's embed-text (which is a different field and is not surfaced at read
 * time). Chunks are rendered as `<chunk id="…">...</chunk>` blocks,
 * concatenated in the retriever's ranked order.
 *
 * Temperature is locked to `0` at the call site regardless of role
 * configuration; a nonzero value in `config.yaml` trips a warning at
 * config load (L8).
 *
 * Optional: when `baseline.no_rag_opus` is enabled, a sibling pass runs
 * against the baseline model with an **empty `<context>` block** (§23). That
 * is the whole point — it measures what the model knows without retrieval.
 */
export const runStage7 = async (args: {
  fixture_id: string;
  queries: QueriesFile;
  retrieval: RetrievalResultsFile;
  ingest: IngestManifestFile;
  reader_provider: LlmProvider;
  reader_model: string;
  reader_max_tokens: number;
  reader_temperature: number;
  reader_concurrency: number;
  baseline_provider: LlmProvider | null;
  baseline_model: string | null;
  baseline_max_tokens: number | null;
  budget: BudgetMeter;
  out_path: string;
  baseline_out_path: string | null;
}): Promise<{
  reader: ReaderAnswersFile;
  baseline: BaselineAnswersFile | null;
}> => {
  const cfg = getConfig();
  const db = openJuneDatabase(join(args.ingest.scratch_path, "june.db"));
  const topK = cfg.reader_eval.k;

  try {
    const readerAnswers = await mapConcurrent(
      args.queries.queries,
      args.reader_concurrency,
      async (q) => {
        const retrievedRecord = args.retrieval.results.find(
          (r) => r.query_id === q.id,
        );
        const chunkIds = (retrievedRecord?.retrieved ?? [])
          .slice(0, topK)
          .map((r) => r.chunk_id);
        const rendered = renderChunks(db, chunkIds);
        const prompt = await renderPrompt("reader", {
          chunks_rendered_as_chunk_tags: rendered,
          query_text: q.text,
        });
        return callReader({
          provider: args.reader_provider,
          model: args.reader_model,
          max_tokens: args.reader_max_tokens,
          temperature: args.reader_temperature,
          prompt,
          query_id: q.id,
          retrieved_chunk_ids: chunkIds,
          budget: args.budget,
          role: "role_3",
        });
      },
    );

    const reader: ReaderAnswersFile = {
      fixture_id: args.fixture_id,
      reader: {
        provider: args.reader_provider.name,
        model: args.reader_model,
        temperature: args.reader_temperature,
      },
      answers: readerAnswers,
    };
    await writeJsonAtomic(args.out_path, reader);

    let baseline: BaselineAnswersFile | null = null;
    if (
      args.baseline_provider &&
      args.baseline_model &&
      args.baseline_max_tokens &&
      args.baseline_out_path
    ) {
      const emptyContext = "";
      const baselineAnswers = await mapConcurrent(
        args.queries.queries,
        args.reader_concurrency,
        async (q) => {
          const prompt = await renderPrompt("reader", {
            chunks_rendered_as_chunk_tags: emptyContext,
            query_text: q.text,
          });
          return callReader({
            provider: args.baseline_provider!,
            model: args.baseline_model!,
            max_tokens: args.baseline_max_tokens!,
            temperature: 0,
            prompt,
            query_id: q.id,
            retrieved_chunk_ids: [],
            budget: args.budget,
            role: "role_3",
          });
        },
      );
      baseline = {
        fixture_id: args.fixture_id,
        baseline: {
          provider: args.baseline_provider.name,
          model: args.baseline_model,
          temperature: 0,
        },
        answers: baselineAnswers,
      };
      await writeJsonAtomic(args.baseline_out_path, baseline);
    }

    logger.info("stage.7.complete", {
      fixture_id: args.fixture_id,
      reader_answers: readerAnswers.length,
      baseline_answers: baseline?.answers.length ?? 0,
    });

    return { reader, baseline };
  } finally {
    db.close();
  }
};

const callReader = async (args: {
  provider: LlmProvider;
  model: string;
  max_tokens: number;
  temperature: number;
  prompt: string;
  query_id: string;
  retrieved_chunk_ids: string[];
  budget: BudgetMeter;
  role: "role_3";
}): Promise<ReaderAnswer> => {
  const res = await args.provider.call({
    model: args.model,
    messages: [{ role: "user", content: args.prompt }],
    max_tokens: args.max_tokens,
    temperature: args.temperature,
    // Reader is verbatim-extraction; chain-of-thought eats num_predict on
    // thinking-enabled Ollama models (gemma4, qwen3) and produces empty
    // `message.content`. Honored only by providers that expose the toggle.
    disable_thinking: true,
  });
  args.budget.record(args.role, res.cost_usd);
  return {
    query_id: args.query_id,
    answer_text: res.text,
    retrieved_chunk_ids: args.retrieved_chunk_ids,
    latency_ms: res.latency_ms,
    prompt_tokens: res.prompt_tokens,
    completion_tokens: res.completion_tokens,
  };
};

const renderChunks = (
  db: import("bun:sqlite").Database,
  chunkIds: readonly string[],
): string => {
  if (chunkIds.length === 0) return "";
  const stmt = db.query<{ chunk_id: string; raw_content: string }, [string]>(
    `SELECT chunk_id, raw_content FROM chunks WHERE chunk_id = ?`,
  );
  const parts: string[] = [];
  for (const id of chunkIds) {
    const row = stmt.get(id);
    if (!row) continue;
    parts.push(
      `<chunk id="${row.chunk_id}">\n${row.raw_content}\n</chunk>`,
    );
  }
  return parts.join("\n\n");
};
