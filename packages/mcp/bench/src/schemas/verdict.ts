// author: Claude
import { z } from "zod";

/**
 * Validates the judge's JSON response (§22).
 *
 * `UNJUDGED` is deliberately absent from this enum — it's the bench's own
 * fallback verdict applied when zod validation or JSON parse fails on the
 * judge's output. Keeping it out of the schema keeps the judge's output space
 * clean (L14).
 */
export const JudgeVerdictSchema = z.object({
  verdict: z.enum([
    "CORRECT",
    "PARTIAL",
    "INCORRECT",
    "REFUSED",
    "HALLUCINATED",
  ]),
  rationale: z.string().min(1).max(500),
});

export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;
