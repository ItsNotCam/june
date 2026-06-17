// author: Claude
import { describe, expect, test, beforeAll, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@/lib/config";
import { createStubEmbedder } from "@/lib/embedder/stub";
import { createStubSummarizer } from "@/lib/summarizer/stub";
import { createSqliteSidecar } from "@/lib/storage/sqlite";
import { ingestPath } from "@/pipeline/ingest";
import { resumeRun } from "@/pipeline/resume";
import type { PipelineDeps } from "@/pipeline/factory";
import type { SidecarStorage, VectorPoint, VectorStorage } from "@/lib/storage/types";
import type { Embedder } from "@/lib/embedder/types";
import type { Summarizer } from "@/lib/summarizer/types";

/**
 * Two-phase ingest invariant (single-GPU VRAM contention fix): within a phase
 * window, EVERY summarize happens before ANY embed, with exactly one
 * `summarizer.unload()` at the boundary between them. This is what guarantees the
 * summarizer (gemma) and embedder are never both resident — proven here by
 * recording a global, ordered call log across a multi-doc `ingestPath` run on
 * stub backends (no Ollama, no GPU).
 */

const makeInMemoryVector = (events: string[]): VectorStorage => {
  const upserts: VectorPoint[] = [];
  return {
    name: "memory",
    ensureCollections: async () => {
      events.push("ensureCollections");
    },
    search: async () => [],
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

/** Wraps the stub summarizer to log every summarize call + its unload. */
const makeSpySummarizer = (events: string[]): Summarizer => {
  const inner = createStubSummarizer();
  return {
    name: inner.name,
    version: inner.version,
    summarizeChunk: async (input) => {
      events.push("summarize");
      return inner.summarizeChunk(input);
    },
    summarizeDocument: async (input) => {
      events.push("summarize");
      return inner.summarizeDocument(input);
    },
    unload: async () => {
      events.push("summarizer.unload");
    },
  };
};

/** Wraps the stub embedder to log every embed call + its unload. */
const makeSpyEmbedder = (events: string[], dim = 32): Embedder => {
  const inner = createStubEmbedder(dim);
  return {
    name: inner.name,
    version: inner.version,
    dim: inner.dim,
    max_input_chars: inner.max_input_chars,
    embed: async (texts) => {
      events.push("embed");
      return inner.embed(texts);
    },
    unload: async () => {
      events.push("embedder.unload");
    },
  };
};

let tempRoot: string;
let sidecar: SidecarStorage;

beforeAll(async () => {
  await loadConfig(undefined);
});

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "june-two-phase-"));
  sidecar = await createSqliteSidecar(join(tempRoot, "june.db"));
});

afterEach(async () => {
  await sidecar.close();
  await rm(tempRoot, { recursive: true, force: true });
});

const writeDoc = async (name: string, body: string): Promise<void> => {
  await mkdir(tempRoot, { recursive: true });
  await writeFile(join(tempRoot, name), body);
};

describe("two-phase ingest (summarize all → embed all)", () => {
  test("all summaries precede all embeds, with one summarizer.unload between", async () => {
    // Three docs — comfortably one phase window (DEFAULT_PHASE_WINDOW = 256).
    await writeDoc("a.md", "# A\n\nAlpha body text with enough substance to chunk.\n");
    await writeDoc("b.md", "# B\n\nBravo body text with enough substance to chunk.\n");
    await writeDoc("c.md", "# C\n\nCharlie body text with enough substance to chunk.\n");

    const events: string[] = [];
    const deps: PipelineDeps = {
      summarizer: makeSpySummarizer(events),
      embedder: makeSpyEmbedder(events),
      storage: { sidecar, vector: makeInMemoryVector(events) },
    };

    const res = await ingestPath({ path: tempRoot, deps });
    expect(res.processed).toBe(3);
    expect(res.errored).toBe(0);

    const summIdxs = events.flatMap((e, i) => (e === "summarize" ? [i] : []));
    const embIdxs = events.flatMap((e, i) => (e === "embed" ? [i] : []));
    const unloadIdxs = events.flatMap((e, i) => (e === "summarizer.unload" ? [i] : []));

    // Each phase actually ran.
    expect(summIdxs.length).toBeGreaterThanOrEqual(3);
    expect(embIdxs.length).toBeGreaterThanOrEqual(3);

    // THE invariant: no embed before the last summarize, no summarize after the
    // first embed — i.e. the two models never need to be resident together.
    expect(Math.max(...summIdxs)).toBeLessThan(Math.min(...embIdxs));

    // Exactly one summarizer unload for the single window, sitting at the seam.
    expect(unloadIdxs).toHaveLength(1);
    expect(unloadIdxs[0]!).toBeGreaterThan(Math.max(...summIdxs));
    expect(unloadIdxs[0]!).toBeLessThan(Math.min(...embIdxs));

    // Collections exist before the first embed/store.
    const ensureIdx = events.indexOf("ensureCollections");
    expect(ensureIdx).toBeGreaterThanOrEqual(0);
    expect(ensureIdx).toBeLessThan(Math.min(...embIdxs));

    // The embedder is freed for Phase A (window start) and at the run boundary.
    expect(events.filter((e) => e === "embedder.unload").length).toBeGreaterThanOrEqual(1);
  });

  test("a Phase-B (embed) crash leaves the doc resumable — resume re-derives to stored", async () => {
    await writeDoc("doc.md", "# Doc\n\nBody text with enough substance to chunk here.\n");

    // First run: the embedder throws, so Phase B fails AFTER Stage 6 committed
    // status=contextualized. The doc is left in-flight (not terminal), not lost.
    const throwingEmbedder: Embedder = {
      ...createStubEmbedder(32),
      embed: async () => {
        throw new Error("embed boom");
      },
    };
    const firstVector = makeInMemoryVector([]);
    const first = await ingestPath({
      path: tempRoot,
      deps: {
        summarizer: createStubSummarizer(),
        embedder: throwingEmbedder,
        storage: { sidecar, vector: firstVector },
      },
    });
    expect(first.processed).toBe(0);
    expect(first.errored).toBe(1);

    const afterCrash = await sidecar.listLatestDocuments();
    expect(afterCrash).toHaveLength(1);
    expect(afterCrash[0]!.status).toBe("contextualized"); // summarized, not yet embedded

    // Resume with a WORKING embedder: Stage 3 resets chunks → Stage 6
    // re-summarizes (deterministic stub) → Stage 8/9/10 embed + store. No
    // dependency on the persisted summary being complete.
    let upserts = 0;
    const goodVector: VectorStorage = {
      ...makeInMemoryVector([]),
      upsert: async (points) => {
        upserts += points.length;
      },
    };
    const resumed = await resumeRun({
      deps: {
        summarizer: createStubSummarizer(),
        embedder: createStubEmbedder(32),
        storage: { sidecar, vector: goodVector },
      },
    });
    expect(resumed.resumed).toBe(1);
    expect(upserts).toBeGreaterThan(0);

    const afterResume = await sidecar.listLatestDocuments();
    expect(afterResume[0]!.status).toBe("stored");
  });
});
