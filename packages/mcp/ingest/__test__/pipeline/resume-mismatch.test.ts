// author: Claude
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@/lib/config";
import { createStubClassifier } from "@/lib/classifier/stub";
import { createStubEmbedder } from "@/lib/embedder/stub";
import { createStubSummarizer } from "@/lib/summarizer/stub";
import { createSqliteSidecar } from "@/lib/storage/sqlite";
import { ingestPath } from "@/pipeline/ingest";
import { resumeRun } from "@/pipeline/resume";
import type { PipelineDeps } from "@/pipeline/factory";
import type { VectorPoint, VectorStorage } from "@/lib/storage/types";
import type { ChunkId } from "@/types/ids";

/**
 * [§24.6](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#246-resume-across-embedding-model-changes) — resume detects chunks embedded under a different model and
 * warns without re-embedding.
 */

const makeInMemoryVector = (): VectorStorage => {
  const pointsByCollection = new Map<string, Map<string, VectorPoint>>();
  return {
    name: "memory",
    ensureCollections: async () => {},
    upsert: async (points) => {
      for (const p of points) {
        const m = pointsByCollection.get(p.collection) ?? new Map<string, VectorPoint>();
        m.set(p.point_id, p);
        pointsByCollection.set(p.collection, m);
      }
    },
    flipIsLatest: async () => 0,
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

beforeAll(async () => {
  await loadConfig(undefined);
});

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "june-resume-mismatch-"));
  const sidecar = await createSqliteSidecar(join(tempRoot, "june.db"));
  deps = {
    classifier: createStubClassifier(),
    summarizer: createStubSummarizer(),
    embedder: createStubEmbedder(32),
    storage: { sidecar, vector: makeInMemoryVector() },
  };
});

afterEach(async () => {
  await deps.storage.sidecar.close();
  await rm(tempRoot, { recursive: true, force: true });
});

describe("resume embedding-model mismatch (§24.6)", () => {
  test("no mismatch when the model matches persisted chunks", async () => {
    const path = join(tempRoot, "doc.md");
    await writeFile(
      path,
      "# Title\n\nAlpha body paragraph with enough words to chunk.\n",
    );
    await ingestPath({ path, deps });
    const res = await resumeRun({
      deps,
      embedder: deps.embedder,
    });
    expect(res.embedding_model_mismatch_count).toBe(0);
  });

  test("reports count when stored chunks used a different embedding model", async () => {
    const path = join(tempRoot, "doc.md");
    await writeFile(
      path,
      "# Title\n\nAlpha body paragraph with enough words to chunk.\n",
    );
    await ingestPath({ path, deps });

    // Swap in a differently-named embedder before calling resume.
    const altEmbedder = {
      ...createStubEmbedder(32),
      name: "other-embed-model",
      version: "v2",
    };
    const res = await resumeRun({
      deps,
      embedder: altEmbedder,
    });
    expect(res.embedding_model_mismatch_count).toBeGreaterThan(0);
  });

  test("no check performed when embedder not provided", async () => {
    const path = join(tempRoot, "doc.md");
    await writeFile(path, "# Title\n\nBody.\n");
    await ingestPath({ path, deps });
    const res = await resumeRun({ deps });
    expect(res.embedding_model_mismatch_count).toBe(0);
  });
});
