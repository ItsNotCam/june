import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@/lib/config";
import { createSqliteSidecar } from "@/lib/storage/sqlite";
import { runStage7, _internal } from "@/pipeline/stages/07-link";
import { deriveDocId, deriveSectionId } from "@/lib/ids";
import { asChunkId, asRunId, asVersion } from "@/types/ids";
import type { ClassifiedChunk } from "@/pipeline/stages/05-classify";
import type { SummarizedChunk } from "@/pipeline/stages/06-summarize";
import type { Document } from "@/types/document";
import type { Section } from "@/types/section";
import type { ChunkSpan } from "@/types/chunk";

/**
 * Brief §4 Stage 7 — link classification + reference resolution:
 *   - HTTP(S) → external_links (fragment appended)
 *   - mailto/tel/javascript/data → ignored
 *   - Relative/absolute/file URI → sidecar.getLatestDocumentByUri → references
 *   - #fragment on a resolved doc → slug-match heading_path → section_id
 *   - Pure #fragment → unresolved_links
 */

beforeAll(async () => {
  await loadConfig(undefined);
});

const hex = (ch: string): string => ch.repeat(64);
const runId = asRunId("01ARZ3NDEKTSV4RRFFQ69G5FAV");
const defaultSpan: ChunkSpan = {
  byte_offset_start: 0,
  byte_offset_end: 10,
  char_offset_start: 0,
  char_offset_end: 10,
  line_start: 0,
  line_end: 1,
};

const makeSummarizedChunk = (
  source_uri: string,
  content: string,
): SummarizedChunk => {
  const doc_id = deriveDocId(source_uri);
  const version = asVersion("v1");
  const classified: ClassifiedChunk = {
    chunk_id: asChunkId(hex("0")),
    doc_id,
    version,
    section_id: deriveSectionId(doc_id, ["Doc"], 0),
    source_type: "internal",
    content_type: "doc",
    schema_version: 1,
    chunk_index_in_document: 0,
    chunk_index_in_section: 0,
    is_latest: true,
    source_uri,
    source_system: "local",
    document_title: "Doc",
    heading_path: ["Doc"],
    span: defaultSpan,
    content_hash: hex("1"),
    source_modified_at: undefined,
    ingested_at: "2026-04-20T00:00:00Z",
    ingested_by: runId,
    structural_features: {
      token_count: 10,
      char_count: content.length,
      contains_code: false,
      code_languages: [],
      has_table: false,
      has_list: false,
      link_density: 0,
      language: undefined,
    },
    is_continuation: false,
    type_specific: { content_type: "doc", version: "v1" },
    content,
    status: "pending",
    classification: {
      namespace: "personal",
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
      tags: [],
    },
  };
  return { ...classified, contextual_summary: "stub summary" };
};

const makeDocument = (source_uri: string, version: string): Document => ({
  doc_id: deriveDocId(source_uri),
  version: asVersion(version),
  schema_version: 1,
  source_uri,
  source_system: "local",
  source_type: "internal",
  namespace: "personal",
  project: undefined,
  document_title: "Target",
  content_hash: hex("a"),
  byte_length: 10,
  source_modified_at: undefined,
  ingested_at: "2026-04-20T00:00:00Z",
  ingested_by: runId,
  status: "stored",
  is_latest: true,
  deleted_at: undefined,
  doc_category: undefined,
  doc_sensitivity: undefined,
  doc_lifecycle_status: undefined,
  frontmatter: {},
});

describe("_internal.githubSlug — GitHub-style anchor slug", () => {
  test("lowercases + kebab-cases headings", () => {
    expect(_internal.githubSlug("Hello World")).toBe("hello-world");
  });

  test("strips punctuation (except hyphen)", () => {
    expect(_internal.githubSlug("What's new?")).toBe("whats-new");
  });

  test("collapses whitespace", () => {
    expect(_internal.githubSlug("One   Two   Three")).toBe("one-two-three");
  });

  test("preserves hyphens within the heading", () => {
    expect(_internal.githubSlug("pre-built slugs")).toBe("pre-built-slugs");
  });
});

