// author: Claude
import type { FactsFile } from "@/types/facts";
import type { QueriesFile, QueryTier } from "@/types/query";
import type { GroundTruthFile } from "@/types/ground-truth";
import type {
  RetrievalResult,
  RetrievalResultsFile,
  RetrievalResultsRecord,
} from "@/types/retrieval";
import type { Retriever } from "@/retriever/types";
import { writeJsonAtomic } from "@/lib/artifacts";
import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";

/**
 * Stage 6 — retrieval evaluation (§20).
 *
 * For every query: ask the retriever once at `max(k_values)`, then compute
 * Recall@K for K ∈ {1,3,5,10}, MRR, and the T5 top-1 score — all from the
 * same top-K list (L11's "no chunk-count gaming" rule is enforced by not
 * re-calling per K).
 *
 * Scoring dispatches on `query.tier`:
 * - T1, T2 — single expected chunk in top-K.
 * - T3 — any expected chunk in top-K.
 * - T4 — all expected chunks in top-K.
 * - T5 — recall undefined; only `t5_top1_score` is recorded.
 */
export const runStage6 = async (args: {
  facts: FactsFile;
  queries: QueriesFile;
  ground_truth: GroundTruthFile;
  retriever: Retriever;
  ingest_run_id: string;
  out_path: string;
}): Promise<RetrievalResultsFile> => {
  const cfg = getConfig();
  const maxK = Math.max(...cfg.retrieval.k_values);

  const factIdToChunkId = new Map<string, string>();
  for (const res of args.ground_truth.resolutions) {
    if (res.chunk_id) factIdToChunkId.set(res.fact_id, res.chunk_id);
  }

  const results: RetrievalResultsRecord[] = [];
  for (const q of args.queries.queries) {
    const top = await args.retriever.retrieve(q.text, maxK);
    const expected = q.expected_fact_ids
      .map((id) => factIdToChunkId.get(id))
      .filter((id): id is string => typeof id === "string");

    results.push({
      query_id: q.id,
      retrieved: top,
      recall_at_k: {
        "1": computeRecall(q.tier, expected, top, 1),
        "3": computeRecall(q.tier, expected, top, 3),
        "5": computeRecall(q.tier, expected, top, 5),
        "10": computeRecall(q.tier, expected, top, 10),
      },
      mrr: computeMrr(q.tier, expected, top),
      t5_top1_score: q.tier === "T5" ? (top[0]?.score ?? null) : null,
    });
  }

  const file: RetrievalResultsFile = {
    fixture_id: args.facts.fixture_id,
    ingest_run_id: args.ingest_run_id,
    retriever_config: {
      adapter: args.retriever.name,
      retrieval_config_snapshot: args.retriever.config_snapshot,
    },
    results,
  };
  await writeJsonAtomic(args.out_path, file);
  logger.info("stage.6.complete", {
    fixture_id: file.fixture_id,
    query_count: results.length,
    adapter: args.retriever.name,
  });
  return file;
};

/**
 * Computes binary per-query recall at K dispatched on tier.
 *
 * T5 queries have no expected chunk — their recall is undefined. The caller
 * should not feed T5 into per-tier recall aggregates (§23 handles this).
 */
export const computeRecall = (
  tier: QueryTier,
  expected_chunk_ids: readonly string[],
  retrieved: readonly RetrievalResult[],
  k: number,
): number => {
  if (tier === "T5") return 0;
  if (expected_chunk_ids.length === 0) return 0;
  const topK = new Set(retrieved.slice(0, k).map((r) => r.chunk_id));
  if (tier === "T4") {
    // all expected chunks must be present
    return expected_chunk_ids.every((id) => topK.has(id)) ? 1 : 0;
  }
  // T1 / T2 / T3: any match suffices
  return expected_chunk_ids.some((id) => topK.has(id)) ? 1 : 0;
};

/**
 * Per-query MRR (§20).
 *
 * - T1/T2/T3 — rank of the earliest expected chunk.
 * - T4 — rank of the *latest* expected chunk (multi-hop bottleneck).
 * - T5 — 0.
 * - No expected chunk in top-K — 0.
 */
export const computeMrr = (
  tier: QueryTier,
  expected_chunk_ids: readonly string[],
  retrieved: readonly RetrievalResult[],
): number => {
  if (tier === "T5" || expected_chunk_ids.length === 0) return 0;
  const rankMap = new Map<string, number>();
  retrieved.forEach((r, i) => {
    if (!rankMap.has(r.chunk_id)) rankMap.set(r.chunk_id, i + 1);
  });

  if (tier === "T4") {
    let latest: number | null = null;
    for (const id of expected_chunk_ids) {
      const rank = rankMap.get(id);
      if (rank === undefined) return 0;
      latest = latest === null ? rank : Math.max(latest, rank);
    }
    return latest === null ? 0 : 1 / latest;
  }

  let best: number | null = null;
  for (const id of expected_chunk_ids) {
    const rank = rankMap.get(id);
    if (rank !== undefined && (best === null || rank < best)) best = rank;
  }
  return best === null ? 0 : 1 / best;
};
