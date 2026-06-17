import { bm25Vectorize } from "#internal/lib/embedder/bm25";
import type { Embedder } from "#internal/lib/embedder/types";
import { getConfig } from "#internal/lib/config";
import type { VectorStorage } from "#internal/lib/storage/types";
import { logger } from "#internal/lib/logger";
import type { RetrievedChunk } from "#internal/types/retrieval";
import { reciprocalRankFusion } from "./rrf";

/**
 * The slice of `PipelineDeps` retrieval needs. Callers pass
 * `{ embedder: deps.embedder, vector: deps.storage.vector }` from `buildDeps()`
 * so retrieval reuses the one process-wide embedder + Qdrant connection.
 */
export type QueryDeps = {
  embedder: Embedder;
  vector: VectorStorage;
};

/** Options for a single retrieval call. */
export type QueryOptions = {
  /** The user's natural-language query. */
  text: string;
  /** How many fused chunks to return. Defaults to `config.retrieval.default_k`. */
  k?: number;
  /** Which collections to search. Defaults to `config.retrieval.collections`. */
  collections?: ReadonlyArray<"internal" | "external">;
};

/**
 * Hybrid retrieval over june's stored chunks — the system-of-record query API.
 *
 * Embeds the query (dense, with the asymmetric `query:` prefix) and builds a
 * sparse BM25 vector, searches every target collection for both modalities at
 * `k * fetch_multiplier`, fuses with RRF, and returns the top-`k` chunks with
 * their text + citation metadata pulled straight from the Qdrant payload (no
 * sidecar read). Only `is_latest = true` chunks are surfaced.
 */
export const query = async (
  deps: QueryDeps,
  opts: QueryOptions,
): Promise<RetrievedChunk[]> => {
  const cfg = getConfig().retrieval;
  const k = opts.k ?? cfg.default_k;
  const collections = opts.collections ?? cfg.collections;
  const fetchLimit = k * cfg.fetch_multiplier;

  // Dense uses the asymmetric query-side prefix; sparse keyword matching uses
  // the raw query text (matching how doc-side BM25 vectors were built).
  // Unload the embed model once we have the vector — it isn't needed for the
  // Qdrant search, and this frees VRAM before any downstream reader/gemma call.
  let denseVector: ReadonlyArray<number> | undefined;
  try {
    const denseVectors = await deps.embedder.embed([`${cfg.query_prefix}${opts.text}`]);
    denseVector = denseVectors[0];
  } finally {
    await deps.embedder.unload();
  }
  if (!denseVector) throw new Error("Embedder returned no vector for the query");
  const sparseVector = bm25Vectorize(opts.text);

  const perCollection = await Promise.all(
    collections.map(async (collection) => {
      const [dense, bm25] = await Promise.all([
        deps.vector.search({ collection, using: "dense", vector: denseVector, limit: fetchLimit }),
        deps.vector.search({
          collection,
          using: "bm25",
          vector: { indices: sparseVector.indices, values: sparseVector.values },
          limit: fetchLimit,
        }),
      ]);
      return { dense, bm25 };
    }),
  );

  const denseAll = perCollection.flatMap((r) => r.dense);
  const bm25All = perCollection.flatMap((r) => r.bm25);

  // chunk_id → payload, so we can re-join chunk text after RRF (which is
  // payload-free and keyed on chunk_id only).
  const payloadByChunkId = new Map<string, Record<string, unknown>>();
  for (const hit of [...denseAll, ...bm25All]) {
    const id = hit.payload["chunk_id"];
    if (typeof id === "string") payloadByChunkId.set(id, hit.payload);
  }

  const fused = reciprocalRankFusion({
    dense: denseAll,
    bm25: bm25All,
    dense_weight: cfg.dense_weight,
    bm25_weight: cfg.bm25_weight,
    rank_constant: cfg.rank_constant,
    k,
  });

  const results = fused.map((f): RetrievedChunk => {
    const payload = payloadByChunkId.get(f.chunk_id) ?? {};
    return {
      chunk_id: f.chunk_id,
      score: f.score,
      rank_source: f.rank_source,
      content: asString(payload["content"]) ?? "",
      document_title: asString(payload["document_title"]),
      heading_path: asStringArray(payload["heading_path"]),
      source_uri: asString(payload["source_uri"]),
      content_type: asString(payload["content_type"]),
    };
  });

  logger.info("retrieval_query", {
    event: "retrieval_query",
    count: results.length,
  });

  return results;
};

const asString = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

const asStringArray = (v: unknown): ReadonlyArray<string> | undefined =>
  Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : undefined;
