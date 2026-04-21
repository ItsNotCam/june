// author: Claude
import { resolve, join } from "path";
import { writeFile } from "fs/promises";
import type {
  MetricWithCi,
  PerQueryRecord,
  ResultsFile,
} from "@/types/results";
import type { QueryTier } from "@/types/query";
import { readJson } from "@/lib/artifacts";
import { UsageError, OperatorAbortError } from "@/lib/errors";
import { bootstrap, flagBool, parseArgv } from "./shared";

/**
 * `june-eval compare <run_a> <run_b> [--force]` (§28, §30.3).
 *
 * Refuses to diff runs whose fixtures, role assignments, or retrieval
 * snapshots differ — those differences dominate the numbers. `--force`
 * overrides with a loud banner.
 */
export const runCompare = async (argv: readonly string[]): Promise<void> => {
  const { positionals, flags } = parseArgv(argv);
  if (positionals.includes("--help") || positionals.length < 2) {
    process.stderr.write(COMPARE_HELP);
    if (positionals.length < 2) throw new UsageError("Need <run_a> <run_b>");
    return;
  }
  await bootstrap(flags);

  const [aDir, bDir] = positionals.map((p) => resolve(p));
  const a = (await readJson(join(aDir!, "results.json"))) as ResultsFile;
  const b = (await readJson(join(bDir!, "results.json"))) as ResultsFile;

  const force = flagBool(flags, "force");
  const diffs = manifestDifferences(a, b);
  if (diffs.length > 0 && !force) {
    process.stderr.write(
      `compare: runs are not comparable:\n  ${diffs.join("\n  ")}\n\nRe-run with --force to diff anyway.\n`,
    );
    throw new OperatorAbortError("compare: fixture/config mismatch, --force not supplied");
  }

  const report = renderCompare(a, b, diffs, force);
  const outPath = join(bDir!, "compare.md");
  await writeFile(outPath, report, "utf-8");
  process.stderr.write(`Wrote ${outPath}\n`);
};

const manifestDifferences = (a: ResultsFile, b: ResultsFile): string[] => {
  const out: string[] = [];
  if (a.manifest.fixture_hash !== b.manifest.fixture_hash) {
    out.push(`fixture_hash: ${a.manifest.fixture_hash} ≠ ${b.manifest.fixture_hash}`);
  }
  if (JSON.stringify(a.manifest.roles) !== JSON.stringify(b.manifest.roles)) {
    out.push("roles differ");
  }
  if (
    JSON.stringify(a.manifest.retrieval_config_snapshot) !==
    JSON.stringify(b.manifest.retrieval_config_snapshot)
  ) {
    out.push("retrieval_config_snapshot differs");
  }
  return out;
};

const TIERS: readonly QueryTier[] = ["T1", "T2", "T3", "T4", "T5"];

const renderCompare = (
  a: ResultsFile,
  b: ResultsFile,
  diffs: readonly string[],
  force: boolean,
): string => {
  const parts: string[] = [];
  if (force && diffs.length > 0) {
    parts.push(`> **Warning:** \`--force\` — runs are not comparable by default:\n>\n> - ${diffs.join("\n> - ")}\n`);
  }
  parts.push(`# compare: \`${a.run_id}\` → \`${b.run_id}\`\n`);
  parts.push(deltaTable(a, b));
  parts.push(perQueryFlips(a.per_query, b.per_query));
  const costDelta = b.cost_usd.total - a.cost_usd.total;
  parts.push(`\n## Cost\n\n- A: $${a.cost_usd.total.toFixed(4)}\n- B: $${b.cost_usd.total.toFixed(4)}\n- Δ: ${costDelta >= 0 ? "+" : ""}$${costDelta.toFixed(4)}\n`);
  return parts.join("\n");
};

const deltaTable = (a: ResultsFile, b: ResultsFile): string => {
  let out = `## Per-tier delta\n\n| Tier | Metric | A | B | CI overlap? |\n|---|---|---|---|---|\n`;
  for (const tier of TIERS) {
    const ta = a.per_tier[tier];
    const tb = b.per_tier[tier];
    out += row(tier, "Recall@5", ta.recall_at_5, tb.recall_at_5);
    out += row(tier, "MRR", ta.mrr, tb.mrr);
    out += row(tier, "Reader-correct", ta.reader_correct_pct, tb.reader_correct_pct);
  }
  return out;
};

const row = (tier: string, label: string, a: MetricWithCi, b: MetricWithCi): string => {
  const ovl = ciOverlap(a, b) ? "yes" : "**NO**";
  return `| ${tier} | ${label} | ${pct(a.point)} [${pct(a.ci_low)}, ${pct(a.ci_high)}] | ${pct(b.point)} [${pct(b.ci_low)}, ${pct(b.ci_high)}] | ${ovl} |\n`;
};

const ciOverlap = (a: MetricWithCi, b: MetricWithCi): boolean =>
  !(a.ci_high < b.ci_low || b.ci_high < a.ci_low);

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

const perQueryFlips = (
  a: readonly PerQueryRecord[],
  b: readonly PerQueryRecord[],
): string => {
  const aById = new Map(a.map((r) => [r.query_id, r]));
  let out = `\n## Per-query verdict flips\n\n`;
  let count = 0;
  for (const bb of b) {
    const aa = aById.get(bb.query_id);
    if (!aa) continue;
    if (aa.verdict !== bb.verdict && (isCorrect(aa) !== isCorrect(bb))) {
      count++;
      out += `- **${bb.query_id}** (${bb.tier}): ${aa.verdict} → ${bb.verdict}\n`;
      out += `  - Query: ${bb.query_text}\n`;
      out += `  - A answer: ${aa.reader_answer.slice(0, 200).replace(/\n/g, " ")}\n`;
      out += `  - B answer: ${bb.reader_answer.slice(0, 200).replace(/\n/g, " ")}\n\n`;
    }
  }
  if (count === 0) out += `_No correctness flips between the two runs._\n`;
  return out;
};

const isCorrect = (r: PerQueryRecord): boolean =>
  (r.tier === "T5" && r.verdict === "REFUSED") ||
  (r.tier !== "T5" && r.verdict === "CORRECT");

const COMPARE_HELP = `june-eval compare — diff two runs.

USAGE
  june-eval compare <run_a> <run_b> [--force] [--config <path>]

FLAGS
  --force    compare runs even if fixture / roles / retrieval config differ.
`;
