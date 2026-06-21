// author: Claude
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalizeRelativePath,
  canonicalizeRelativePathSync,
  deriveContentHashBytes,
  deriveDocIdFromRelPath,
  deriveDocIdFromUri,
  relativizeAndNormalize,
} from "@/lib/ids";

/**
 * Phase-1 contract: `doc_id` is derived from a source-root-RELATIVE path so it is
 * identical across git worktrees (portability) yet stable when a file's CONTENT
 * changes (versioning). See plan: portable-doc_id, Option A.
 */

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "docid-port-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("doc_id portability — relative-path derivation", () => {
  test("same repo-relative path under different absolute roots yields the same doc_id", async () => {
    const rootA = await mkdtemp(join(tmpdir(), "rootA-"));
    const rootB = await mkdtemp(join(tmpdir(), "rootB-"));
    try {
      for (const r of [rootA, rootB]) {
        await mkdir(join(r, "pkg", "corpus"), { recursive: true });
        await writeFile(join(r, "pkg", "corpus", "x.md"), "# X\n\nbody\n");
      }
      const relA = await canonicalizeRelativePath(
        join(rootA, "pkg", "corpus", "x.md"),
        rootA,
      );
      const relB = await canonicalizeRelativePath(
        join(rootB, "pkg", "corpus", "x.md"),
        rootB,
      );
      expect(relA).toBe("pkg/corpus/x.md");
      expect(relB).toBe("pkg/corpus/x.md");
      expect(deriveDocIdFromRelPath(relA!)).toBe(deriveDocIdFromRelPath(relB!));
    } finally {
      await rm(rootA, { recursive: true, force: true });
      await rm(rootB, { recursive: true, force: true });
    }
  });

  test("different relative paths yield different doc_ids", () => {
    expect(deriveDocIdFromRelPath("pkg/a.md")).not.toBe(
      deriveDocIdFromRelPath("pkg/b.md"),
    );
  });

  test("changed content at the same path keeps the same doc_id", async () => {
    const dir = await mkdir(join(root, "vers"), { recursive: true });
    const p = join(root, "vers", "doc.md");
    await writeFile(p, "# V1\n\nfirst\n");
    const rel1 = await canonicalizeRelativePath(p, root);
    await writeFile(p, "# V2\n\nsecond, different\n");
    const rel2 = await canonicalizeRelativePath(p, root);
    expect(rel1).toBe(rel2);
    expect(deriveDocIdFromRelPath(rel1!)).toBe(deriveDocIdFromRelPath(rel2!));
    void dir;
  });

  test("content change yields a new content_hash but the same doc_id", () => {
    const a = deriveContentHashBytes(new TextEncoder().encode("first"));
    const b = deriveContentHashBytes(new TextEncoder().encode("second"));
    expect(a).not.toBe(b); // content_hash tracks content
    // doc_id (from a fixed relpath) is independent of content:
    expect(deriveDocIdFromRelPath("vers/doc.md")).toBe(
      deriveDocIdFromRelPath("vers/doc.md"),
    );
  });
});

describe("doc_id portability — fallbacks", () => {
  test("a virtual mcp:// URI derives a stable URI-domain doc_id", () => {
    const id = deriveDocIdFromUri("mcp://session/abc/note.md");
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(deriveDocIdFromUri("mcp://session/abc/note.md")).toBe(id); // deterministic
  });

  test("relpath and uri domains never collide for the same string", () => {
    expect(deriveDocIdFromRelPath("a/b.md")).not.toBe(
      deriveDocIdFromUri("a/b.md"),
    );
  });

  test("a file outside the source_root canonicalizes to null (caller uses URI fallback)", async () => {
    const inside = await mkdtemp(join(tmpdir(), "inside-"));
    const outside = await mkdtemp(join(tmpdir(), "outside-"));
    try {
      const f = join(outside, "x.md");
      await writeFile(f, "x\n");
      expect(await canonicalizeRelativePath(f, inside)).toBeNull();
    } finally {
      await rm(inside, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("doc_id portability — symlinks", () => {
  test("a symlinked root and the real root yield the same doc_id", async () => {
    const real = await mkdtemp(join(tmpdir(), "realroot-"));
    const link = join(await mkdtemp(join(tmpdir(), "linkparent-")), "linkroot");
    try {
      await mkdir(join(real, "d"), { recursive: true });
      await writeFile(join(real, "d", "a.md"), "a\n");
      await symlink(real, link);
      const viaReal = await canonicalizeRelativePath(join(real, "d", "a.md"), real);
      const viaLink = await canonicalizeRelativePath(join(link, "d", "a.md"), link);
      expect(viaReal).toBe("d/a.md");
      expect(viaLink).toBe("d/a.md");
      expect(deriveDocIdFromRelPath(viaReal!)).toBe(
        deriveDocIdFromRelPath(viaLink!),
      );
    } finally {
      await rm(real, { recursive: true, force: true });
      await rm(link, { recursive: true, force: true });
    }
  });

  test("a symlinked file resolves to its real path's relative id", async () => {
    const r = await mkdtemp(join(tmpdir(), "symfile-"));
    try {
      await writeFile(join(r, "real.md"), "x\n");
      await symlink(join(r, "real.md"), join(r, "link.md"));
      const viaReal = await canonicalizeRelativePath(join(r, "real.md"), r);
      const viaLink = await canonicalizeRelativePath(join(r, "link.md"), r);
      expect(viaReal).toBe("real.md");
      expect(viaLink).toBe("real.md");
    } finally {
      await rm(r, { recursive: true, force: true });
    }
  });

  test("sync canonicalizer matches the async one", async () => {
    await mkdir(join(root, "s"), { recursive: true });
    await writeFile(join(root, "s", "y.md"), "y\n");
    const a = await canonicalizeRelativePath(join(root, "s", "y.md"), root);
    const s = canonicalizeRelativePathSync(join(root, "s", "y.md"), root);
    expect(s).toBe(a);
    expect(s).toBe("s/y.md");
  });
});

describe("relativizeAndNormalize — pure core", () => {
  test("returns the posix relative path with no leading slash", () => {
    expect(relativizeAndNormalize("/root/a/b.md", "/root")).toBe("a/b.md");
  });

  test("returns null when the path is not under the root", () => {
    expect(relativizeAndNormalize("/other/a.md", "/root")).toBeNull();
    expect(relativizeAndNormalize("/root", "/root")).toBeNull(); // the root itself
  });

  test("NFC-normalizes the relative path", () => {
    // "café.md" with a combining acute (NFD) must normalize to NFC.
    const nfd = "café.md";
    const out = relativizeAndNormalize(`/root/${nfd}`, "/root");
    expect(out).toBe("café.md".normalize("NFC"));
    expect(out).toBe(out!.normalize("NFC"));
  });
});
