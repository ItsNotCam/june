// author: Claude
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "@/lib/config";
import { createStubEmbedder } from "@/lib/embedder/stub";
import { createStubSummarizer } from "@/lib/summarizer/stub";
import { createSqliteSidecar } from "@/lib/storage/sqlite";
import { ingestPath } from "@/pipeline/ingest";
import {
  canonicalizeRelativePath,
  deriveDocIdFromRelPath,
  deriveDocIdFromUri,
} from "@/lib/ids";
import { asVersion } from "@/types/ids";
import type { PipelineDeps } from "@/pipeline/factory";
import type { VectorPoint, VectorStorage } from "@/lib/storage/types";

/**
 * End-to-end wiring of the portable doc_id: a file ingested THROUGH the real
 * pipeline (with a `source_root`) must store the source-root-relative id — and the
 * same relative path under a different absolute root must store the SAME id. This
 * covers the Stage-1 threading + `resolveSourceRoot` that the pure-helper tests skip.
 */

const makeInMemoryVector = (): VectorStorage => {
  const points = new Map<string, Map<string, VectorPoint>>();
  return {
    name: "memory",
    ensureCollections: async () => {},
    search: async () => [],
    upsert: async (toWrite) => {
      for (const p of toWrite) {
        const m = points.get(p.collection) ?? new Map<string, VectorPoint>();
        m.set(p.point_id, p);
        points.set(p.collection, m);
      }
    },
    flipIsLatest: async () => 0,
    deletePointsByChunkIds: async (_c, ids) => ids.length,
    deletePointsByDocId: async () => 0,
    scrollAllChunkIds: async function* () {},
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
  tempRoot = await mkdtemp(join(tmpdir(), "june-docid-sr-"));
  const sidecar = await createSqliteSidecar(join(tempRoot, "june.db"));
  deps = {
    summarizer: createStubSummarizer(),
    embedder: createStubEmbedder(32),
    storage: { sidecar, vector: makeInMemoryVector() },
  };
});

afterEach(async () => {
  await deps.storage.sidecar.close();
  await rm(tempRoot, { recursive: true, force: true });
});

const storedDocId = async (filePath: string) => {
  const doc = await deps.storage.sidecar.getLatestDocumentByUri(
    pathToFileURL(filePath).toString(),
  );
  expect(doc).toBeDefined();
  return doc!.doc_id; // branded DocId
};

describe("ingest pipeline — portable doc_id wiring", () => {
  test("stores the source-root-relative doc_id when --source-root is given", async () => {
    const root = await mkdtemp(join(tmpdir(), "sr-root-"));
    try {
      await mkdir(join(root, "docs"), { recursive: true });
      const file = join(root, "docs", "a.md");
      await writeFile(file, "# A\n\nbody enough to chunk.\n");

      const res = await ingestPath({
        path: file,
        deps,
        cliVersion: asVersion("v1"),
        sourceRoot: root,
      });
      expect(res.processed).toBe(1);

      const rel = await canonicalizeRelativePath(file, root);
      expect(rel).toBe("docs/a.md");
      expect(await storedDocId(file)).toBe(deriveDocIdFromRelPath(rel!));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("stores the same doc_id for the same relative path under a different root", async () => {
    const rootA = await mkdtemp(join(tmpdir(), "sr-a-"));
    const rootB = await mkdtemp(join(tmpdir(), "sr-b-"));
    // Independent sidecar for the second root so the two ingests don't interact.
    const sidecarB = await createSqliteSidecar(join(tempRoot, "b.db"));
    const depsB: PipelineDeps = {
      summarizer: createStubSummarizer(),
      embedder: createStubEmbedder(32),
      storage: { sidecar: sidecarB, vector: makeInMemoryVector() },
    };
    try {
      for (const r of [rootA, rootB]) {
        await mkdir(join(r, "docs"), { recursive: true });
        await writeFile(join(r, "docs", "a.md"), `# A from ${r}\n\nbody.\n`);
      }
      await ingestPath({ path: join(rootA, "docs", "a.md"), deps, sourceRoot: rootA });
      await ingestPath({
        path: join(rootB, "docs", "a.md"),
        deps: depsB,
        sourceRoot: rootB,
      });

      const idA = (await deps.storage.sidecar.getLatestDocumentByUri(
        pathToFileURL(join(rootA, "docs", "a.md")).toString(),
      ))!.doc_id;
      const idB = (await sidecarB.getLatestDocumentByUri(
        pathToFileURL(join(rootB, "docs", "a.md")).toString(),
      ))!.doc_id;
      expect(idA).toBe(idB); // portable across roots despite different content
    } finally {
      await sidecarB.close();
      await rm(rootA, { recursive: true, force: true });
      await rm(rootB, { recursive: true, force: true });
    }
  });

  test("editing content under the same root keeps the same doc_id (versioning preserved)", async () => {
    const root = await mkdtemp(join(tmpdir(), "sr-vers-"));
    try {
      await mkdir(join(root, "docs"), { recursive: true });
      const file = join(root, "docs", "a.md");
      await writeFile(file, "# A\n\nfirst body.\n");
      await ingestPath({ path: file, deps, cliVersion: asVersion("v1"), sourceRoot: root });
      const id1 = await storedDocId(file);

      await writeFile(file, "# A\n\nsecond, different body.\n");
      await ingestPath({ path: file, deps, cliVersion: asVersion("v2"), sourceRoot: root });
      const id2 = await storedDocId(file);

      expect(id2).toBe(id1); // same identity across the edit
      const versions = await deps.storage.sidecar.listVersionsForDoc(id1);
      expect(versions.length).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("falls back to the URI-hash doc_id when no source_root resolves", async () => {
    // tempRoot is under /tmp (not a git repo) and no sourceRoot is passed.
    const file = join(tempRoot, "loose.md");
    await writeFile(file, "# Loose\n\nbody.\n");
    await ingestPath({ path: file, deps, cliVersion: asVersion("v1") });
    expect(await storedDocId(file)).toBe(
      deriveDocIdFromUri(pathToFileURL(file).toString()),
    );
  });
});
