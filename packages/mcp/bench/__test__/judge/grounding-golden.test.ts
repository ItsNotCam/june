// author: Claude
import { beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "fs/promises";
import { join } from "path";
import { z } from "zod";
import { createAnthropicProvider } from "@/providers/anthropic";
import { renderPrompt } from "@/lib/prompts";
import { parseVerdictPayload } from "@/judge/llm-judge";
import { getEnv } from "@/lib/env";
import { loadTestConfig } from "../helpers";

/**
 * Golden-set eval for the grounding-aware judge prompt (§22).
 *
 * Each case is a real reader answer from run 20260427045300-WG1B0WH6 paired
 * with the corpus passage that grounds it. Under the OLD judge (surface-hint
 * only) every grounded-elaboration case was scored HALLUCINATED — a false
 * negative. This test asserts the new prompt scores them correctly while still
 * catching genuine wrong-relation answers and a synthetic ungrounded claim.
 *
 * Opt-in: it makes live Anthropic calls. Run with:
 *   RUN_LIVE_JUDGE=1 ANTHROPIC_API_KEY=sk-... bun test grounding-golden
 * Uses the SYNCHRONOUS Messages API (not Batch) so the loop is seconds, not
 * minutes — this is the cheap prompt-iteration harness.
 */

const LIVE = process.env["RUN_LIVE_JUDGE"] === "1";

const GoldenCaseSchema = z.object({
  id: z.string(),
  tier: z.enum(["T1", "T2", "T3", "T4", "T5"]),
  query_text: z.string(),
  expected_surface_hints: z.array(z.string()),
  retrieved_context: z.string(),
  reader_answer: z.string(),
  acceptable_verdicts: z.array(z.string()).min(1),
  note: z.string(),
});
const GoldenFileSchema = z.object({
  source_run: z.string(),
  fixture: z.string(),
  cases: z.array(GoldenCaseSchema).min(1),
});
type GoldenCase = z.infer<typeof GoldenCaseSchema>;

let cases: GoldenCase[] = [];

const judgeOnce = async (
  provider: ReturnType<typeof createAnthropicProvider>,
  model: string,
  c: GoldenCase,
): Promise<string> => {
  const content = await renderPrompt("judge", {
    query_tier: c.tier,
    query_text: c.query_text,
    expected_surface_hints_bulleted: c.expected_surface_hints
      .map((h) => `- ${h}`)
      .join("\n"),
    reader_answer: c.reader_answer,
    retrieved_context: c.retrieved_context,
  });
  const res = await provider.call({
    model,
    messages: [{ role: "user", content }],
    max_tokens: 512,
    temperature: 0,
  });
  const parsed = parseVerdictPayload(res.text);
  return parsed?.verdict ?? `UNPARSEABLE(${res.text.slice(0, 40)})`;
};

beforeAll(async () => {
  await loadTestConfig();
  const raw = await readFile(
    join(import.meta.dir, "fixtures", "grounding-cases.json"),
    "utf-8",
  );
  cases = GoldenFileSchema.parse(JSON.parse(raw)).cases;
});

describe("judge grounding golden set (live, opt-in)", () => {
  test.skipIf(!LIVE)(
    "every grounded-elaboration case scores within its acceptable verdicts",
    async () => {
      const provider = createAnthropicProvider(getEnv().ANTHROPIC_API_KEY);
      const model = "claude-sonnet-4-6";
      const verdicts = await Promise.all(
        cases.map(async (c) => ({
          c,
          verdict: await judgeOnce(provider, model, c),
        })),
      );
      const failures = verdicts.filter(
        ({ c, verdict }) => !c.acceptable_verdicts.includes(verdict),
      );
      for (const { c, verdict } of verdicts) {
        // Surface the full grid in test output for fast prompt iteration.
        console.log(
          `${c.id.padEnd(24)} got=${verdict.padEnd(13)} accept=${c.acceptable_verdicts.join("|")}`,
        );
      }
      expect(
        failures.map((f) => `${f.c.id}: got ${f.verdict}, want ${f.c.acceptable_verdicts.join("|")}`),
      ).toEqual([]);
    },
    120_000,
  );

  test("golden fixture is well-formed", () => {
    expect(cases.length).toBeGreaterThanOrEqual(8);
    expect(cases.every((c) => c.retrieved_context.includes("<chunk"))).toBe(true);
  });
});
