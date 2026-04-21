// author: Claude
/**
 * The "tokens ≈ characters / 4" proxy ([§16.2](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#162-within-section-chunking-3b--the-recursive-overflow-splitter)). A dependency-free estimator
 * that correlates well enough with embedding-model tokenizers for size
 * decisions at ingest time. Downstream embedders apply their own tokenizer's
 * truncation at embed time — this helper never drives correctness, only sizing.
 */
export const approximateTokens = (text: string): number =>
  Math.ceil(text.length / 4);
