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
import { deriveDocId } from "@/lib/ids";
import { asVersion } from "@/types/ids";
import type { PipelineDeps } from "@/pipeline/factory";
import type { VectorPoint, VectorStorage } from "@/lib/storage/types";
import type { DocId, Version } from "@/types/ids";

/**
 * Brief I1 — "A content change → new version ingested in full. Prior versions
 * retained. `is_latest` flips atomically on both Qdrant (payload) and SQLite
 * (column)."
 *
 * The existing e2e suite covers the single-ingest happy path and the
 * same-content short-circuit. This suite covers the two-version flip.
 */

type FlipRecord = {
  readonly collection: string;
  readonly doc_id: DocId;
  readonly prior_version: Version;
};

const makeInMemoryVector = (): VectorStorage & {
  readonly flips: ReadonlyArray<FlipRecord>;
  readonly points: Map<string, Map<string, VectorPoint>>;
} => {
  const points = new Map<string, Map<string, VectorPoint>>();
  const flips: FlipRecord[] = [];
  return {
    flips,
    points,
    name: "memory",
    ensureCollections: async () => {},
    upsert: async (toWrite) => {
      for (const p of toWrite) {
        const m = points.get(p.collection) ?? new Map<string, VectorPoint>();
        m.set(p.point_id, p);
        points.set(p.collection, m);
      }
    },
    flipIsLatest: async (collection, doc_id, prior_version) => {
      flips.push({ collection, doc_id, prior_version });
      return 0;
    },
    deletePointsByChunkIds: async (_c, ids) => ids.length,
    deletePointsByDocId: async () => 0,
    scrollAllChunkIds: async function* () {},
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
  tempRoot = await mkdtemp(join(tmpdir(), "june-is-latest-"));
  const sidecar = await createSqliteSidecar(join(tempRoot, "june.db"));
  vector = makeInMemoryVector();
  deps = {
    classifier: createStubClassifier(),
    summarizer: createStubSummarizer(),
    embedder: createStubEmbedder(32),
    storage: { sidecar, vector },
  };
});

afterEach(async () => {
  await deps.storage.sidecar.close();
  await rm(tempRoot, { recursive: true, force: true });
});

describe("I1 — is_latest flip on new version", () => {
  test("second ingest with different content produces a new version; prior is_latest=false", async () => {
    const path = join(tempRoot, "doc.md");
    await writeFile(path, "# Title\n\nFirst body with enough text to chunk.\n");
    const first = await ingestPath({
      path,
      deps,
      cliVersion: asVersion("v1"),
    });
    expect(first.processed).toBe(1);

    await writeFile(path, "# Title\n\nSecond body, substantially different.\n");
    const second = await ingestPath({
      path,
      deps,
      cliVersion: asVersion("v2"),
    });
    expect(second.processed).toBe(1);

    const doc_id = deriveDocId(`file://${path}`);
    const versions = await deps.storage.sidecar.listVersionsForDoc(doc_id);
    expect(versions.length).toBe(2);

    const v1 = versions.find((d) => d.version === "v1");
    const v2 = versions.find((d) => d.version === "v2");
    expect(v1).toBeDefined();
    expect(v2).toBeDefined();
    expect(v1!.is_latest).toBe(false);
    expect(v2!.is_latest).toBe(true);
  });

  test("Qdrant flipIsLatest is invoked with (collection, doc_id, prior_version)", async () => {
    const path = join(tempRoot, "doc.md");
    await writeFile(path, "# Title\n\nBody one.\n");
    await ingestPath({ path, deps, cliVersion: asVersion("v1") });

    await writeFile(path, "# Title\n\nBody two, different.\n");
    await ingestPath({ path, deps, cliVersion: asVersion("v2") });

    const doc_id = deriveDocId(`file://${path}`);
    expect(vector.flips.length).toBeGreaterThan(0);
    const flip = vector.flips.find((f) => f.doc_id === doc_id);
    expect(flip).toBeDefined();
    expect(flip!.prior_version).toBe(asVersion("v1"));
    // Collection is one of the aliases (internal / external) — brief §5.1.
    expect(["internal", "external"]).toContain(flip!.collection);
  });

  test("latestDocumentByUri returns the newest version", async () => {
    const path = join(tempRoot, "doc.md");
    await writeFile(path, "# T\n\none.\n");
    await ingestPath({ path, deps, cliVersion: asVersion("v1") });
    await writeFile(path, "# T\n\ntwo.\n");
    await ingestPath({ path, deps, cliVersion: asVersion("v2") });

    const latest = await deps.storage.sidecar.getLatestDocumentByUri(
      `file://${path}`,
    );
    expect(latest).toBeDefined();
    expect(latest!.version).toBe(asVersion("v2"));
    expect(latest!.is_latest).toBe(true);
  });
});