describe("Stage 7 — link classification (brief §4)", () => {
  test("HTTP URL → external_links (fragment preserved)", async () => {
    const sidecar = await createSqliteSidecar(":memory:");
    const chunk = makeSummarizedChunk(
      "file:///src/chunk.md",
      "See [the docs](https://example.com/page#anchor) and [raw](http://foo.example).",
    );
    const out = await runStage7({ chunks: [chunk], sidecar });
    const rel = out.chunks[0]!.relationships;
    expect(rel.external_links).toContain("https://example.com/page#anchor");
    expect(rel.external_links).toContain("http://foo.example");
    expect(rel.references.length).toBe(0);
    await sidecar.close();
  });

  test("mailto / tel / javascript / data URIs are ignored", async () => {
    const sidecar = await createSqliteSidecar(":memory:");
    const chunk = makeSummarizedChunk(
      "file:///x.md",
      "Email [us](mailto:a@b.c), call [us](tel:+15551234), " +
        "[click](javascript:alert(1)), and [blob](data:text/plain;base64,xx).",
    );
    const out = await runStage7({ chunks: [chunk], sidecar });
    const rel = out.chunks[0]!.relationships;
    expect(rel.external_links).toEqual([]);
    expect(rel.references).toEqual([]);
    expect(rel.unresolved_links).toEqual([]);
    await sidecar.close();
  });

  test("pure in-document #fragment → unresolved_links", async () => {
    const sidecar = await createSqliteSidecar(":memory:");
    const chunk = makeSummarizedChunk(
      "file:///x.md",
      "Jump to [later section](#later) in this doc.",
    );
    const out = await runStage7({ chunks: [chunk], sidecar });
    expect(out.chunks[0]!.relationships.unresolved_links).toContain("#later");
    await sidecar.close();
  });
});

