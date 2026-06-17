// author: Claude
/**
 * Failure-triage diagnostic (not part of the run pipeline).
 *
 * Given a completed run dir + its fixture dir, classifies every non-CORRECT
 * query into one of three buckets so you can see *exactly where things are
 * wrong* without eyeballing 30 records by hand:
 *
 *   - retrieval_miss  — recall@5 == 0; the gold chunk never made top-5.
 *   - judge_false_neg — gold was retrieved AND the reader's answer is grounded
 *                       in the corpus (high n-gram coverage), yet it was marked
 *                       wrong. This is the judge penalizing grounded elaboration.
 *   - genuine_error   — gold was retrieved but the answer is NOT grounded
 *                       (contradiction / fabrication / wrong relation).
 *   - review          — middling grounding; worth a human look.
 *
 * Grounding is a pure, deterministic n-gram-coverage heuristic over the raw
 * corpus — no LLM, no cost. It is a triage signal, not a verdict.
 *
 * Usage:
 *   bun scripts/triage-failures.ts <run_dir> <fixture_dir>
 *   bun scripts/triage-failures.ts state/runs/20260427045300-WG1B0WH6 \
 *       state/fixtures/RP6PNN3KW7Q2JS2R0GQ3Z00JZG
 */
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { z } from "zod";

const GROUNDED_THRESHOLD = 0.8;
const GENUINE_THRESHOLD = 0.4;
const NGRAM = 5;

const PerQuerySchema = z.object({
  query_id: z.string(),
  tier: z.string(),
  query_text: z.string(),
  reader_answer: z.string(),
  verdict: z.string(),
  recall_at_k: z.record(z.string(), z.number()),
});
const ResultsSchema = z.object({
  run_id: z.string(),
  per_query: z.array(PerQuerySchema),
});

type Classification =
  | "retrieval_miss"
  | "judge_false_neg"
  | "genuine_error"
  | "review";

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Builds the set of NGRAM-word shingles spanning every corpus document. */
const buildCorpusShingles = (corpusDir: string): Set<string> => {
  const words: string[] = [];
  for (const file of readdirSync(corpusDir)) {
    if (!file.endsWith(".md")) continue;
    words.push(...normalize(readFileSync(join(corpusDir, file), "utf-8")).split(" "));
  }
  const shingles = new Set<string>();
  for (let i = 0; i + NGRAM <= words.length; i++) {
    shingles.add(words.slice(i, i + NGRAM).join(" "));
  }
  return shingles;
};

/** Fraction of the answer's NGRAM shingles that appear verbatim in the corpus. */
const groundingCoverage = (answer: string, corpus: Set<string>): number => {
  const body = answer.split(/sources:/i)[0] ?? answer;
  const words = normalize(body).split(" ").filter(Boolean);
  if (words.length < NGRAM) return normalize(body).length > 0 && corpus.size > 0 ? 1 : 0;
  let hit = 0;
  let total = 0;
  for (let i = 0; i + NGRAM <= words.length; i++) {
    total++;
    if (corpus.has(words.slice(i, i + NGRAM).join(" "))) hit++;
  }
  return total === 0 ? 0 : hit / total;
};

const classify = (recall5: number, grounding: number): Classification => {
  if (recall5 === 0) return "retrieval_miss";
  if (grounding >= GROUNDED_THRESHOLD) return "judge_false_neg";
  if (grounding < GENUINE_THRESHOLD) return "genuine_error";
  return "review";
};

const main = (): void => {
  const [runDir, fixtureDir] = process.argv.slice(2);
  if (!runDir || !fixtureDir) {
    process.stderr.write(
      "usage: bun scripts/triage-failures.ts <run_dir> <fixture_dir>\n",
    );
    process.exit(64);
  }

  const results = ResultsSchema.parse(
    JSON.parse(readFileSync(join(runDir, "results.json"), "utf-8")),
  );
  const corpus = buildCorpusShingles(join(fixtureDir, "corpus"));

  const rows = results.per_query
    .filter((q) => q.verdict !== "CORRECT" && q.verdict !== "REFUSED")
    .map((q) => {
      const recall5 = q.recall_at_k["5"] ?? 0;
      const grounding = groundingCoverage(q.reader_answer, corpus);
      return { q, recall5, grounding, cls: classify(recall5, grounding) };
    });

  const out: string[] = [];
  out.push(`run ${results.run_id} — ${rows.length} non-CORRECT (excl. REFUSED)\n`);
  out.push(
    `${"qid".padEnd(8)} ${"tier".padEnd(5)} ${"verdict".padEnd(13)} ${"rec@5".padEnd(6)} ${"ground".padEnd(7)} classification\n`,
  );
  out.push("-".repeat(70) + "\n");
  for (const r of rows.sort((a, b) => a.q.tier.localeCompare(b.q.tier))) {
    out.push(
      `${r.q.query_id.padEnd(8)} ${r.q.tier.padEnd(5)} ${r.q.verdict.padEnd(13)} ${String(r.recall5).padEnd(6)} ${r.grounding.toFixed(2).padEnd(7)} ${r.cls}\n`,
    );
  }

  // Per-tier × classification summary.
  const tiers = [...new Set(rows.map((r) => r.q.tier))].sort();
  const classes: Classification[] = [
    "judge_false_neg",
    "genuine_error",
    "retrieval_miss",
    "review",
  ];
  out.push("\nsummary (rows = tier, cols = classification)\n");
  out.push(
    `${"tier".padEnd(6)} ${classes.map((c) => c.padEnd(16)).join("")}\n`,
  );
  for (const t of tiers) {
    const counts = classes.map(
      (c) => rows.filter((r) => r.q.tier === t && r.cls === c).length,
    );
    out.push(
      `${t.padEnd(6)} ${counts.map((n) => String(n).padEnd(16)).join("")}\n`,
    );
  }
  const totals = classes.map((c) => rows.filter((r) => r.cls === c).length);
  out.push(
    `${"ALL".padEnd(6)} ${totals.map((n) => String(n).padEnd(16)).join("")}\n`,
  );

  process.stdout.write(out.join(""));
};

main();
