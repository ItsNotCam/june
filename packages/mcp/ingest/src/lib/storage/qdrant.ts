// author: Claude
import { QdrantClient } from "@qdrant/js-client-rest";
import { getEnv } from "@/lib/env";
import { QdrantWriteError } from "@/lib/errors";
import { chunkIdToQdrantPointId } from "@/lib/ids";
import { logger } from "@/lib/logger";
import type { ChunkId } from "@/types/ids";
import type { VectorPoint, VectorStorage } from "./types";

/**
 * Qdrant-backed VectorStorage. Uses the official `@qdrant/js-client-rest`
 * client; all HTTP traffic goes through Bun's global `fetch`, which the
 * offline guard ([§25.5](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#255-offline-invariant-enforcement)) wraps.
 *
 * Collection layout ([§9](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#9-qdrant-collection-design)):
 *   - two aliases: `internal` → `internal_v1`, `external` → `external_v1`
 *   - each collection has named vectors `dense` (cosine) + `bm25` (sparse/IDF)
 *   - 27 payload indexes, created per the table in [§9](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#9-qdrant-collection-design)
 */

const ALIAS_TO_BASE: Readonly<Record<"internal" | "external", string>> = {
  internal: "internal_v1",
  external: "external_v1",
};

/** Payload fields indexed at init ([§9](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#9-qdrant-collection-design)). Shape: [field, kind]. */
const PAYLOAD_INDEXES: ReadonlyArray<{
  name: string;
  schema: "keyword" | "integer" | "float" | "bool" | "datetime";
}> = [
  { name: "doc_id", schema: "keyword" },
  { name: "version", schema: "keyword" },
  { name: "is_latest", schema: "bool" },
  { name: "source_type", schema: "keyword" },
  { name: "content_type", schema: "keyword" },
  { name: "namespace", schema: "keyword" },
  { name: "project", schema: "keyword" },
  { name: "category", schema: "keyword" },
  { name: "tags", schema: "keyword" },
  { name: "audience", schema: "keyword" },
  { name: "audience_technicality", schema: "integer" },
  { name: "sensitivity", schema: "keyword" },
  { name: "lifecycle_status", schema: "keyword" },
  { name: "stability", schema: "keyword" },
  { name: "temporal_scope", schema: "keyword" },
  { name: "source_trust_tier", schema: "keyword" },
  { name: "deprecated", schema: "bool" },
  { name: "section_role", schema: "keyword" },
  { name: "answer_shape", schema: "keyword" },
  { name: "self_contained", schema: "bool" },
  { name: "contains_code", schema: "bool" },
  { name: "code_languages", schema: "keyword" },
  { name: "source_system", schema: "keyword" },
  { name: "source_modified_at", schema: "datetime" },
  { name: "ingested_at", schema: "datetime" },
  { name: "quality_score", schema: "float" },
  { name: "authority_source_score", schema: "float" },
  { name: "embedding_model_name", schema: "keyword" },
  { name: "superseded_by", schema: "keyword" },
];

const buildClient = (): QdrantClient => {
  const env = getEnv();
  return new QdrantClient({
    url: env.QDRANT_URL,
    apiKey: env.QDRANT_API_KEY,
    checkCompatibility: false,
  });
};

const collectionExists = async (
  client: QdrantClient,
  name: string,
): Promise<boolean> => {
  try {
    await client.getCollection(name);
    return true;
  } catch {
    return false;
  }
};

const aliasPointsTo = async (
  client: QdrantClient,
  alias: string,
): Promise<string | undefined> => {
  try {
    const all = await client.getAliases();
    const match = all.aliases.find((a) => a.alias_name === alias);
    return match?.collection_name;
  } catch {
    return undefined;
  }
};

