// author: Claude
import { getConfig } from "@/lib/config";

/**
 * Client-side BM25 sparse-vector generation ([§22.3](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#223-sparse-bm25-vector-client-side)).
 *
 * Qdrant performs IDF server-side via `Modifier.IDF`; we only need to
 * produce the term-frequency vector keyed by FNV-1a 32-bit hashes of the
 * tokens. Collisions in 32-bit space are rare for realistic vocabularies —
 * acceptable noise floor per the spec.
 */

const MIN_TOKEN_CHARS = 2;
const MAX_TOKEN_CHARS = 100;

// Unicode-aware split on whitespace, punctuation, and symbols.
const TOKEN_SPLIT_RE = /[\s\p{P}\p{S}]+/u;

const fnv1a32 = (s: string): number => {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
};

export type SparseVector = {
  indices: number[];
  values: number[];
};

/**
 * Tokenize + count + hash. Returns a `{ indices, values }` sparse vector
 * ready for Qdrant upsert.
 */
export const bm25Vectorize = (embed_text: string): SparseVector => {
  const cfg = getConfig();
  const stopwords = new Set(cfg.bm25.stopwords.map((s) => s.toLowerCase()));
  const lowered = embed_text.toLowerCase();
  const raw = lowered.split(TOKEN_SPLIT_RE);
  const counts = new Map<number, number>();
  for (const tok of raw) {
    if (tok.length < MIN_TOKEN_CHARS || tok.length > MAX_TOKEN_CHARS) continue;
    if (stopwords.has(tok)) continue;
    const h = fnv1a32(tok);
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  const indices: number[] = [];
  const values: number[] = [];
  for (const [idx, val] of counts) {
    indices.push(idx);
    values.push(val);
  }
  return { indices, values };
};

export const _internal = { fnv1a32 } as const;
