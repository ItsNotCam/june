// author: Claude
import type { DocId, RunId, Version } from "./ids";
import type {
  Category,
  DocumentStatus,
  LifecycleStatus,
  Sensitivity,
  SourceSystem,
  SourceType,
} from "./vocab";

/**
 * In-memory representation of a document row ([§6](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#6-complete-chunk-payload-schema-v1), [§10.4](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#ddl)).
 *
 * Persisted fields are the intersection with the `documents` DDL — fields not
 * in the SQLite schema (`frontmatter`, `doc_category`, etc.) are computed
 * during ingest and carried through the pipeline but not written to disk.
 * See [§30.3](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#303-document-section-chunk)'s in-memory-vs-persisted note for the parity rule.
 */
export type Document = {
  doc_id: DocId;
  version: Version;
  schema_version: number;
  source_uri: string;
  source_system: SourceSystem | string;
  source_type: SourceType;
  namespace: string;
  project: string | undefined;
  document_title: string;
  content_hash: string;
  byte_length: number;
  source_modified_at: string | undefined;
  ingested_at: string;
  ingested_by: RunId;
  status: DocumentStatus;
  is_latest: boolean;
  deleted_at: string | undefined;
  doc_category: Category | undefined;
  doc_sensitivity: Sensitivity | undefined;
  doc_lifecycle_status: LifecycleStatus | undefined;
  frontmatter: Readonly<Record<string, unknown>>;
};
