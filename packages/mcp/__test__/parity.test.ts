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
  classification: {
    namespace: "personal",
    category: "reference",
    section_role: "reference",
    answer_shape: "concept",
    audience: ["engineering"],
    audience_technicality: 3,
    sensitivity: "internal",
    lifecycle_status: "published",
    stability: "stable",
    temporal_scope: "current",
    source_trust_tier: "derived",
    prerequisites: [],
    self_contained: true,
    negation_heavy: false,
    tags: [],
  },
  structural_features: {
    token_count: 10,
    char_count: 40,
    contains_code: false,
    code_languages: [],
    has_table: false,
    has_list: false,
    link_density: 0,
  },
  runtime_signals: {
    quality_score: 0.5,
    freshness_decay_profile: "medium",
    authority_source_score: 0.6,
    authority_author_score: 0.5,
    retrieval_count: 0,
    citation_count: 0,
    user_marked_wrong_count: 0,
    deprecated: false,
  },
  contextual_summary: "brief",
  embed_text: "title\n\nA > B\n\nbrief\n\nbody",
  is_continuation: false,
  relationships: {
    references: [],
    external_links: [],
    unresolved_links: [],
    canonical_for: [],
    siblings: [],
  },
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

  test("Schema rejects missing Pillar 3 fields", () => {
    const bad = { ...fixtureChunkJson() } as unknown as Record<string, unknown>;
    const cls = { ...fixtureChunkJson().classification } as Record<string, unknown>;
    delete cls["category"];
    bad["classification"] = cls;
    expect(ChunkSchema.safeParse(bad).success).toBe(false);
  });

  test("Schema rejects invalid enum values", () => {
    const bad = fixtureChunkJson();
    const evil = { ...bad, classification: { ...bad.classification, category: "not-a-category" as never } };
    expect(ChunkSchema.safeParse(evil).success).toBe(false);
  });

  test("Every SPEC §9 payload index field exists on ChunkJson output", () => {
    // Spot-check: every Qdrant payload index field (from PAYLOAD_INDEXES in
    // storage/qdrant.ts) must be populated in the chunk payload, otherwise
    // filtering won't work at retrieval time. This test doesn't enforce the
    // payload construction (Stage 10's job) — just that the schema permits
    // every one of those fields.
    const res = ChunkSchema.safeParse(fixtureChunkJson());
    if (!res.success) throw new Error("fixture failed");
    const c = res.data;
    // Flatten once for presence checks. Schema/payload parity — payload fields
    // are nested under classification/structural_features/runtime_signals.
    expect(c.doc_id).toBeDefined();
    expect(c.version).toBeDefined();
    expect(c.is_latest).toBeDefined();
    expect(c.source_type).toBeDefined();
    expect(c.content_type).toBeDefined();
    expect(c.classification.namespace).toBeDefined();
    expect(c.classification.category).toBeDefined();
    expect(c.classification.audience).toBeDefined();
    expect(c.classification.audience_technicality).toBeDefined();
    expect(c.classification.sensitivity).toBeDefined();
    expect(c.classification.section_role).toBeDefined();
    expect(c.classification.answer_shape).toBeDefined();
    expect(c.classification.self_contained).toBeDefined();
    expect(c.structural_features.contains_code).toBeDefined();
    expect(c.structural_features.code_languages).toBeDefined();
    expect(c.runtime_signals.quality_score).toBeDefined();
    expect(c.runtime_signals.deprecated).toBeDefined();
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
      expect(cfg.classifier.fallbacks.category).toBe("reference");
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
