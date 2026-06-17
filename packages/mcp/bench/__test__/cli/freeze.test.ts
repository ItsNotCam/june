// author: Claude
import { describe, expect, test, beforeAll } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { CorpusManifest } from "@/types/corpus";
import type { FactsFile } from "@/types/facts";
import type { QueriesFile } from "@/types/query";
import { sha256Hex, writeJsonAtomic, readJson, fileExists } from "@/lib/artifacts";
import { FIXTURE_LOCK_FILENAME, type FixtureLock } from "@/lib/fixture-lock";
import { UsageError, FixtureTamperedError } from "@/lib/errors";
import { runFreeze, runVerifyFixture } from "../../cli/freeze";
import { writeTestConfig } from "../helpers";

/**
 * `freeze` / `verify-fixture` end-to-end (Phase 3): the colluded-fixture refusal,
 * the immutability (no-overwrite) guard, and a full freeze → verify → tamper →
 * fail cycle through the CLI runners.
 */

let cfgPath: string;
beforeAll(async () => {
  cfgPath = await writeTestConfig();
});

const writeSource = async (opts: { corpusModel: string; queryModel: string }): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "freeze-src-"));
  await mkdir(join(dir, "corpus"), { recursive: true });
  const md = "# Doc\n\nThe relay threshold is 9.\n";
  await writeFile(join(dir, "corpus", "doc-1.md"), md, "utf-8");
  const facts: FactsFile = {
    fixture_id: "FID", fixture_seed: 7, schema_version: 1, domain_name: "Test",
    generated_at: "2026-01-01T00:00:00Z",
    facts: [{ kind: "atomic", id: "f1", entity: "E", attribute: "a", value: "v", surface_hint: "The relay threshold is 9." }],
  };
  const corpus: CorpusManifest = {
    fixture_id: "FID", schema_version: 1,
    corpus_author: { provider: "claude-code-agent", model: opts.corpusModel },
    documents: [{
      filename: "doc-1.md", absolute_path: join(dir, "corpus", "doc-1.md"), document_title: "Doc",
      planted_fact_ids: ["f1"], validator_attempts: 1, validator_status: "pass", content_hash: sha256Hex(md),
    }],
  };
  const queries: QueriesFile = {
    fixture_id: "FID", schema_version: 1,
    query_author: { provider: "claude-code-agent", model: opts.queryModel },
    queries: [{ id: "q1", tier: "T1", text: "threshold?", expected_fact_ids: ["f1"], anti_leakage_score: null, generation_attempts: 1 }],
  };
  await writeJsonAtomic(join(dir, "facts.json"), facts);
  await writeJsonAtomic(join(dir, "corpus_manifest.json"), corpus);
  await writeJsonAtomic(join(dir, "queries.json"), queries);
  return dir;
};

describe("freeze", () => {
  test("refuses a colluded fixture (same author model) without --allow-collusion", async () => {
    const src = await writeSource({ corpusModel: "sonnet", queryModel: "sonnet" });
    const out = await mkdtemp(join(tmpdir(), "freeze-out-"));
    await expect(
      runFreeze([src, "--name", "fx", "--out", out, "--config", cfgPath]),
    ).rejects.toBeInstanceOf(UsageError);
  });

  test("freezes a clean (distinct-author) fixture: writes the lock with anti_collusion=true", async () => {
    const src = await writeSource({ corpusModel: "claude-sonnet", queryModel: "claude-opus" });
    const out = await mkdtemp(join(tmpdir(), "freeze-out-"));
    await runFreeze([src, "--name", "clean-fx", "--signoff", "cam", "--out", out, "--config", cfgPath]);

    const dest = join(out, "clean-fx");
    expect(await fileExists(join(dest, FIXTURE_LOCK_FILENAME))).toBe(true);
    expect(await fileExists(join(dest, "corpus", "doc-1.md"))).toBe(true);
    const lock = (await readJson(join(dest, FIXTURE_LOCK_FILENAME))) as FixtureLock;
    expect(lock.authoring.anti_collusion).toBe(true);
    expect(lock.human_signoff).toBe("cam");
    // The frozen manifest's absolute_path was rewritten to the frozen location.
    const manifest = (await readJson(join(dest, "corpus_manifest.json"))) as CorpusManifest;
    expect(manifest.documents[0]!.absolute_path).toBe(join(dest, "corpus", "doc-1.md"));

    // verify-fixture passes on the freshly frozen dir.
    await runVerifyFixture([dest, "--config", cfgPath]);
  });

  test("allows a colluded fixture with --allow-collusion (lock records anti_collusion=false)", async () => {
    const src = await writeSource({ corpusModel: "sonnet", queryModel: "sonnet" });
    const out = await mkdtemp(join(tmpdir(), "freeze-out-"));
    await runFreeze([src, "--name", "rigged", "--allow-collusion", "--out", out, "--config", cfgPath]);
    const lock = (await readJson(join(out, "rigged", FIXTURE_LOCK_FILENAME))) as FixtureLock;
    expect(lock.authoring.anti_collusion).toBe(false);
  });

  test("refuses to overwrite an existing frozen fixture without --force", async () => {
    const src = await writeSource({ corpusModel: "sonnet", queryModel: "opus" });
    const out = await mkdtemp(join(tmpdir(), "freeze-out-"));
    await runFreeze([src, "--name", "fx", "--out", out, "--config", cfgPath]);
    await expect(
      runFreeze([src, "--name", "fx", "--out", out, "--config", cfgPath]),
    ).rejects.toBeInstanceOf(UsageError);
    // --force succeeds.
    await runFreeze([src, "--name", "fx", "--force", "--out", out, "--config", cfgPath]);
  });

  test("rejects a bad --name", async () => {
    const src = await writeSource({ corpusModel: "sonnet", queryModel: "opus" });
    const out = await mkdtemp(join(tmpdir(), "freeze-out-"));
    await expect(
      runFreeze([src, "--name", "../escape", "--out", out, "--config", cfgPath]),
    ).rejects.toBeInstanceOf(UsageError);
  });
});

describe("verify-fixture", () => {
  test("fails with FixtureTamperedError after a corpus edit", async () => {
    const src = await writeSource({ corpusModel: "sonnet", queryModel: "opus" });
    const out = await mkdtemp(join(tmpdir(), "freeze-out-"));
    await runFreeze([src, "--name", "fx", "--out", out, "--config", cfgPath]);
    const dest = join(out, "fx");
    await writeFile(join(dest, "corpus", "doc-1.md"), "# Doc\n\nTAMPERED.\n", "utf-8");
    await expect(runVerifyFixture([dest, "--config", cfgPath])).rejects.toBeInstanceOf(FixtureTamperedError);
  });

  test("errors on a non-frozen dir (no lock)", async () => {
    const src = await writeSource({ corpusModel: "sonnet", queryModel: "opus" });
    await expect(runVerifyFixture([src, "--config", cfgPath])).rejects.toBeInstanceOf(UsageError);
  });
});
