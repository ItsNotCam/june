// author: Claude
import type { DocId, SectionId, Version } from "./ids";

/**
 * In-memory Section record ([§7](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#7-section-payload-schema-parent-child-storage)). Persisted columns in SQLite are
 * `(section_id, version, doc_id, heading_path, content, char_start, char_end,
 * created_at)` — `parent_section_id`, `heading_level`, `heading_text`,
 * `ordinal`, and `byte_offset_*` are computed during chunking and carried
 * forward in memory but not written. See [§30.3](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#303-document-section-chunk).
 *
 * `raw_markdown` duplicates `content` for Stage 3's in-memory handoff; it is
 * never logged (I7) and not a separate persisted column.
 */
export type Section = {
  section_id: SectionId;
  doc_id: DocId;
  version: Version;
  parent_section_id: SectionId | undefined;
  heading_level: 1 | 2 | 3 | 4 | 5 | 6;
  heading_text: string;
  heading_path: ReadonlyArray<string>;
  ordinal: number;
  byte_offset_start: number;
  byte_offset_end: number;
  char_offset_start: number;
  char_offset_end: number;
  content_hash: string;
  content: string;
  raw_markdown: string;
};
