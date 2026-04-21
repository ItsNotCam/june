// author: Claude
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@/lib/config";
import { createStubEmbedder } from "@/lib/embedder/stub";
import { createSqliteSidecar } from "@/lib/storage/sqlite";
import { ingestPath } from "@/pipeline/ingest";
import type { Classifier } from "@/lib/classifier/types";
import type { PipelineDeps } from "@/pipeline/factory";
import type { SidecarStorage, VectorPoint, VectorStorage } from "@/lib/storage/types";
import type { Summarizer } from "@/lib/summarizer/types";

/**
 * [§18.6](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#186-failure-handling-and-fallbacks) / [§19.5](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#195-output-validation-and-bounds) — classifier + summarizer failures fall back to the
 * configured defaults (or heading-path blurb) and advance the chunk rather
 * than halting the document.
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

const throwingClassifier: Classifier = {
  name: "throwing-stub",
  version: "v0",
  classify: async () => {
    throw new Error("boom");
  },
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

describe("classifier/summarizer fallback (§18.6, §19.5)", () => {
  test("throwing classifier → fallback classification applied, doc completes", async () => {
    const deps: PipelineDeps = {
      classifier: throwingClassifier,
      summarizer: {
        name: "stub",
        version: "v0",
        summarizeChunk: async (i) => ({
          chunk_id: i.chunk_id,
          contextual_summary:
            "Stub summary long enough to satisfy the length guard.",
          used_long_doc_path: false,
        }),
        summarizeDocument: async () => ({ title: "x", purpose: "x", sections: [] }),
      },
      embedder: createStubEmbedder(32),
      storage: { sidecar, vector: makeInMemoryVector() },
    };
    const p = join(tempRoot, "a.md");
    await writeFile(p, "# T\n\nBody paragraph long enough to chunk.\n");
    const res = await ingestPath({ path: p, deps });
    expect(res.processed).toBe(1);
    expect(res.errored).toBe(0);
  });

  test("throwing summarizer → fallback blurb applied, doc completes", async () => {
    const deps: PipelineDeps = {
      classifier: {
        name: "stub",
        version: "v0",
        classify: async (i) => ({
          chunk_id: i.chunk_id,
          classification: {
            namespace: "personal",
            project: undefined,
            category: "reference",
            section_role: "reference",
            answer_shape: "concept",
            audience: ["engineering"],
            audience_technicality: 3,
            sensitivity: "internal",
            lifecycle_status: "published",
            stability: "stable",
            temporal_scope: "current",
            source_trust_tier: "derived",
            prerequisites: [],
            self_contained: true,
            negation_heavy: false,
            tags: [],
          },
          raw_response: "",
        }),
      },
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
