// author: Claude
import type { Retriever } from "./types";
import type { RetrievalResult } from "@/types/retrieval";
import { bm25Vectorize } from "./bm25";
import { qdrantQuery } from "./qdrant";
import { reciprocalRankFusion } from "./rrf";
import { embedViaOllama } from "@/providers/ollama";
import { getConfig } from "@/lib/config";
import { getEnv } from "@/lib/env";

/**
 * ⚠️ STOPGAP — NOT THE REAL RETRIEVER. ⚠️
 *
 * This is a temporary stand-in (Appendix E) that talks to Qdrant directly
 * because june does not yet expose a retrieval API. It is NOT june's production
 * retrieval path and must not be treated as one. When june ships a real
 * retrieval API this file is replaced by `june-api.ts` and DELETED — the bench
 * should then exercise june's own retriever, not a bench-local reimplementation.
 * Any retrieval semantics that matter (filtering, fusion, ranking, reranking)
 * ultimately belong in june, mirrored here only as long as this stopgap lives.
 *
 * Queries every configured alias (typically `internal` + `external`) for
 * both modalities in parallel, unions the per-alias results, then fuses
 * dense + sparse via RRF.
 *
 * `ingestRunId` scoping is LOAD-BEARING: the bench shares one Qdrant collection
 * across every run, each run appends a fresh set of points (`version` is a
 * timestamp, so chunk_ids never collide), and the sidecar-driven `is_latest`
 * flip can't reach prior runs' points — so the collection accumulates ~N runs of
 * stale near-duplicates and ALL of them read `is_latest=true`. Without filtering
 * to this run's `ingested_by`, retrieval searches the entire pile and recall is
 * meaningless. The real june retriever will instead scope by `is_latest=true`
 * (production semantics); that's NOT viable here because the flip is broken in
 * the multi-run/shared-collection bench setup, hence `ingested_by`. See
 * `CLAUDE.md` (§"The bench is a gauge").
 *
 * One call per query — the max K the bench needs (from
 * `config.retrieval.k_values`) is asked up front and all recall@K values are
 * computed from the one list (§20). This is L11 at work: operators can't
 * silently change K between runs.
 */
export const createStopgapRetriever = (args: {
  collectionNames: readonly string[];
  embedModel: string;
  /** The ingest_run_id under test. Scopes retrieval to THIS run's points only
   *  (payload `ingested_by`) — see the load-bearing note above. */
  ingestRunId: string;
}): Retriever => {
  const cfg = getConfig();
  const env = getEnv();

  // Restrict every query to the points written by the ingest under test. The
  // shared bench collection holds many runs' worth of stale chunks (see above).
  const runFilter = { must: [{ key: "ingested_by", match: { value: args.ingestRunId } }] };

  const retrieve = async (
    queryText: string,
    k: number,
  ): Promise<RetrievalResult[]> => {
    const denseVector = await embedViaOllama({
      ollamaUrl: env.OLLAMA_URL,
      model: args.embedModel,
      input: queryText,
      kind: "query",
    });
    const sparseVector = bm25Vectorize(queryText);
    const fetchLimit = k * 2;

    // Query every alias in parallel for both modalities.
    const perCollection = await Promise.all(
      args.collectionNames.map(async (name) => {
        const [dense, sparse] = await Promise.all([
          qdrantQuery({
            qdrantUrl: env.QDRANT_URL,
            apiKey: env.QDRANT_API_KEY,
            collection: name,
            body: {
              using: "dense",
              query: denseVector,
              limit: fetchLimit,
              with_payload: ["chunk_id"],
              filter: runFilter,
            },
          }),
          qdrantQuery({
            qdrantUrl: env.QDRANT_URL,
            apiKey: env.QDRANT_API_KEY,
            collection: name,
            body: {
              using: "bm25",
              query: sparseVector,
              limit: fetchLimit,
              with_payload: ["chunk_id"],
              filter: runFilter,
            },
          }),
        ]);
        return { dense, sparse };
      }),
    );

    // Union per-collection hits, preserving relative ordering within each list,
    // then let RRF compute ranks over the union.
    const denseAll = perCollection.flatMap((r) => r.dense);
    const sparseAll = perCollection.flatMap((r) => r.sparse);

    return reciprocalRankFusion({
      dense: denseAll,
      bm25: sparseAll,
      dense_weight: cfg.retrieval.retriever_config.dense_weight,
      bm25_weight: cfg.retrieval.retriever_config.bm25_weight,
      rank_constant: cfg.retrieval.retriever_config.rank_constant,
      k,
    });
  };

  return {
    name: "stopgap-qdrant-direct",
    config_snapshot: { ...cfg.retrieval.retriever_config },
    retrieve,
  };
};
