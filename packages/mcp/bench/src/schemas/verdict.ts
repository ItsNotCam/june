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

/**
 * Validates an on-disk `verdicts.json` produced OUT OF PROCESS by the Claude
 * Code RSI orchestrator's judge agents (`june-eval score` ingests this).
 *
 * Unlike `JudgeVerdictSchema` (one LLM reply), this is the whole artifact and
 * tolerates `UNJUDGED` — an external judge may legitimately mark a task it
 * could not grade rather than guessing. `score` counts those toward the
 * integrity `unjudged_pct`, never toward correct.
 */
const VerdictValueSchema = z.enum([
  "CORRECT",
  "PARTIAL",
  "INCORRECT",
  "REFUSED",
  "HALLUCINATED",
  "UNJUDGED",
]);

const VerdictRecordSchema = z.object({
  query_id: z.string().min(1),
  verdict: VerdictValueSchema,
  rationale: z.string().default(""),
  unjudged_reason: z.string().nullable().default(null),
});

export const VerdictsFileSchema = z.object({
  fixture_id: z.string().min(1),
  run_id: z.string().min(1),
  schema_version: z.literal(1),
  judge: z.object({
    kind: z.enum(["claude-code-agent", "anthropic-batch", "deepseek"]),
    model: z.string().min(1),
    prompt_template_hash: z.string().min(1),
    judged_at: z.string().min(1),
  }),
  verdicts: z.array(VerdictRecordSchema),
});

export type VerdictsFileParsed = z.infer<typeof VerdictsFileSchema>;
