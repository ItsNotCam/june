// author: Claude
import { z } from "zod";

/**
 * Validates the corpus author's JSON response (§16).
 *
 * `markdown` is the full document; `fact_locations` maps each planted fact id
 * to a short verbatim excerpt showing where the hint landed (a debugging aid —
 * the validator doesn't rely on it, only on `markdown.includes(surface_hint)`).
 */
export const CorpusAuthorOutputSchema = z.object({
  markdown: z.string().min(1),
  fact_locations: z.record(z.string(), z.string()),
});

export type CorpusAuthorOutput = z.infer<typeof CorpusAuthorOutputSchema>;
