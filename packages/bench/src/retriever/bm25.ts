// author: Claude
/**
 * Client-side BM25 sparse-vector generation — mirrors
 * `packages/mcp/src/lib/embedder/bm25.ts` exactly per R2 (§41).
 *
 * **Load-bearing constants.** Qdrant's sparse index keys off the hashed
 * token ids. A different hash (seed / prime / operation order) produces
 * zero overlap with the vectors mcp stored at ingest time — every query
 * would miss. All three constants below must match mcp's values byte-for-byte.
 *
 * - FNV-1a 32-bit offset basis: `0x811c9dc5`
 * - FNV-1a 32-bit prime:         `0x01000193`
 * - Tokenizer:                   `/[\s\p{P}\p{S}]+/u`
 * - Min / max token-char bounds: 2 / 100
 * - Default stopwords:           `[]` (matches mcp's shipped default; the
 *   bench's temp mcp config inherits this, so both sides agree)
 */

const MIN_TOKEN_CHARS = 2;
const MAX_TOKEN_CHARS = 100;

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
 * Tokenize → filter by length/stopwords → count → FNV-1a hash. Returns a
 * `{ indices, values }` sparse vector in the Qdrant named-vector shape.
 *
 * `stopwords` defaults to `[]` to match mcp's shipped default (see
 * `packages/mcp/config.example.yaml`). Operators who customize the mcp
 * stopword list for their workload must configure the bench to match, or
 * the stored and query vectors stop lining up.
 */
export const bm25Vectorize = (
  embed_text: string,
  stopwords: readonly string[] = [],
): SparseVector => {
  const stop = new Set(stopwords.map((s) => s.toLowerCase()));
  const lowered = embed_text.toLowerCase();
  const raw = lowered.split(TOKEN_SPLIT_RE);
  const counts = new Map<number, number>();
  for (const tok of raw) {
    if (tok.length < MIN_TOKEN_CHARS || tok.length > MAX_TOKEN_CHARS) continue;
    if (stop.has(tok)) continue;
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
