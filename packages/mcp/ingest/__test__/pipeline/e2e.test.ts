// author: Claude
import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@/lib/config";
import { createStubClassifier } from "@/lib/classifier/stub";
import { createStubEmbedder } from "@/lib/embedder/stub";
import { createStubSummarizer } from "@/lib/summarizer/stub";
import { createSqliteSidecar } from "@/lib/storage/sqlite";
import { ingestPath } from "@/pipeline/ingest";
import type { PipelineDeps } from "@/pipeline/factory";
import type { VectorPoint, VectorStorage } from "@/lib/storage/types";
import type { ChunkId, DocId, Version } from "@/types/ids";

/**
 * End-to-end ingestion against stubbed model backends and an in-memory
 * "vector storage" that captures upserts. Exercises [§37.2](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#372-idempotency) (idempotency),
 * [§37.5](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#375-versioning--is_latest-semantics) (versioning, is_latest flip), and [§37.3](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#373-resume-correctness) (resume correctness).
 */

type Upsert = { points: ReadonlyArray<VectorPoint> };

const makeInMemoryVector = (): VectorStorage & { upserts: Upsert[] } => {
  const upserts: Upsert[] = [];
  const pointsByCollection = new Map<string, Map<string, VectorPoint>>();
  const flips: Array<{ doc_id: DocId; prior_version: Version }> = [];
  void flips;
  return {
    upserts,
    name: "memory",
    ensureCollections: async () => {},
    upsert: async (points) => {
      upserts.push({ points });
      for (const p of points) {
        const m = pointsByCollection.get(p.collection) ?? new Map<string, VectorPoint>();
        m.set(p.point_id, p);
        pointsByCollection.set(p.collection, m);
      }
    },
    flipIsLatest: async (_collection, _doc_id, _prior_version) => 0,
    deletePointsByChunkIds: async (_c, ids) => ids.length,
    deletePointsByDocId: async () => 0,
    scrollAllChunkIds: async function* (collection) {
      const m = pointsByCollection.get(collection);
      if (!m) return;
      const ids = [...m.values()]
        .map((p) => (p.payload as { chunk_id?: unknown })?.chunk_id)
        .filter((v): v is string => typeof v === "string") as unknown as ChunkId[];
      if (ids.length > 0) yield ids;
    },
    swapEmbedAlias: async () => {},
    probeReachable: async () => true,
  };
};

let tempRoot: string;
let deps: PipelineDeps;
let vector: ReturnType<typeof makeInMemoryVector>;

beforeAll(async () => {
  await loadConfig(undefined);
});

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "june-e2e-"));
  const sidecar = await createSqliteSidecar(join(tempRoot, "june.db"));
  vector = makeInMemoryVector();
  deps = {
    classifier: createStubClassifier(),
    summarizer: createStubSummarizer(),
    embedder: createStubEmbedder(32),
    storage: { sidecar, vector },
  };
});

afterAll(async () => {
  // Best-effort — only runs once at suite end.
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

const writeDoc = async (dir: string, name: string, body: string): Promise<string> => {
  await mkdir(dir, { recursive: true });
  const p = join(dir, name);
  await writeFile(p, body);
  return p;
};

describe("end-to-end ingest (stubs, §37.2)", () => {
  test("single doc goes through every stage to stored", async () => {
    const path = await writeDoc(
      tempRoot,
      "sample.md",
      `---
title: Sample
---

# Sample document

Intro paragraph.

## Section A

Alpha body text with enough substance to chunk.

## Section B

Bravo body text here for the second section.
`,
    );
    const res = await ingestPath({ path, deps });
    expect(res.processed).toBe(1);
    expect(res.errored).toBe(0);
    expect(vector.upserts.length).toBeGreaterThan(0);

    // At least one point was upserted with payload carrying doc fields.
    const point = vector.upserts[0]!.points[0]!;
    expect(typeof (point.payload as { doc_id?: unknown }).doc_id).toBe("string");
    expect((point.payload as { is_latest?: unknown }).is_latest).toBe(true);
  });

  test("re-ingesting unchanged content short-circuits (§14.8)", async () => {
    const path = await writeDoc(tempRoot, "unchanged.md", "# T\n\nbody one body two.\n");
    const first = await ingestPath({ path, deps });
    expect(first.processed).toBe(1);
    const upsertsAfterFirst = vector.upserts.length;

    const second = await ingestPath({ path, deps });
    // Second run short-circuits — Stage 1 returns "unchanged" and we skip.
    expect(second.skipped).toBe(1);
    expect(second.processed).toBe(0);
    // No additional upsert.
    expect(vector.upserts.length).toBe(upsertsAfterFirst);
  });
});
