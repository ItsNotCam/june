// author: Claude
import { z } from "zod";

/**
 * Per-tier query-author output schemas (§17, §34).
 *
 * Each tier's prompt (Appendix D.2–D.6) returns a different shape; the reshape
 * step in Stage 3 converts each into the canonical `Query` record before
 * appending to `queries.json`. Keeping the five schemas separate lets the LLM
 * respond in the tier-natural shape without having to echo back the tier
 * string it already knows from its prompt.
 */

const QueryTextOnly = z.object({ text: z.string().min(1) });
const QuerySingleFact = z.object({
  fact_id: z.string().min(1),
  text: z.string().min(1),
});

export const QueryAuthorT1OutputSchema = z.object({
  queries: z.array(QuerySingleFact).min(1),
});

export const QueryAuthorT2OutputSchema = z.object({
  queries: z.array(QuerySingleFact).min(1),
});

export const QueryAuthorT3OutputSchema = z.object({
  queries: z.array(QuerySingleFact).min(1),
});

export const QueryAuthorT4OutputSchema = z.object({
  queries: z
    .array(
      z.object({
        fact_ids: z.tuple([z.string().min(1), z.string().min(1)]),
        text: z.string().min(1),
      }),
    )
    .min(1),
});

export const QueryAuthorT5OutputSchema = z.object({
  queries: z.array(QueryTextOnly).min(1),
});

export type QueryAuthorT1Output = z.infer<typeof QueryAuthorT1OutputSchema>;
export type QueryAuthorT2Output = z.infer<typeof QueryAuthorT2OutputSchema>;
export type QueryAuthorT3Output = z.infer<typeof QueryAuthorT3OutputSchema>;
export type QueryAuthorT4Output = z.infer<typeof QueryAuthorT4OutputSchema>;
export type QueryAuthorT5Output = z.infer<typeof QueryAuthorT5OutputSchema>;