describe("Stage 7 — internal link resolution via sidecar (brief §4)", () => {
  test("relative path to an existing doc → references.doc_id", async () => {
    const root = await mkdtemp(join(tmpdir(), "june-stage7-"));
    try {
      const target = join(root, "target.md");
      const source = join(root, "source.md");
      await writeFile(target, "# Target\n\nbody.");
      await writeFile(source, "content");

      const sidecar = await createSqliteSidecar(join(root, "june.db"));
      await sidecar.putRun({
        run_id: runId,
        started_at: new Date().toISOString(),
        completed_at: undefined,
        trigger: "cli",
        doc_count: 0,
        chunk_count: 0,
        error_count: 0,
      });
      const targetUri = `file://${target}`;
      const doc = makeDocument(targetUri, "v1");
      const tx = await sidecar.begin();
      await sidecar.upsertDocument(tx, doc);
      await tx.commit();

      const chunk = makeSummarizedChunk(
        `file://${source}`,
        "Read [the target](./target.md) for details.",
      );
      const out = await runStage7({ chunks: [chunk], sidecar });
      const rel = out.chunks[0]!.relationships;
      expect(rel.references).toEqual([{ doc_id: doc.doc_id }]);
      expect(rel.external_links).toEqual([]);
      expect(rel.unresolved_links).toEqual([]);
      await sidecar.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("relative link that does not resolve → unresolved_links", async () => {
    const root = await mkdtemp(join(tmpdir(), "june-stage7-missing-"));
    try {
      const source = join(root, "source.md");
      await writeFile(source, "content");
      const sidecar = await createSqliteSidecar(join(root, "june.db"));

      const chunk = makeSummarizedChunk(
        `file://${source}`,
        "Look at [not a real doc](./never-existed.md).",
      );
      const out = await runStage7({ chunks: [chunk], sidecar });
      expect(out.chunks[0]!.relationships.unresolved_links).toContain(
        "./never-existed.md",
      );
      expect(out.chunks[0]!.relationships.references).toEqual([]);
      await sidecar.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("fragment matches a heading on the resolved doc → references.section_id", async () => {
    const root = await mkdtemp(join(tmpdir(), "june-stage7-frag-"));
    try {
      const target = join(root, "target.md");
      const source = join(root, "source.md");
      await writeFile(target, "stub");
      await writeFile(source, "stub");

      const sidecar = await createSqliteSidecar(join(root, "june.db"));
      await sidecar.putRun({
        run_id: runId,
        started_at: new Date().toISOString(),
        completed_at: undefined,
        trigger: "cli",
        doc_count: 0,
        chunk_count: 0,
        error_count: 0,
      });
      const targetUri = `file://${target}`;
      const doc = makeDocument(targetUri, "v1");
      const section: Section = {
        section_id: deriveSectionId(doc.doc_id, ["Target", "Deploy Steps"], 100),
        doc_id: doc.doc_id,
        version: doc.version,
        heading_path: ["Target", "Deploy Steps"],
        char_offset_start: 100,
        char_offset_end: 200,
        content: "Section body",
        role: undefined,
      };
      const tx = await sidecar.begin();
      await sidecar.upsertDocument(tx, doc);
      await sidecar.putSections(tx, [section]);
      await tx.commit();

      const chunk = makeSummarizedChunk(
        `file://${source}`,
        "See [deploy](./target.md#deploy-steps).",
      );
      const out = await runStage7({ chunks: [chunk], sidecar });
      const refs = out.chunks[0]!.relationships.references;
      expect(refs).toEqual([{ section_id: section.section_id }]);
      await sidecar.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("fragment with no matching heading → unresolved_links (doc still resolved)", async () => {
    const root = await mkdtemp(join(tmpdir(), "june-stage7-nomatch-"));
    try {
      const target = join(root, "target.md");
      const source = join(root, "source.md");
      await writeFile(target, "stub");
      await writeFile(source, "stub");

      const sidecar = await createSqliteSidecar(join(root, "june.db"));
      await sidecar.putRun({
        run_id: runId,
        started_at: new Date().toISOString(),
        completed_at: undefined,
        trigger: "cli",
        doc_count: 0,
        chunk_count: 0,
        error_count: 0,
      });
      const targetUri = `file://${target}`;
      const doc = makeDocument(targetUri, "v1");
      const tx = await sidecar.begin();
      await sidecar.upsertDocument(tx, doc);
      await sidecar.putSections(tx, [
        {
          section_id: deriveSectionId(doc.doc_id, ["Target", "Intro"], 0),
          doc_id: doc.doc_id,
          version: doc.version,
          heading_path: ["Target", "Intro"],
          char_offset_start: 0,
          char_offset_end: 50,
          content: "body",
          role: undefined,
        },
      ]);
      await tx.commit();

      const chunk = makeSummarizedChunk(
        `file://${source}`,
        "Jump to [missing](./target.md#not-a-real-anchor).",
      );
      const out = await runStage7({ chunks: [chunk], sidecar });
      const rel = out.chunks[0]!.relationships;
      expect(rel.references).toEqual([]);
      expect(rel.unresolved_links).toContain("./target.md#not-a-real-anchor");
      await sidecar.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("Stage 7 — sibling/prev/next/canonical not populated yet (brief §4)", () => {
  test("Stage 7 leaves siblings / previous / next / canonical_for untouched", async () => {
    const sidecar = await createSqliteSidecar(":memory:");
    const chunk = makeSummarizedChunk("file:///x.md", "no links here.");
    const out = await runStage7({ chunks: [chunk], sidecar });
    const rel = out.chunks[0]!.relationships;
    expect(rel.canonical_for).toEqual([]);
    expect(rel.siblings).toEqual([]);
    expect(rel.previous_chunk_id).toBeUndefined();
    expect(rel.next_chunk_id).toBeUndefined();
    expect(rel.supersedes).toBeUndefined();
    expect(rel.superseded_by).toBeUndefined();
    await sidecar.close();
  });
});
