// author: Claude
import type { Database } from "bun:sqlite";
import type { CorpusManifest } from "@/types/corpus";
import type { HoldoutQuery } from "@/types/holdout";
import { juneDocId } from "@/lib/ids";
import { GroundTruthResolutionError } from "@/lib/errors";

/**
 * Doc-level ground truth + scoring for the real-document holdout (§ RSI Phase 4).
 *
 * The synthetic path resolves `fact_id → chunk_id` (Stage 5) and scores recall
 * over those chunks. Real docs have no facts, so the holdout scores at the
 * DOCUMENT level: a query is "recalled@k" when a chunk from one of its labeled
 * expected documents appears in the top-k. These pure helpers are the holdout's
 * analog of `computeRecall`/`computeMrr` in `06-retrieval.ts`.
 */

/** A retrieved chunk projected to its owning document (the doc-level view). */
export type RetrievedDoc = {
  chunk_id: string;
  doc_id: string;
  score: number;
};

/**
 * Maps each `expected_doc_filename` in a holdout query to its june `doc_id` by
 * re-deriving the id from the manifest's on-disk path (the same `juneDocId`
 * Stage 5 uses, so it matches what june ingested). Throws if a labeled filename
 * isn't present in the corpus manifest — a label referencing a non-existent doc
 * is a fixture bug, not a miss.
 */
export const resolveExpectedDocIds = (
  query: HoldoutQuery,
  manifest: CorpusManifest,
): string[] => {
  const byFilename = new Map(manifest.documents.map((d) => [d.filename, d]));
  const out: string[] = [];
  for (const filename of query.expected_doc_filenames) {
    const doc = byFilename.get(filename);
    if (!doc) {
      throw new GroundTruthResolutionError(
        `Holdout query ${query.id} expects doc "${filename}", which is not in the corpus manifest.`,
      );
    }
    out.push(juneDocId(doc.absolute_path));
  }
  return out;
};

/**
 * Builds a `chunk_id → doc_id` map for the latest ingested version, so retrieved
 * chunk ids can be projected to documents for doc-level scoring. Mirrors the
 * `is_latest` join Stage 5 uses.
 */
export const buildChunkDocMap = (db: Database): Map<string, string> => {
  const rows = db
    .query<
      { chunk_id: string; doc_id: string },
      []
    >(
      `SELECT c.chunk_id, c.doc_id
         FROM chunks c
         JOIN documents d ON c.doc_id = d.doc_id AND c.version = d.version
        WHERE d.is_latest = 1`,
    )
    .all();
  const out = new Map<string, string>();
  for (const r of rows) out.set(r.chunk_id, r.doc_id);
  return out;
};

/**
 * Doc-level recall@k: 1 when a chunk from ANY expected document is in the top-k,
 * else 0. Unanswerable queries (no expected docs) have undefined recall and
 * return 0 — the caller excludes them from recall aggregates (same shape as T5).
 */
export const computeDocRecall = (
  expected_doc_ids: readonly string[],
  retrieved: readonly RetrievedDoc[],
  k: number,
): number => {
  if (expected_doc_ids.length === 0) return 0;
  const expected = new Set(expected_doc_ids);
  return retrieved.slice(0, k).some((r) => expected.has(r.doc_id)) ? 1 : 0;
};

/**
 * Doc-level MRR: reciprocal rank of the EARLIEST retrieved chunk whose document
 * is an expected one. 0 when no expected-doc chunk is retrieved or the query is
 * unanswerable. "Any expected doc" (not "all") because doc-level relevance is
 * satisfied by a single hit from a relevant document.
 */
export const computeDocMrr = (
  expected_doc_ids: readonly string[],
  retrieved: readonly RetrievedDoc[],
): number => {
  if (expected_doc_ids.length === 0) return 0;
  const expected = new Set(expected_doc_ids);
  for (let i = 0; i < retrieved.length; i++) {
    if (expected.has(retrieved[i]!.doc_id)) return 1 / (i + 1);
  }
  return 0;
};

/** Median of a numeric list (lower-mid average for even N); null when empty. */
export const median = (xs: readonly number[]): number | null => {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
};
