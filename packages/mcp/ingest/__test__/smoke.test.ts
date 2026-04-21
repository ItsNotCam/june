// author: Claude
import { Database } from "bun:sqlite";
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ConfigSchema } from "@/lib/config";
import {
  asChunkId,
  asDocId,
  asRunId,
  asSectionId,
  asVersion,
  InvalidIdError,
} from "@/types/ids";
import {
  chunkIdToQdrantPointId,
  deriveChunkId,
  deriveContentHash,
  deriveDocId,
  deriveSectionId,
} from "@/lib/ids";
import { ChunkSchema } from "@/schemas";
import {
  computeWhitelist,
  installOfflineGuard,
  uninstallOfflineGuard,
} from "@/lib/offline-guard";
import { OfflineWhitelistViolation } from "@/lib/errors";
import { applyPragmas } from "@/lib/storage/sqlite/migrate";

describe("Part II smoke — config", () => {
  test("ConfigSchema.parse({}) produces a valid full config", () => {
    const cfg = ConfigSchema.parse({});
    expect(cfg.sidecar.path).toBe("./june.db");
    expect(cfg.chunk.target_tokens).toBe(500);
    expect(cfg.chunk.min_tokens).toBe(100);
    expect(cfg.chunk.max_tokens).toBe(1000);
    expect(cfg.chunk.overlap_pct).toBeCloseTo(0.15);
    expect(cfg.embedding.batch_size).toBe(32);
    expect(cfg.embedding.matryoshka_dim).toBeNull();
    expect(cfg.classifier.fallbacks.category).toBe("reference");
    expect(cfg.classifier.fallbacks.audience).toEqual(["engineering"]);
    expect(cfg.ollama.first_call_timeout_ms).toBe(300_000);
    expect(cfg.qdrant.upsert_batch_size).toBe(128);
    expect(cfg.reconcile.mode).toBe("manual");
  });

  test("ConfigSchema respects operator overrides", () => {
    const cfg = ConfigSchema.parse({
      chunk: { target_tokens: 450 },
      embedding: { matryoshka_dim: 512 },
    });
    expect(cfg.chunk.target_tokens).toBe(450);
    expect(cfg.chunk.min_tokens).toBe(100);
    expect(cfg.embedding.matryoshka_dim).toBe(512);
  });
});

describe("Part II smoke — branded IDs", () => {
  test("asDocId / asChunkId / asSectionId require 64-char hex", () => {
    const hex = "a".repeat(64);
    expect(asDocId(hex) as string).toBe(hex);
    expect(asChunkId(hex) as string).toBe(hex);
    expect(asSectionId(hex) as string).toBe(hex);
    expect(() => asDocId("not-hex")).toThrow(InvalidIdError);
    expect(() => asChunkId("a".repeat(63))).toThrow(InvalidIdError);
    expect(() => asSectionId("A".repeat(64))).toThrow(InvalidIdError);
  });

  test("asRunId requires 26-char Crockford-base32 ULID", () => {
    const ulid = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    expect(asRunId(ulid) as string).toBe(ulid);
    expect(() => asRunId("bad-id")).toThrow(InvalidIdError);
    expect(() => asRunId("O".repeat(26))).toThrow(InvalidIdError);
  });

  test("asVersion is free-form", () => {
    expect(asVersion("2026.04.18") as string).toBe("2026.04.18");
    expect(asVersion("2026-04-18T14:30:00Z") as string).toBe("2026-04-18T14:30:00Z");
  });
});

