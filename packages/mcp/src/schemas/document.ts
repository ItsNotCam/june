// author: Claude
import { z } from "zod";
import {
  CATEGORY_VALUES,
  DOCUMENT_STATUS_VALUES,
  LIFECYCLE_VALUES,
  SENSITIVITY_VALUES,
  SOURCE_TYPE_VALUES,
} from "@/types/vocab";

/**
 * Validates a `documents` row read from SQLite. IDs stay as plain strings
 * here — callers brand via `asDocId` / `asVersion` at the usage site so this
 * schema stays compatible with both JSON (Qdrant payloads) and SQLite TEXT.
 */
export const DocumentSchema = z.object({
  doc_id: z.string().regex(/^[0-9a-f]{64}$/),
  version: z.string().min(1),
  schema_version: z.number().int().positive(),
  source_uri: z.string().min(1),
  source_system: z.string().min(1),
  source_type: z.enum(SOURCE_TYPE_VALUES),
  namespace: z.string().min(1),
  project: z.string().min(1).optional(),
  document_title: z.string().min(1),
  content_hash: z.string().regex(/^[0-9a-f]{64}$/),
  byte_length: z.number().int().nonnegative(),
  source_modified_at: z.string().min(1).optional(),
  ingested_at: z.string().min(1),
  ingested_by: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
  status: z.enum(DOCUMENT_STATUS_VALUES),
  is_latest: z.boolean(),
  deleted_at: z.string().min(1).optional(),
  doc_category: z.enum(CATEGORY_VALUES).optional(),
  doc_sensitivity: z.enum(SENSITIVITY_VALUES).optional(),
  doc_lifecycle_status: z.enum(LIFECYCLE_VALUES).optional(),
  frontmatter: z.record(z.string(), z.unknown()),
});

export type DocumentJson = z.infer<typeof DocumentSchema>;
