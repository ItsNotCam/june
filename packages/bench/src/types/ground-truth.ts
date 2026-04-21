// author: Claude
/**
 * Per-fact ground-truth resolution record (§19).
 *
 * - `resolved_substring` — Tier-1 normalized substring match succeeded.
 * - `resolved_embedding` — Tier-1 missed; Tier-2 doc-scoped embedding
 *   search returned a top-1 chunk at or above the similarity threshold.
 * - `unresolved` — neither tier succeeded; this fact has no measurable
 *   ground truth and the run aborts if more than 2% of facts land here.
 */
export type FactResolution = {
  fact_id: string;
  status: "resolved_substring" | "resolved_embedding" | "unresolved";
  doc_id: string | null;
  chunk_id: string | null;
  similarity: number | null;
};

/** On-disk shape of `ground_truth.json` (§9). */
export type GroundTruthFile = {
  fixture_id: string;
  schema_version: 1;
  ingest_run_id: string;
  ingest_schema_version: number;
  ingest_embedding_model: string;
  resolutions: FactResolution[];
  integrity: {
    unresolved_pct: number;
    embedding_pct: number;
    aborted_over_threshold: boolean;
  };
};
