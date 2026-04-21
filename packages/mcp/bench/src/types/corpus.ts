// author: Claude
/**
 * One generated corpus document (§9).
 *
 * `absolute_path` is what the bench passes to `june ingest`. june derives its
 * `doc_id = sha256(absolute_source_uri)` from this; Stage 5 re-derives the
 * same id to look up chunks by doc.
 */
export type CorpusDocument = {
  filename: string;
  absolute_path: string;
  document_title: string;
  planted_fact_ids: string[];
  validator_attempts: number;
  validator_status: "pass" | "fail";
  content_hash: string;
};

/** On-disk shape of `corpus_manifest.json` (§9). */
export type CorpusManifest = {
  fixture_id: string;
  schema_version: 1;
  documents: CorpusDocument[];
  corpus_author: { provider: string; model: string };
};
