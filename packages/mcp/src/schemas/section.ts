// author: Claude
import { z } from "zod";

/**
 * Validates a `sections` row read from SQLite ([§7](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#7-section-payload-schema-parent-child-storage), [§10](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#10-sqlite-sidecar-schema)). `heading_path` is
 * stored as JSON-encoded string in SQLite; callers JSON.parse before
 * validating here.
 */
export const SectionSchema = z.object({
  section_id: z.string().regex(/^[0-9a-f]{64}$/),
  doc_id: z.string().regex(/^[0-9a-f]{64}$/),
  version: z.string().min(1),
  parent_section_id: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  heading_level: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
  ]),
  heading_text: z.string(),
  heading_path: z.array(z.string()),
  ordinal: z.number().int().nonnegative(),
  byte_offset_start: z.number().int().nonnegative(),
  byte_offset_end: z.number().int().nonnegative(),
  char_offset_start: z.number().int().nonnegative(),
  char_offset_end: z.number().int().nonnegative(),
  content_hash: z.string().regex(/^[0-9a-f]{64}$/),
  content: z.string(),
  raw_markdown: z.string(),
});

export type SectionJson = z.infer<typeof SectionSchema>;
