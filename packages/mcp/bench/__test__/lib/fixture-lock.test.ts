// author: Claude
import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { FactsFile } from "@/types/facts";
import type { CorpusManifest } from "@/types/corpus";
import type { QueriesFile } from "@/types/query";
import { sha256Hex, writeJsonAtomic } from "@/lib/artifacts";
import {
  buildFixtureLock,
  verifyFixtureLock,
  computeFixtureHash,
  FIXTURE_LOCK_FILENAME,
} from "@/lib/fixture-lock";

/**
 * Fixture freezing + tamper detection (Phase 3). The lock records a canonical
 * hash, a per-file SHA-256 manifest, and the authoring provenance; verify must
 * catch ANY post-freeze edit and flag same-model authorship (anti-collusion).
 */

const facts = (over: Partial<FactsFile> = {}): FactsFile => ({
  fixture_id: "FID",
  fixture_seed: 7,
  schema_version: 1,
  domain_name: "Test Domain",
  generated_at: "2026-01-01T00:00:00Z",
  facts: [
    { kind: "atomic", id: "f1", entity: "E", attribute: "a", value: "v", surface_hint: "The relay threshold is 9." },
  ],
  ...over,
});

const queries = (queryModel: string): QueriesFile => ({
  fixture_id: "FID",
  schema_version: 1,
  query_author: { provider: "claude-code-agent", model: queryModel },
  queries: [
    { id: "q1", tier: "T1", text: "threshold?", expected_fact_ids: ["f1"], anti_leakage_score: null, generation_attempts: 1 },
    { id: "q2", tier: "T2", text: "what limit?", expected_fact_ids: ["f1"], anti_leakage_score: 0.2, generation_attempts: 1 },
    { id: "q3", tier: "T3", text: "scenario", expected_fact_ids: ["f1"], anti_leakage_score: 0.3, generation_attempts: 1 },
  ],
});

/** Writes a complete synthetic fixture dir (facts + corpus + 1 md + queries). */
const writeFixture = async (opts: { corpusModel: string; queryModel: string }): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "fix-"));
  await mkdir(join(dir, "corpus"), { recursive: true });
  const md = "# Doc\n\nThe relay threshold is 9.\n";
  await writeFile(join(dir, "corpus", "doc-1.md"), md, "utf-8");
  const corpus: CorpusManifest = {
    fixture_id: "FID",
    schema_version: 1,
    documents: [
      {
        filename: "doc-1.md",
        absolute_path: join(dir, "corpus", "doc-1.md"),
        document_title: "Doc",
        planted_fact_ids: ["f1"],
        validator_attempts: 1,
        validator_status: "pass",
        content_hash: sha256Hex(md),
      },
    ],
    corpus_author: { provider: "claude-code-agent", model: opts.corpusModel },
  };
  await writeJsonAtomic(join(dir, "facts.json"), facts());
  await writeJsonAtomic(join(dir, "corpus_manifest.json"), corpus);
  await writeJsonAtomic(join(dir, "queries.json"), queries(opts.queryModel));
  return dir;
};

const freeze = async (dir: string): Promise<void> => {
  const lock = await buildFixtureLock({
    fixtureDir: dir,
    name: "test-fixture",
    threshold: 0.4,
    human_signoff: "cam",
    frozen_at: "2026-06-17T00:00:00Z",
  });
  await writeJsonAtomic(join(dir, FIXTURE_LOCK_FILENAME), lock);
};

describe("computeFixtureHash", () => {
  test("is stable for identical inputs and order-independent in corpus hashes", () => {
    const f = facts();
    const q = queries("opus");
    const c1: CorpusManifest = { fixture_id: "FID", schema_version: 1, corpus_author: { provider: "x", model: "sonnet" }, documents: [
      { filename: "a", absolute_path: "/a", document_title: "A", planted_fact_ids: [], validator_attempts: 1, validator_status: "pass", content_hash: "hash-a" },
      { filename: "b", absolute_path: "/b", document_title: "B", planted_fact_ids: [], validator_attempts: 1, validator_status: "pass", content_hash: "hash-b" },
    ] };
    // Same docs in reversed order → same hash (corpus hashes are sorted).
    const c2: CorpusManifest = { ...c1, documents: [c1.documents[1]!, c1.documents[0]!] };
    expect(computeFixtureHash(f, c1, q)).toBe(computeFixtureHash(f, c2, q));
  });

  test("changes when a corpus content hash changes", () => {
    const f = facts();
    const q = queries("opus");
    const base: CorpusManifest = { fixture_id: "FID", schema_version: 1, corpus_author: { provider: "x", model: "s" }, documents: [
      { filename: "a", absolute_path: "/a", document_title: "A", planted_fact_ids: [], validator_attempts: 1, validator_status: "pass", content_hash: "hash-a" },
    ] };
    const edited: CorpusManifest = { ...base, documents: [{ ...base.documents[0]!, content_hash: "hash-a-EDITED" }] };
    expect(computeFixtureHash(f, base, q)).not.toBe(computeFixtureHash(f, edited, q));
  });
});

