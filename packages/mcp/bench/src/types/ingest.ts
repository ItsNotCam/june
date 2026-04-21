// author: Claude
/**
 * On-disk shape of `ingest_manifest.json` — Stage 4's output artifact (§18).
 *
 * Later stages read this instead of re-querying SQLite. Pinned values flow
 * into `ground_truth.json` and `results.json` run manifests at Stages 5 and 9.
 */
export type IngestManifestFile = {
  fixture_id: string;
  run_id: string;
  schema_version: 1;
  ingest_run_id: string;
  ingest_schema_version: number;
  embedding_model: string;
  embedding_model_version: string;
  qdrant_url: string;
  qdrant_collections: string[];
  scratch_path: string;
  config_path: string;
  completed_at: string;
};
