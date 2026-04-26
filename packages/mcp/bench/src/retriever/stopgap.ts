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
 * Stopgap retriever (Appendix E).
 *
 * Queries every configured alias (typically `internal` + `external`) for
 * both modalities in parallel, unions the per-alias results, then fuses
 * dense + sparse via RRF. When june exposes a proper retrieval API, this
 * file is swapped for `june-api.ts` — nothing else in the bench changes.
 *
 * One call per query — the max K the bench needs (from
 * `config.retrieval.k_values`) is asked up front and all recall@K values are
 * computed from the one list (§20). This is L11 at work: operators can't
 * silently change K between runs.
 */
export const createStopgapRetriever = (args: {
  collectionNames: readonly string[];
  embedModel: string;
}): Retriever => {
  const cfg = getConfig();
  const env = getEnv();

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
