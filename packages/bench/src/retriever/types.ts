// author: Claude
import type { RetrievalResult } from "@/types/retrieval";

/**
 * The `Retriever` interface (§35).
 *
 * One method — `retrieve(queryText, k)`. Small, stable, deliberately unaware
 * of how scores are fused. The stopgap adapter (Appendix E) hits Qdrant and
 * SQLite directly; a future `june-api` adapter will call june's public
 * retrieval surface when one exists.
 *
 * `config_snapshot` captures whatever knobs the adapter exposes so
 * `results.json.retrieval_config_snapshot` can record them — `compare`
 * refuses to diff runs with different snapshots (I-EVAL-3).
 */
export type Retriever = {
  name: string;
  config_snapshot: Record<string, unknown>;
  retrieve: (queryText: string, k: number) => Promise<RetrievalResult[]>;
};

export type { RetrievalResult };