const ensureOneCollection = async (
  client: QdrantClient,
  base: string,
  alias: "internal" | "external",
  dim: number,
): Promise<void> => {
  if (!(await collectionExists(client, base))) {
    await client.createCollection(base, {
      vectors: {
        dense: { size: dim, distance: "Cosine" },
      },
      sparse_vectors: {
        bm25: { modifier: "idf" },
      },
    });
    logger.info("qdrant_collection_created", { event: "qdrant_collection_created", model_name: base });
  }

  // createPayloadIndex throws on duplicate — treat "already exists" as success,
  // re-throw anything else so real errors (auth, validation) surface loudly.
  for (const idx of PAYLOAD_INDEXES) {
    try {
      await client.createPayloadIndex(base, {
        field_name: idx.name,
        field_schema: idx.schema,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/already exists|duplicat/i.test(msg)) {
        logger.warn("qdrant_payload_index_error", {
          event: "qdrant_payload_index_error",
          field_names: [idx.name],
          error_message: msg,
        });
        throw err;
      }
    }
  }

  const target = await aliasPointsTo(client, alias);
  if (target !== base) {
    await client.updateCollectionAliases({
      actions: [
        {
          create_alias: { alias_name: alias, collection_name: base },
        },
      ],
    });
    logger.info("qdrant_alias_set", { event: "qdrant_alias_set", model_name: `${alias}->${base}` });
  }
};

/**
 * Factory — returns a configured `VectorStorage`. Uses module-level env
 * singleton for URL / API key; `buildPipeline` wires it in as the default.
 */
export const createQdrantStorage = (): VectorStorage => {
  const client = buildClient();

  const ensureCollections: VectorStorage["ensureCollections"] = async (dim) => {
    for (const alias of ["internal", "external"] as const) {
      await ensureOneCollection(client, ALIAS_TO_BASE[alias], alias, dim);
    }
  };

  const upsert: VectorStorage["upsert"] = async (points) => {
    const byCollection = new Map<"internal" | "external", VectorPoint[]>();
    for (const p of points) {
      const bucket = byCollection.get(p.collection) ?? [];
      bucket.push(p);
      byCollection.set(p.collection, bucket);
    }
    for (const [alias, batch] of byCollection) {
      try {
        await client.upsert(alias, {
          points: batch.map((p) => ({
            id: p.point_id,
            vector: {
              dense: [...p.dense],
              bm25: { indices: p.sparse.indices, values: p.sparse.values },
            },
            payload: p.payload,
          })),
          wait: true,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new QdrantWriteError(
          batch.map((p) => p.chunk_id),
          msg,
        );
      }
    }
  };

  const flipIsLatest: VectorStorage["flipIsLatest"] = async (
    alias,
    doc_id,
    prior_version,
  ) => {
    await client.setPayload(alias, {
      payload: { is_latest: false },
      filter: {
        must: [
          { key: "doc_id", match: { value: doc_id as string } },
          { key: "version", match: { value: prior_version as string } },
        ],
      },
      wait: true,
    });
    return 0;
  };

  const deletePointsByChunkIds: VectorStorage["deletePointsByChunkIds"] = async (
    alias,
    chunk_ids,
  ) => {
    if (chunk_ids.length === 0) return 0;
    const point_ids = chunk_ids.map(chunkIdToQdrantPointId);
    await client.delete(alias, { points: point_ids, wait: true });
    return point_ids.length;
  };

  const deletePointsByDocId: VectorStorage["deletePointsByDocId"] = async (
    alias,
    doc_id,
  ) => {
    await client.delete(alias, {
      filter: {
        must: [{ key: "doc_id", match: { value: doc_id as string } }],
      },
      wait: true,
    });
    return 0;
  };

  const scrollAllChunkIds: VectorStorage["scrollAllChunkIds"] = async function* (
    alias,
    batchSize,
  ) {
    let offset: string | number | undefined = undefined;
    while (true) {
      const res = await client.scroll(alias, {
        limit: batchSize,
        offset,
        with_payload: { include: ["chunk_id"] },
        with_vector: false,
      });
      const chunkIds = res.points
        .map((p) => (p.payload as { chunk_id?: unknown })?.chunk_id)
        .filter((v): v is string => typeof v === "string")
        .map((v) => v as unknown as ChunkId);
      if (chunkIds.length > 0) yield chunkIds;
      if (!res.next_page_offset) return;
      offset = res.next_page_offset as string | number;
    }
  };

  const swapEmbedAlias: VectorStorage["swapEmbedAlias"] = async (
    alias,
    new_collection,
  ) => {
    const prior = await aliasPointsTo(client, alias);
    const actions: Array<
      | { create_alias: { alias_name: string; collection_name: string } }
      | { delete_alias: { alias_name: string } }
    > = [];
    if (prior) actions.push({ delete_alias: { alias_name: alias } });
    actions.push({
      create_alias: { alias_name: alias, collection_name: new_collection },
    });
    await client.updateCollectionAliases({ actions });
  };

  const probeReachable: VectorStorage["probeReachable"] = async () => {
    try {
      await client.getCollections();
      return true;
    } catch {
      return false;
    }
  };

  return {
    name: "qdrant",
    ensureCollections,
    upsert,
    flipIsLatest,
    deletePointsByChunkIds,
    deletePointsByDocId,
    scrollAllChunkIds,
    swapEmbedAlias,
    probeReachable,
  };
};

/**
 * Qualified collection names used by the re-embed flow — exported so the
 * orchestrator can compute `internal_v2` / `external_v2` without reaching
 * into this module's internals.
 */
export const baseCollectionName = (
  alias: "internal" | "external",
): string => ALIAS_TO_BASE[alias];

export const _internal = { ALIAS_TO_BASE, PAYLOAD_INDEXES } as const;