describe("buildFixtureLock", () => {
  test("records provenance, per-tier counts, anti-leakage, and anti_collusion=true for distinct authors", async () => {
    const dir = await writeFixture({ corpusModel: "claude-sonnet", queryModel: "claude-opus" });
    const lock = await buildFixtureLock({ fixtureDir: dir, name: "fx", threshold: 0.4, human_signoff: "cam", frozen_at: "t" });
    expect(lock.authoring.anti_collusion).toBe(true);
    expect(lock.authoring.corpus_author.model).toBe("claude-sonnet");
    expect(lock.authoring.query_author.model).toBe("claude-opus");
    expect(lock.query_count).toBe(3);
    expect(lock.per_tier_counts).toEqual({ T1: 1, T2: 1, T3: 1 });
    expect(lock.anti_leakage.scored_count).toBe(2); // T1 score is null
    expect(lock.anti_leakage.max_score).toBeCloseTo(0.3, 12);
    expect(lock.anti_leakage.mean_score).toBeCloseTo(0.25, 12);
    // facts.json + corpus_manifest.json + queries.json + corpus/doc-1.md = 4 files.
    expect(lock.files.map((f) => f.path).sort()).toEqual(["corpus/doc-1.md", "corpus_manifest.json", "facts.json", "queries.json"]);
    await rm(dir, { recursive: true, force: true });
  });

  test("anti_collusion=false when corpus and queries share a model", async () => {
    const dir = await writeFixture({ corpusModel: "sonnet", queryModel: "sonnet" });
    const lock = await buildFixtureLock({ fixtureDir: dir, name: "fx", threshold: 0.4, human_signoff: null, frozen_at: "t" });
    expect(lock.authoring.anti_collusion).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("verifyFixtureLock", () => {
  test("OK immediately after freeze", async () => {
    const dir = await writeFixture({ corpusModel: "sonnet", queryModel: "opus" });
    await freeze(dir);
    const v = await verifyFixtureLock(dir);
    expect(v.ok).toBe(true);
    expect(v.divergences).toHaveLength(0);
    await rm(dir, { recursive: true, force: true });
  });

  test("detects an edited corpus file (content + canonical hash drift)", async () => {
    const dir = await writeFixture({ corpusModel: "sonnet", queryModel: "opus" });
    await freeze(dir);
    await writeFile(join(dir, "corpus", "doc-1.md"), "# Doc\n\nTAMPERED.\n", "utf-8");
    const v = await verifyFixtureLock(dir);
    expect(v.ok).toBe(false);
    expect(v.divergences.some((d) => d.includes("content changed: corpus/doc-1.md"))).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });

  test("detects an edited queries.json", async () => {
    const dir = await writeFixture({ corpusModel: "sonnet", queryModel: "opus" });
    await freeze(dir);
    const q = queries("opus");
    q.queries[0]!.text = "EDITED";
    await writeJsonAtomic(join(dir, "queries.json"), q);
    const v = await verifyFixtureLock(dir);
    expect(v.ok).toBe(false);
    expect(v.divergences.some((d) => d.includes("queries.json"))).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });

  test("detects an unexpected new file in the fixture", async () => {
    const dir = await writeFixture({ corpusModel: "sonnet", queryModel: "opus" });
    await freeze(dir);
    await writeFile(join(dir, "corpus", "doc-2.md"), "# Sneaky\n", "utf-8");
    const v = await verifyFixtureLock(dir);
    expect(v.ok).toBe(false);
    expect(v.divergences.some((d) => d.includes("unexpected new file: corpus/doc-2.md"))).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });
});
