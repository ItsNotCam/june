// author: Claude
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import {
  canonicalizeRelativePathSync,
  deriveDocIdFromRelPath,
  deriveDocIdFromUri,
} from "@june/mcp-ingest";
import { juneDocId } from "@/lib/ids";

/**
 * The bench `juneDocId` mirror MUST derive byte-identical ids to ingest's shared
 * helpers — a drift here silently breaks `--skip-ingest` retrieval (0% recall).
 */

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "bench-docid-"));
  await mkdir(join(root, "pkg", "corpus"), { recursive: true });
  await writeFile(join(root, "pkg", "corpus", "x.md"), "# X\n\nbody\n");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("juneDocId mirrors ingest's shared derivation", () => {
  test("matches ingest deriveDocIdFromRelPath for a file under the root", () => {
    const abs = join(root, "pkg", "corpus", "x.md");
    const rel = canonicalizeRelativePathSync(abs, root);
    expect(rel).toBe("pkg/corpus/x.md");
    expect(juneDocId(abs, root)).toBe(deriveDocIdFromRelPath(rel!) as string);
  });

  test("yields the same id for the same relative path under different roots", async () => {
    const rootB = await mkdtemp(join(tmpdir(), "bench-docid-b-"));
    try {
      await mkdir(join(rootB, "pkg", "corpus"), { recursive: true });
      await writeFile(join(rootB, "pkg", "corpus", "x.md"), "# X\n\ndifferent body\n");
      expect(juneDocId(join(rootB, "pkg", "corpus", "x.md"), rootB)).toBe(
        juneDocId(join(root, "pkg", "corpus", "x.md"), root),
      );
    } finally {
      await rm(rootB, { recursive: true, force: true });
    }
  });

  test("falls back to ingest's URI derivation for a file outside the root", async () => {
    const outside = await mkdtemp(join(tmpdir(), "bench-docid-out-"));
    try {
      const abs = join(outside, "y.md");
      await writeFile(abs, "y\n");
      const uri = pathToFileURL(realpathSync(abs)).toString();
      expect(juneDocId(abs, root)).toBe(deriveDocIdFromUri(uri) as string);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  test("returns a 64-char hex id using the default source_root", () => {
    const abs = join(root, "pkg", "corpus", "x.md");
    expect(juneDocId(abs)).toMatch(/^[0-9a-f]{64}$/);
  });
});
