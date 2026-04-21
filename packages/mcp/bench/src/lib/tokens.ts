// author: Claude
/**
 * Content-word tokenizer for anti-leakage scoring (§12 / §17).
 *
 * Not the same tokenizer as BM25 (which mirrors mcp's embedder to keep index
 * compatibility — see `src/retriever/bm25.ts`). This one is used only for the
 * post-hoc token-overlap check between a query and its expected facts'
 * surface hints.
 */

/** Small stopword set — the common English function words most retrievers already strip. */
const STOPWORDS: ReadonlySet<string> = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "what",
  "which",
  "does",
  "do",
  "of",
  "for",
  "in",
  "on",
  "to",
  "at",
  "by",
  "with",
]);

/**
 * Extracts content words: lowercase letter-runs of length ≥ 3, minus stopwords.
 *
 * Unicode-aware (`\p{L}+` matches letter sequences across scripts). Digits,
 * punctuation, and symbols are dropped — the check is about paraphrase
 * overlap, not punctuation.
 */
export const contentWords = (s: string): string[] => {
  const matches = s.toLowerCase().match(/\p{L}+/gu) ?? [];
  return matches.filter((w) => !STOPWORDS.has(w) && w.length >= 3);
};

/**
 * Jaccard overlap of content words between `query` and the concatenation of
 * `hints`.
 *
 * Returns `0` when the union is empty (both strings contain only stopwords
 * or are short). `1` on byte-equal inputs. The anti-leakage threshold in
 * `config.yaml` (default 0.40) is an upper bound — above it the query is
 * regenerated.
 */
export const jaccardOverlap = (query: string, hints: readonly string[]): number => {
  const q = new Set(contentWords(query));
  const h = new Set(contentWords(hints.join(" ")));
  if (q.size === 0 && h.size === 0) return 0;
  let inter = 0;
  for (const w of q) {
    if (h.has(w)) inter++;
  }
  const union = new Set<string>([...q, ...h]).size;
  return union === 0 ? 0 : inter / union;
};
