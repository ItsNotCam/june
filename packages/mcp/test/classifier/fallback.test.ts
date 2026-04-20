import { beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@/lib/config";
import {
  buildFallbackClassifierJson,
  filterTags,
  toChunkClassification,
} from "@/lib/classifier/fallback";
import { createStubClassifier } from "@/lib/classifier/stub";
import { createSqliteSidecar } from "@/lib/storage/sqlite";
import { runStage5 } from "@/pipeline/stages/05-classify";
import { asChunkId, asDocId, asRunId, asSectionId, asVersion } from "@/types/ids";
import { TAGS_DEFAULT } from "@/types/vocab";
import type { Classifier } from "@/lib/classifier/types";
import type { UnclassifiedChunk } from "@/types/pipeline";

/**
 * Brief §10 classifier/: fallback values, tag filter + tag_extensions,
 * `vocab_unknown_tag` error row, namespace/project binding merge.
 */

beforeAll(async () => {
  await loadConfig(undefined);
});

const hex = (ch: string): string => ch.repeat(64);
const ulid = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

const makeUnclassifiedChunk = (): UnclassifiedChunk => ({
  chunk_id: asChunkId(hex("0")),
  doc_id: asDocId(hex("1")),
  version: asVersion("v1"),
  section_id: asSectionId(hex("2")),
  source_type: "internal",
  content_type: "doc",
  schema_version: 1,
  chunk_index_in_document: 0,
  chunk_index_in_section: 0,
  is_latest: true,
  source_uri: "file:///x.md",
  source_system: "local",
  document_title: "Doc",
  heading_path: ["Doc", "Section"],
  span: {
    byte_offset_start: 0,
    byte_offset_end: 10,
    char_offset_start: 0,
    char_offset_end: 10,
    line_start: 0,
    line_end: 1,
  },
  content_hash: hex("3"),
  source_modified_at: undefined,
  ingested_at: "2026-04-20T00:00:00Z",
  ingested_by: asRunId(ulid),
  structural_features: {
    token_count: 10,
    char_count: 40,
    contains_code: false,
    code_languages: [],
    has_table: false,
    has_list: false,
    link_density: 0,
    language: undefined,
  },
  is_continuation: false,
  type_specific: { content_type: "doc", version: "v1" },
  content: "body",
  status: "pending",
});

describe("buildFallbackClassifierJson (brief §4 Stage 5, §18.6)", () => {
  test("produces exactly the config.classifier.fallbacks values", () => {
    const fb = buildFallbackClassifierJson();
    expect(fb.category).toBe("reference");
    expect(fb.section_role).toBe("reference");
    expect(fb.answer_shape).toBe("concept");
    expect(fb.audience).toEqual(["engineering"]);
    expect(fb.audience_technicality).toBe(3);
    expect(fb.sensitivity).toBe("internal");
    expect(fb.lifecycle_status).toBe("published");
    expect(fb.stability).toBe("stable");
    expect(fb.temporal_scope).toBe("current");
    expect(fb.source_trust_tier).toBe("derived");
    expect(fb.prerequisites).toEqual([]);
    expect(fb.self_contained).toBe(true);
    expect(fb.negation_heavy).toBe(false);
    expect(fb.tags).toEqual([]);
  });
});

describe("filterTags (brief §4 Stage 5 + §18.5)", () => {
  test("empty proposal yields empty kept + empty dropped", () => {
    const { kept, dropped } = filterTags([]);
    expect(kept).toEqual([]);
    expect(dropped).toEqual([]);
  });

  test("every TAGS_DEFAULT value survives the filter", () => {
    const { kept, dropped } = filterTags(TAGS_DEFAULT);
    expect(new Set(kept)).toEqual(new Set(TAGS_DEFAULT));
    expect(dropped).toEqual([]);
  });

  test("all-unknown proposal yields all-dropped", () => {
    const proposed = ["not-a-tag", "also-not", "third"];
    const { kept, dropped } = filterTags(proposed);
    expect(kept).toEqual([]);
    expect(new Set(dropped)).toEqual(new Set(proposed));
  });

  test("order within kept preserves the proposal's order", () => {
    const { kept } = filterTags(["security", "not-a-tag", "oauth", "xyz", "api"]);
    expect(kept).toEqual(["security", "oauth", "api"]);
  });
});

describe("filterTags respects config.classifier.tag_extensions", () => {
  test("tag listed in tag_extensions is kept", async () => {
    const dir = await mkdtemp(join(tmpdir(), "june-tagext-"));
    try {
      const yamlPath = join(dir, "config.yaml");
      await writeFile(
        yamlPath,
        `classifier:\n  tag_extensions: ["custom-tag-a", "custom-tag-b"]\n`,
      );
      await loadConfig(yamlPath);
      const { kept, dropped } = filterTags([
        "custom-tag-a",
        "oauth",
        "random-unknown",
      ]);
      expect(kept).toContain("custom-tag-a");
      expect(kept).toContain("oauth");
      expect(dropped).toContain("random-unknown");
    } finally {
      await loadConfig(undefined);
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("toChunkClassification (brief §4 Stage 5 — binding merge)", () => {
  test("namespace/project come from the binding, not the classifier json", () => {
    const cls = toChunkClassification(buildFallbackClassifierJson(), {
      namespace: "team-foo",
      project: "proj-bar",
    });
    expect(cls.namespace).toBe("team-foo");
    expect(cls.project).toBe("proj-bar");
  });

  test("audience_technicality clamps to the 1–5 band", () => {
    const zero = toChunkClassification(
      { ...buildFallbackClassifierJson(), audience_technicality: 0 as never },
      { namespace: "x", project: undefined },
    );
    expect(zero.audience_technicality).toBe(1);

    const huge = toChunkClassification(
      { ...buildFallbackClassifierJson(), audience_technicality: 99 as never },
      { namespace: "x", project: undefined },
    );
    expect(huge.audience_technicality).toBe(5);
  });
});

describe("Stub classifier — emits configured fallback for every chunk (brief §18.9)", () => {
  test("stub classification equals buildFallbackClassifierJson fields", async () => {
    const chunk = makeUnclassifiedChunk();
    const stub = createStubClassifier();
    const out = await stub.classify({
      chunk_id: chunk.chunk_id,
      chunk_content: chunk.content,
      document_title: chunk.document_title,
      heading_path: chunk.heading_path,
    });
    const fb = buildFallbackClassifierJson();
    expect(out.classification.category).toBe(fb.category);
    expect(out.classification.audience).toEqual(fb.audience);
    expect(out.classification.self_contained).toBe(fb.self_contained);
    expect(out.classification.tags).toEqual(fb.tags);
  });
});

describe("Stage 5 writes vocab_unknown_tag error row with dropped list (brief §18.5)", () => {
  test("classifier returning unknown tags → error row records comma-separated list", async () => {
    const dir = await mkdtemp(join(tmpdir(), "june-stage5-vocab-"));
    try {
      const dbPath = join(dir, "june.db");
      const sidecar = await createSqliteSidecar(dbPath);

      const runId = asRunId(ulid);
      const chunk = makeUnclassifiedChunk();

      const classifier: Classifier = {
        name: "canned",
        version: "v0",
        classify: async (i) => ({
          chunk_id: i.chunk_id,
          classification: {
            namespace: "placeholder",
            project: undefined,
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
            tags: ["oauth", "made-up-tag", "api", "bogus"],
          },
          raw_response: "",
        }),
      };

      await sidecar.putRun({
        run_id: runId,
        started_at: new Date().toISOString(),
        completed_at: undefined,
        trigger: "cli",
        doc_count: 0,
        chunk_count: 0,
        error_count: 0,
      });

      await runStage5({
        chunks: [chunk],
        classifier,
        sidecar,
        runId,
        binding: { namespace: "personal", project: undefined },
      });
      await sidecar.close();

      const db = new Database(dbPath);
      const rows = db
        .query<
          { error_type: string; error_message: string; stage: string; chunk_id: string | null },
          []
        >(
          "SELECT error_type, error_message, stage, chunk_id FROM ingestion_errors WHERE error_type = 'vocab_unknown_tag'",
        )
        .all();
      expect(rows.length).toBe(1);
      const row = rows[0]!;
      expect(row.stage).toBe("5");
      expect(row.chunk_id).toBe(chunk.chunk_id as string);
      expect(row.error_message).toContain("made-up-tag");
      expect(row.error_message).toContain("bogus");
      expect(row.error_message).toContain(",");
      db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("classifier that throws → classifier_fallback error row; chunk advances with fallback", async () => {
    const dir = await mkdtemp(join(tmpdir(), "june-stage5-throw-"));
    try {
      const dbPath = join(dir, "june.db");
      const sidecar = await createSqliteSidecar(dbPath);
      const runId = asRunId(ulid);
      const chunk = makeUnclassifiedChunk();
      const throwing: Classifier = {
        name: "boom",
        version: "v0",
        classify: async () => {
          throw new Error("explosion deep inside model call");
        },
      };
      await sidecar.putRun({
        run_id: runId,
        started_at: new Date().toISOString(),
        completed_at: undefined,
        trigger: "cli",
        doc_count: 0,
        chunk_count: 0,
        error_count: 0,
      });

      const res = await runStage5({
        chunks: [chunk],
        classifier: throwing,
        sidecar,
        runId,
        binding: { namespace: "personal", project: undefined },
      });
      expect(res.chunks.length).toBe(1);
      expect(res.chunks[0]!.classification.category).toBe("reference");
      expect(res.chunks[0]!.classification.audience).toEqual(["engineering"]);
      expect(res.chunks[0]!.classification.namespace).toBe("personal");
      await sidecar.close();

      const db = new Database(dbPath);
      const rows = db
        .query<{ error_type: string; error_message: string }, []>(
          "SELECT error_type, error_message FROM ingestion_errors WHERE error_type = 'classifier_fallback'",
        )
        .all();
      expect(rows.length).toBe(1);
      expect(rows[0]!.error_message).toContain("explosion");
      db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
