// author: Claude
import type { Root as MdastRoot } from "mdast";
import { sectionize } from "@/lib/chunker/sectionize";
import { chunkSection } from "@/lib/chunker/split";
import { getConfig } from "@/lib/config";
import { deriveChunkId, deriveContentHash } from "@/lib/ids";
import { logger } from "@/lib/logger";
import type { Chunk } from "@/types/chunk";
import type { Document } from "@/types/document";
import type { ChunkedDocument, ParsedDocument, UnclassifiedChunk } from "@/types/pipeline";
import type { Section } from "@/types/section";
import type { SidecarStorage, Tx } from "@/lib/storage/types";

/**
 * Stage 3 — Structural Chunking ([§16](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#16-stage-3--structural-chunking)).
 *
 * Walks the mdast tree, emits sections, then splits each section into chunks
 * respecting the code/table/list/blockquote "protected regions" ([§16.2](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#162-within-section-chunking-3b--the-recursive-overflow-splitter)).
 * Writes sections + chunks + document status in one SQLite transaction.
 */

export type Stage3Input = {
  readonly parsed: ParsedDocument;
  readonly sidecar: SidecarStorage;
  readonly tx: Tx;
};

export type Stage3Result = ChunkedDocument;

const buildUnclassifiedChunk = (
  doc: Document,
  section: Section,
  span: {
    char_offset_start: number;
    char_offset_end: number;
    content: string;
  },
  indexInDocument: number,
  indexInSection: number,
): UnclassifiedChunk => {
  const chunk_id = deriveChunkId(
    doc.doc_id,
    doc.version,
    span.char_offset_start,
    span.char_offset_end,
    doc.schema_version,
  );
  const is_continuation = indexInSection > 0;
  // Span byte offsets mirror char offsets in the normalized-body coordinate
  // system — UTF-16 code units per [§15.1](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#151-encoding-normalization-per-i3).
  return {
    chunk_id,
    doc_id: doc.doc_id,
    version: doc.version,
    section_id: section.section_id,
    source_type: doc.source_type,
    content_type: "doc",
    schema_version: doc.schema_version,
    chunk_index_in_document: indexInDocument,
    chunk_index_in_section: indexInSection,
    is_latest: true,
    source_uri: doc.source_uri,
    source_system: doc.source_system,
    document_title: doc.document_title,
    heading_path: section.heading_path,
    span: {
      byte_offset_start: span.char_offset_start,
      byte_offset_end: span.char_offset_end,
      char_offset_start: span.char_offset_start,
      char_offset_end: span.char_offset_end,
      line_start: 0,
      line_end: 0,
    },
    content_hash: deriveContentHash(span.content),
    source_modified_at: doc.source_modified_at,
    ingested_at: doc.ingested_at,
    ingested_by: doc.ingested_by,
    structural_features: {
      token_count: Math.ceil(span.content.length / 4),
      char_count: span.content.length,
      contains_code: false,
      code_languages: [],
      has_table: false,
      has_list: false,
      link_density: 0,
      language: undefined,
    },
    content: span.content,
    is_continuation,
    type_specific: { content_type: "doc", version: doc.version as string },
    status: "pending",
  };
};

const chunkToStoredChunk = (c: UnclassifiedChunk): Chunk => ({
  ...c,
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
  runtime_signals: {
    quality_score: 0.5,
    freshness_decay_profile: "medium",
    authority_source_score: 0.5,
    authority_author_score: 0.5,
    retrieval_count: 0,
    citation_count: 0,
    user_marked_wrong_count: 0,
    last_validated_at: undefined,
    deprecated: false,
  },
  contextual_summary: "",
  embed_text: "",
  relationships: {
    references: [],
    external_links: [],
    unresolved_links: [],
    canonical_for: [],
    siblings: [],
    previous_chunk_id: undefined,
    next_chunk_id: undefined,
    supersedes: undefined,
    superseded_by: undefined,
  },
  embedding_model_name: "",
  embedding_model_version: "",
  embedding_dim: 0,
  embedded_at: "",
});

export const runStage3 = async (input: Stage3Input): Promise<Stage3Result> => {
  const cfg = getConfig();
  const doc = input.parsed.document;
  const body = input.parsed.raw_normalized;
  const ast: MdastRoot = input.parsed.ast;

  const sections = sectionize(ast, body, doc.doc_id, doc.version, doc.document_title);

  const chunks: UnclassifiedChunk[] = [];
  let indexInDocument = 0;

  for (const section of sections) {
    const spans = chunkSection(
      body,
      ast,
      section.char_offset_start,
      section.char_offset_end,
      {
        targetTokens: cfg.chunk.target_tokens,
        minTokens: cfg.chunk.min_tokens,
        maxTokens: cfg.chunk.max_tokens,
        overlapPct: cfg.chunk.overlap_pct,
      },
      section.section_id as string,
    );
    for (let i = 0; i < spans.length; i++) {
      const span = spans[i]!;
      chunks.push(buildUnclassifiedChunk(doc, section, span, indexInDocument, i));
      indexInDocument++;
    }
  }

  // Persist sections + chunks in a single transaction.
  await input.sidecar.putSections(input.tx, sections);
  await input.sidecar.putChunks(input.tx, chunks.map(chunkToStoredChunk));
  await input.sidecar.setDocumentStatus(
    input.tx,
    doc.doc_id,
    doc.version,
    "chunked",
  );

  logger.info("doc_chunked", {
    event: "doc_chunked",
    doc_id: doc.doc_id as string,
    count: chunks.length,
  });

  return {
    document: { ...doc, status: "chunked" },
    sections,
    chunks,
  };
};