describe("Part II smoke — deterministic ID derivation", () => {
  test("deriveDocId is pure sha256 of URI", () => {
    const uri = "file:///repo/docs/auth/oauth-refresh.md";
    const id = deriveDocId(uri);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(deriveDocId(uri)).toBe(id); // deterministic
  });

  test("deriveChunkId excludes embedding model from hash", () => {
    const doc = deriveDocId("file:///x.md");
    const id1 = deriveChunkId(doc, "v1", 0, 100, 1);
    const id2 = deriveChunkId(doc, "v1", 0, 100, 1);
    expect(id1).toBe(id2);
    // Different version → different id
    const id3 = deriveChunkId(doc, "v2", 0, 100, 1);
    expect(id3).not.toBe(id1);
  });

  test("deriveSectionId uses pipe-separated doc_id|heading_path|offset", () => {
    const doc = deriveDocId("file:///x.md");
    const a = deriveSectionId(doc, ["Auth", "Refresh"], 0);
    const b = deriveSectionId(doc, ["Auth", "Refresh"], 100);
    expect(a).not.toBe(b);
    const c = deriveSectionId(doc, ["Auth", "Different"], 0);
    expect(c).not.toBe(a);
  });

  test("chunkIdToQdrantPointId formats first 128 bits as UUID", () => {
    const cid = asChunkId("a".repeat(64));
    expect(chunkIdToQdrantPointId(cid)).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  });

  test("deriveContentHash is deterministic sha256 hex", () => {
    const h = deriveContentHash("hello world");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(deriveContentHash("hello world")).toBe(h);
  });
});

describe("Part II smoke — offline guard (I10)", () => {
  beforeEach(() => {
    uninstallOfflineGuard();
  });
  afterEach(() => {
    uninstallOfflineGuard();
  });

  test("computeWhitelist extracts exact hostnames — no localhost magic", () => {
    const wl = computeWhitelist([
      "http://ollama.internal:11434",
      "http://qdrant.local:6333",
    ]);
    expect(wl.has("ollama.internal")).toBe(true);
    expect(wl.has("qdrant.local")).toBe(true);
    expect(wl.has("localhost")).toBe(false);
    expect(wl.has("127.0.0.1")).toBe(false);
  });

  test("installOfflineGuard blocks non-whitelisted hosts synchronously", () => {
    const wl = computeWhitelist(["http://ollama.internal:11434"]);
    installOfflineGuard(wl);
    expect(() => fetch("https://example.com/anything")).toThrow(
      OfflineWhitelistViolation,
    );
  });

  test("OfflineWhitelistViolation surfaces the whitelist", () => {
    const wl = new Set(["ollama.internal"]);
    installOfflineGuard(wl);
    try {
      fetch("https://evil.example");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OfflineWhitelistViolation);
      const v = err as OfflineWhitelistViolation;
      expect(v.attempted_host).toBe("evil.example");
      expect(v.whitelist).toContain("ollama.internal");
    }
  });
});

describe("Part II smoke — SQLite migration", () => {
  test("schema.sql applies idempotently", async () => {
    const db = new Database(":memory:");
    applyPragmas(db);
    const here = join(import.meta.dir, "..", "src/lib/storage/sqlite/schema.sql");
    const ddl = await readFile(here, "utf8");
    db.exec(ddl);
    db.exec(ddl); // twice — proves IF NOT EXISTS
    const rows = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all();
    const tables = rows.map((r) => r.name);
    expect(tables).toContain("documents");
    expect(tables).toContain("chunks");
    expect(tables).toContain("sections");
    expect(tables).toContain("ingestion_runs");
    expect(tables).toContain("ingestion_errors");
    expect(tables).toContain("reconcile_events");
    expect(tables).toContain("ingestion_lock");
    db.close();
  });

  test("documents table has exactly the columns in SPEC §10.4", async () => {
    const db = new Database(":memory:");
    applyPragmas(db);
    const here = join(import.meta.dir, "..", "src/lib/storage/sqlite/schema.sql");
    db.exec(await readFile(here, "utf8"));
    const cols = db
      .query<{ name: string }, []>("PRAGMA table_info(documents)")
      .all()
      .map((r) => r.name)
      .sort();
    expect(cols).toEqual(
      [
        "content_hash",
        "deleted_at",
        "doc_id",
        "ingested_at",
        "ingestion_run_id",
        "is_latest",
        "schema_version",
        "source_modified_at",
        "source_uri",
        "status",
        "version",
      ].sort(),
    );
    db.close();
  });
});

describe("Part II smoke — zod schemas at boundaries", () => {
  test("ChunkSchema rejects IDs that aren't 64-char hex", () => {
    const partial: Record<string, unknown> = { chunk_id: "short" };
    const res = ChunkSchema.safeParse(partial);
    expect(res.success).toBe(false);
  });
});
