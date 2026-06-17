// author: Claude
import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { CorpusManifest } from "@/types/corpus";
import type { HoldoutQueriesFile } from "@/types/holdout";
import { sha256Hex, writeJsonAtomic } from "@/lib/artifacts";
import {
  buildHoldoutLock,
  verifyHoldoutLock,
  computeHoldoutHash,
  HOLDOUT_LOCK_FILENAME,
} from "@/lib/holdout-lock";

/**
 * Holdout freeze + tamper detection (Phase 4). The lock pins the canonical
 * holdout hash + per-file hashes; verify must catch any post-freeze edit. A
 * holdout has no anti-collusion dimension (the corpus is real, not authored).
 */

const MD = "# Routing\n\nFolders map to routes.\n";

const writeHoldoutDir = async (): Promise<{ dir: string; corpus: CorpusManifest; queries: HoldoutQueriesFile }> => {
  const dir = await mkdtemp(join(tmpdir(), "holdout-lock-"));
  await mkdir(join(dir, "corpus"), { recursive: true });
  await writeFile(join(dir, "corpus", "app-routing.md"), MD, "utf-8");
  const corpus: CorpusManifest = {
    fixture_id: "holdout-abc", schema_version: 1, corpus_author: { provider: "real", model: "nextjs-docs" },
    documents: [{
      filename: "app-routing.md", absolute_path: join(dir, "corpus", "app-routing.md"),
      document_title: "Routing", planted_fact_ids: [], validator_attempts: 1, validator_status: "pass",
      content_hash: sha256Hex(MD),
    }],
  };
  const queries: HoldoutQueriesFile = {
    holdout_id: "holdout-abc", schema_version: 1,
    label_author: { provider: "claude-code-agent", model: "claude-opus-4-8" },
    queries: [
      { id: "q-0001", text: "routes?", expected_doc_filenames: ["app-routing.md"], gold_answer: "folders", unanswerable: false, source_urls: ["u"] },
      { id: "q-0002", text: "unknown?", expected_doc_filenames: [], gold_answer: "", unanswerable: true, source_urls: [] },
    ],
  };
  await writeJsonAtomic(join(dir, "corpus_manifest.json"), corpus);
  await writeJsonAtomic(join(dir, "holdout_queries.json"), queries);
  return { dir, corpus, queries };
};

const freeze = async (dir: string) => {
  const lock = await buildHoldoutLock({
    holdoutDir: dir, name: "holdout-real",
    source: { name: "Next.js docs", url: "u", doc_count: 1 },
    human_signoff: "cam", frozen_at: "2026-06-17T00:00:00Z",
  });
  await writeJsonAtomic(join(dir, HOLDOUT_LOCK_FILENAME), lock);
  return lock;
};

describe("holdout lock", () => {
  test("builds a sealed lock with the right counts + canonical hash", async () => {
    const { dir, corpus, queries } = await writeHoldoutDir();
    const lock = await freeze(dir);
    expect(lock.sealed).toBe(true);
    expect(lock.holdout_hash).toBe(computeHoldoutHash(corpus, queries));
    expect(lock.answerable_count).toBe(1);
    expect(lock.unanswerable_count).toBe(1);
    expect(lock.doc_count).toBe(1);
  });

  test("verify passes on an intact holdout", async () => {
    const { dir } = await writeHoldoutDir();
    await freeze(dir);
    const { ok, divergences } = await verifyHoldoutLock(dir);
    expect(ok).toBe(true);
    expect(divergences).toHaveLength(0);
  });

  test("verify catches a corpus edit", async () => {
    const { dir } = await writeHoldoutDir();
    await freeze(dir);
    await writeFile(join(dir, "corpus", "app-routing.md"), MD + "TAMPERED", "utf-8");
    const { ok, divergences } = await verifyHoldoutLock(dir);
    expect(ok).toBe(false);
    expect(divergences.some((d) => d.includes("app-routing.md"))).toBe(true);
  });

  test("verify catches a queries edit (canonical hash drift)", async () => {
    const { dir, queries } = await writeHoldoutDir();
    await freeze(dir);
    const tampered = { ...queries, queries: [...queries.queries, { id: "q-0003", text: "x?", expected_doc_filenames: [], gold_answer: "", unanswerable: true, source_urls: [] }] };
    await writeJsonAtomic(join(dir, "holdout_queries.json"), tampered);
    const { ok, divergences } = await verifyHoldoutLock(dir);
    expect(ok).toBe(false);
    expect(divergences.some((d) => d.includes("holdout_queries.json") || d.includes("holdout_hash"))).toBe(true);
  });
});
