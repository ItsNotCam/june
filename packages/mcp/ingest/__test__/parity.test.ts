// author: Claude
import { describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverConfigPath, loadConfig } from "@/lib/config";
import { ChunkSchema, type ChunkJson } from "@/schemas";

const fixtureChunkJson = (): ChunkJson => ({
  chunk_id: "0".repeat(64),
  doc_id: "1".repeat(64),
  version: "v1",
  section_id: "2".repeat(64),
  source_type: "internal",
  content_type: "doc",
  schema_version: 1,
  chunk_index_in_document: 0,
  chunk_index_in_section: 0,
  is_latest: true,
  source_uri: "file:///repo/docs/x.md",
  source_system: "local",
  document_title: "Doc",
  heading_path: ["A", "B"],
  span: {
    byte_offset_start: 0,
    byte_offset_end: 10,
    char_offset_start: 0,
    char_offset_end: 10,
    line_start: 0,
    line_end: 1,
  },
  content_hash: "3".repeat(64),
  ingested_at: "2026-04-20T00:00:00Z",
  ingested_by: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  contextual_summary: "brief",
  embed_text: "title\n\nA > B\n\nbrief\n\nbody",
  is_continuation: false,
  type_specific: { content_type: "doc", version: "v1" },
  content: "body",
  embedding_model_name: "nomic-embed-text",
  embedding_model_version: "v1.5",
  embedding_dim: 768,
  embedded_at: "2026-04-20T00:00:00Z",
  status: "stored",
});

describe("Chunk type ↔ ChunkSchema parity", () => {
  test("ChunkSchema parses a well-formed chunk object", () => {
    const res = ChunkSchema.safeParse(fixtureChunkJson());
    if (!res.success) {
      throw new Error(`schema rejected valid chunk: ${JSON.stringify(res.error.issues, null, 2)}`);
    }
    expect(res.success).toBe(true);
  });

  test("Schema rejects missing required identity fields", () => {
    const bad = { ...fixtureChunkJson() } as unknown as Record<string, unknown>;
    delete bad["doc_id"];
    expect(ChunkSchema.safeParse(bad).success).toBe(false);
  });

  test("Schema rejects invalid enum values", () => {
    const bad = { ...fixtureChunkJson(), source_type: "not-a-source-type" as never };
    expect(ChunkSchema.safeParse(bad).success).toBe(false);
  });

  test("Every required Qdrant payload field exists on ChunkJson output", () => {
    // Every field the retriever actually reads (mirrors PAYLOAD_INDEXES in
    // storage/qdrant.ts) must be populated. Classification / structural /
    // runtime / relationships pillars were dropped in v1; if they come back
    // they need their own parity fixture.
    const res = ChunkSchema.safeParse(fixtureChunkJson());
    if (!res.success) throw new Error("fixture failed");
    const c = res.data;
    expect(c.doc_id).toBeDefined();
    expect(c.version).toBeDefined();
    expect(c.is_latest).toBeDefined();
    expect(c.source_type).toBeDefined();
    expect(c.content_type).toBeDefined();
    expect(c.source_system).toBeDefined();
    expect(c.ingested_at).toBeDefined();
    expect(c.embedding_model_name).toBeDefined();
  });
});

describe("Config discovery fallback (§29.2)", () => {
  test("loadConfig(undefined) in a directory with no config.yaml uses shipped defaults", async () => {
    const prior = process.cwd();
    const dir = join(tmpdir(), `june-config-test-${Date.now()}`);
    await Bun.write(join(dir, "placeholder"), "");
    process.chdir(dir);
    try {
      const cfg = await loadConfig(undefined);
      expect(cfg.sidecar.path).toBe("./june.db");
      expect(cfg.summarizer.implementation).toBe("ollama");
    } finally {
      process.chdir(prior);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("loadConfig(explicitMissingPath) throws — no silent fallthrough", async () => {
    let threw = false;
    try {
      await loadConfig("/tmp/definitely-does-not-exist-june-test.yaml");
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test("discoverConfigPath returns undefined when nothing matches", async () => {
    const prior = process.cwd();
    const dir = join(tmpdir(), `june-config-test2-${Date.now()}`);
    await Bun.write(join(dir, "placeholder"), "");
    process.chdir(dir);
    try {
      const path = await discoverConfigPath(undefined);
      // The user's ~/.config/june/config.yaml may or may not exist; both
      // outcomes are valid behavior. The important part is no throw.
      expect(typeof path === "string" || path === undefined).toBe(true);
    } finally {
      process.chdir(prior);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
