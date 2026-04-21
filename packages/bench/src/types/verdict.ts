// author: Claude
/**
 * Judge verdict for a single reader answer (§22).
 *
 * `UNJUDGED` is the bench's own fallback bucket — applied when the judge's
 * response fails JSON parse or Zod validation, or when the Batch API reports
 * a per-request `errored` / `expired` / `canceled` outcome. Keeping it as a
 * distinct verdict (rather than silently mapping to one of the other five)
 * is L14's mitigation: a silent fallback that happened to match CORRECT in
 * aggregate would inflate scores.
 *
 * The scoring layer (§23) maps per-tier: for T5, `REFUSED` is the
 * correct outcome; for T1–T4, `CORRECT` is.
 */
export type Verdict =
  | "CORRECT"
  | "PARTIAL"
  | "INCORRECT"
  | "REFUSED"
  | "HALLUCINATED"
  | "UNJUDGED";
