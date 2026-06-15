// author: Claude
import { beforeAll, describe, expect, test } from "bun:test";
import { loadConfig } from "@/lib/config";
import { query } from "@/retriever/query";
import type { Embedder } from "@/lib/embedder/types";
import type {
  VectorSearchHit,
  VectorSearchQuery,
  VectorStorage,
} from "@/lib/storage/types";

/**
 * Validates the retrieval orchestrator end-to-end against an in-memory vector
 * store: query-prefix embedding, per-collection dense+sparse fan-out, RRF
 * fusion, and payload re-join into `RetrievedChunk`.
 */

const stubEmbedder: Embedder = {
  name: "stub",
  version: "v0",
  dim: 3,
  max_input_chars: 1000,
  embed: async (texts) => texts.map(() => [0.1, 0.2, 0.3]),
  unload: async () => {},
};

const chunkHit = (chunk_id: string, content: string): VectorSearchHit => ({
  id: chunk_id,
  score: 1,
  payload: {
    chunk_id,
    content,
    document_title: "Doc",
    heading_path: ["Section"],
    source_uri: `mem://${chunk_id}`,
    content_type: "prose",
  },
});

/** Vector stub: only `internal` has data; records every search query for assertions. */
const makeVector = (calls: VectorSearchQuery[]): VectorStorage => ({
  name: "stub",
  ensureCollections: async () => {},
  search: async (q) => {
    calls.push(q);
    if (q.collection !== "internal") return [];
    if (q.using === "dense") return [chunkHit("a", "alpha"), chunkHit("b", "bravo")];
    return [chunkHit("a", "alpha")]; // bm25 also surfaces "a" → should fuse
  },
  upsert: async () => {},
  flipIsLatest: async () => 0,
  deletePointsByChunkIds: async () => 0,
  deletePointsByDocId: async () => 0,
  scrollAllChunkIds: async function* () {},
  swapEmbedAlias: async () => {},
  probeReachable: async () => true,
});

describe("query", () => {
  beforeAll(async () => {
    // Shipped defaults include the retrieval + bm25 config blocks query() reads.
    await loadConfig();
  });

  test("fuses dense + bm25 and re-joins chunk content from payload", async () => {
    const calls: VectorSearchQuery[] = [];
    const results = await query(
      { embedder: stubEmbedder, vector: makeVector(calls) },
      { text: "what is alpha", k: 5 },
    );

    // "a" surfaced in both modalities → fused and ranked first, with content.
    expect(results[0]!.chunk_id).toBe("a");
    expect(results[0]!.rank_source).toBe("fused");
    expect(results[0]!.content).toBe("alpha");
    expect(results[0]!.source_uri).toBe("mem://a");
    expect(results.map((r) => r.chunk_id).sort()).toEqual(["a", "b"]);
  });

  test("searches every default collection for both modalities, filtering is_latest by default", async () => {
    const calls: VectorSearchQuery[] = [];
    await query(
      { embedder: stubEmbedder, vector: makeVector(calls) },
      { text: "alpha" },
    );
    // 2 default collections × {dense, bm25} = 4 searches.
    expect(calls).toHaveLength(4);
    expect(calls.every((c) => c.onlyLatest !== false)).toBe(true);
    expect(new Set(calls.map((c) => c.using))).toEqual(new Set(["dense", "bm25"]));
  });

  test("honors an explicit collection scope", async () => {
    const calls: VectorSearchQuery[] = [];
    await query(
      { embedder: stubEmbedder, vector: makeVector(calls) },
      { text: "alpha", collections: ["internal"] },
    );
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.collection === "internal")).toBe(true);
  });
});
