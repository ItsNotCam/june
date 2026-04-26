// author: Claude
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@/lib/config";
import { createStubEmbedder } from "@/lib/embedder/stub";
import { createSqliteSidecar } from "@/lib/storage/sqlite";
import { ingestPath } from "@/pipeline/ingest";
import type { PipelineDeps } from "@/pipeline/factory";
import type { SidecarStorage, VectorPoint, VectorStorage } from "@/lib/storage/types";
import type { Summarizer } from "@/lib/summarizer/types";

/**
 * [§19.5](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#195-output-validation-and-bounds) — summarizer failure falls back to a deterministic
 * heading-path blurb and advances the chunk rather than halting the document.
 */

const makeInMemoryVector = (): VectorStorage => {
  const upserts: VectorPoint[] = [];
  return {
    name: "memory",
    ensureCollections: async () => {},
    upsert: async (points) => {
      upserts.push(...points);
    },
    flipIsLatest: async () => 0,
    deletePointsByChunkIds: async (_c, ids) => ids.length,
    deletePointsByDocId: async () => 0,
    scrollAllChunkIds: async function* () {},
    swapEmbedAlias: async () => {},
    probeReachable: async () => true,
  };
};

const throwingSummarizer: Summarizer = {
  name: "throwing-stub",
  version: "v0",
  summarizeChunk: async () => {
    throw new Error("boom");
  },
  summarizeDocument: async () => ({
    title: "x",
    purpose: "x",
    sections: [],
  }),
};

let tempRoot: string;
let sidecar: SidecarStorage;

beforeAll(async () => {
  await loadConfig(undefined);
});

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "june-fallback-"));
  sidecar = await createSqliteSidecar(join(tempRoot, "june.db"));
});

afterEach(async () => {
  await sidecar.close();
  await rm(tempRoot, { recursive: true, force: true });
});

describe("summarizer fallback (§19.5)", () => {
  test("throwing summarizer → fallback blurb applied, doc completes", async () => {
    const deps: PipelineDeps = {
      summarizer: throwingSummarizer,
      embedder: createStubEmbedder(32),
      storage: { sidecar, vector: makeInMemoryVector() },
    };
    const p = join(tempRoot, "b.md");
    await writeFile(p, "# T\n\nBody paragraph long enough to chunk.\n");
    const res = await ingestPath({ path: p, deps });
    expect(res.processed).toBe(1);
    expect(res.errored).toBe(0);
  });
});
