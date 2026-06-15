/**
 * Retrieval result types — the public shape `query()` returns and the
 * intermediate fusion record it builds. Mirrors the bench's retrieval types so
 * a future `june-api` bench adapter can consume this surface directly.
 */

/**
 * Which modality surfaced a chunk during retrieval.
 *
 * - `dense` — only the embedding search ranked it.
 * - `bm25` — only the sparse keyword search ranked it.
 * - `fused` — both modalities ranked it (the strongest signal).
 */
export type RankSource = "dense" | "bm25" | "fused";

/**
 * One ranked chunk returned by `query()`. Carries the chunk text and the
 * metadata a reader needs to cite it, plus the fused score and which modality
 * surfaced it. All fields beyond `chunk_id`/`score`/`rank_source` come straight
 * from the Qdrant payload written at ingest (Stage 10).
 */
export type RetrievedChunk = {
  chunk_id: string;
  score: number;
  rank_source: RankSource;
  content: string;
  document_title?: string;
  heading_path?: ReadonlyArray<string>;
  source_uri?: string;
  content_type?: string;
};
