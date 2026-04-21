// author: Claude
import { stringify as yamlStringify } from "yaml";
import { writeFile } from "fs/promises";
import type { FactsFile } from "@/types/facts";
import type { QueriesFile, QueryTier } from "@/types/query";
import type { GroundTruthFile } from "@/types/ground-truth";
import type { RetrievalResultsFile } from "@/types/retrieval";
import type {
  BaselineAnswersFile,
  ReaderAnswersFile,
} from "@/types/reader";
import type { JudgeResultsFile } from "@/types/judge";
import type { Verdict } from "@/types/verdict";
import type {
  MetricWithCi,
  OverallAggregates,
  PerQueryRecord,
  ResultsFile,
  RunManifest,
  RunStatus,
  TierAggregates,
} from "@/types/results";
import { computeBootstrapCi, type PerQueryValue } from "@/lib/bootstrap";
import { seededRng, seedFromString, shuffle } from "@/lib/rng";
import { writeJsonAtomic } from "@/lib/artifacts";
import { BudgetMeter } from "@/lib/cost";
import { logger } from "@/lib/logger";

const TIERS: readonly QueryTier[] = ["T1", "T2", "T3", "T4", "T5"];

/**
 * Stage 9 — scoring + report (§23, §30).
 *
 * Pure code: aggregates per-query artifacts into per-tier + overall metrics
 * with 95% bootstrap CIs, then writes `results.json` (machine-readable) and
 * `summary.md` (human-readable).
 *
 * For T5, `reader_correct_pct` counts `REFUSED` verdicts as correct (§23's
 * tier remapping). For T1–T4, it counts `CORRECT` verdicts as correct.
 *
 * Macro + micro aggregates are reported side by side (§30.2) — operators
 * cannot silently pick the one that looks better (L12).
 */
export const runStage9 = async (args: {
  facts: FactsFile;
  queries: QueriesFile;
  ground_truth: GroundTruthFile;
  retrieval: RetrievalResultsFile;
  reader: ReaderAnswersFile;
  baseline: BaselineAnswersFile | null;
  judge: JudgeResultsFile;
  manifest: RunManifest;
  run_status: RunStatus;
  budget: BudgetMeter;
  leakage_warning_count: number;
  results_path: string;
  summary_path: string;
}): Promise<ResultsFile> => {
  const perQuery = buildPerQueryRecords(args);

  const perTier = {} as Record<QueryTier, TierAggregates>;
  for (const tier of TIERS) {
    const inTier = perQuery.filter((r) => r.tier === tier);
    perTier[tier] = aggregateTier(tier, inTier, args.manifest.run_id);
  }

  const overall = {
    macro: macroOverall(perTier),
    micro: microOverall(perQuery, args.manifest.run_id),
  };

  const unjudgedReader = args.judge.verdicts.filter(
    (v) => !v.query_id.startsWith("baseline_") && v.verdict === "UNJUDGED",
  );
  const unjudged_pct =
    args.reader.answers.length === 0
      ? 0
      : unjudgedReader.length / args.reader.answers.length;

  const costs = args.budget.snapshot();

  const results: ResultsFile = {
    fixture_id: args.facts.fixture_id,
    run_id: args.manifest.run_id,
    schema_version: 1,
    run_status: args.run_status,
    started_at: args.manifest.started_at,
    completed_at: args.manifest.completed_at,
    manifest: args.manifest,
    per_query: perQuery,
    per_tier: perTier,
    overall,
    integrity: {
      unresolved_pct: args.ground_truth.integrity.unresolved_pct,
      embedding_pct: args.ground_truth.integrity.embedding_pct,
      unjudged_pct,
      queries_with_leakage_warning: args.leakage_warning_count,
    },
    cost_usd: costs,
  };
  await writeJsonAtomic(args.results_path, results);

  const summary = renderSummary(results);
  await writeFile(args.summary_path, summary, "utf-8");

  logger.info("stage.9.complete", {
    fixture_id: args.facts.fixture_id,
    run_status: args.run_status,
    total_cost_usd: costs.total,
  });

  return results;
};

const buildPerQueryRecords = (args: {
  queries: QueriesFile;
  retrieval: RetrievalResultsFile;
  reader: ReaderAnswersFile;
  baseline: BaselineAnswersFile | null;
  judge: JudgeResultsFile;
}): PerQueryRecord[] => {
  const retrievalById = new Map(
    args.retrieval.results.map((r) => [r.query_id, r]),
  );
  const readerById = new Map(args.reader.answers.map((a) => [a.query_id, a]));
  const baselineById = args.baseline
    ? new Map(args.baseline.answers.map((a) => [a.query_id, a]))
    : null;
  const verdictById = new Map(
    args.judge.verdicts
      .filter((v) => !v.query_id.startsWith("baseline_"))
      .map((v) => [v.query_id, v]),
  );
  const baselineVerdictById = new Map(
    args.judge.verdicts
      .filter((v) => v.query_id.startsWith("baseline_"))
      .map((v) => [v.query_id.slice("baseline_".length), v]),
  );

  const out: PerQueryRecord[] = [];
  for (const q of args.queries.queries) {
    const retr = retrievalById.get(q.id);
    const reader = readerById.get(q.id);
    const verdict = verdictById.get(q.id);
    const baseline = baselineById?.get(q.id) ?? null;
    const baselineVerdict = baselineVerdictById.get(q.id) ?? null;
    out.push({
      query_id: q.id,
      tier: q.tier,
      query_text: q.text,
      expected_fact_ids: q.expected_fact_ids,
      retrieved_chunk_ids: (retr?.retrieved ?? []).map((r) => r.chunk_id),
      reader_answer: reader?.answer_text ?? "",
      verdict: verdict?.verdict ?? "UNJUDGED",
      rationale: verdict?.rationale ?? "",
      recall_at_k: retr?.recall_at_k ?? { "1": 0, "3": 0, "5": 0, "10": 0 },
      mrr: retr?.mrr ?? 0,
      t5_top1_score: retr?.t5_top1_score ?? null,
      baseline_answer: baseline?.answer_text ?? null,
      baseline_verdict: baselineVerdict?.verdict ?? null,
    });
  }
  return out;
};

const aggregateTier = (
  tier: QueryTier,
  records: readonly PerQueryRecord[],
  run_id: string,
): TierAggregates => {
  const seed = (metric: string): string => `${run_id}:${metric}:${tier}`;

  const recall_at = (k: 1 | 3 | 5 | 10): MetricWithCi => {
    const vals: PerQueryValue[] =
      tier === "T5"
        ? []
        : records.map((r) => ({
            query_id: r.query_id,
            value: r.recall_at_k[String(k) as "1" | "3" | "5" | "10"],
          }));
    return computeBootstrapCi(vals, seed(`recall_at_${k}`));
  };

  const mrrMetric = computeBootstrapCi(
    tier === "T5"
      ? []
      : records.map<PerQueryValue>((r) => ({ query_id: r.query_id, value: r.mrr })),
    seed("mrr"),
  );

  const correctTarget: Verdict = tier === "T5" ? "REFUSED" : "CORRECT";
  const correctMetric = computeBootstrapCi(
    records.map<PerQueryValue>((r) => ({
      query_id: r.query_id,
      value: r.verdict === correctTarget ? 1 : 0,
    })),
    seed("reader_correct_pct"),
  );

  const hallucinatedMetric = computeBootstrapCi(
    records.map<PerQueryValue>((r) => ({
      query_id: r.query_id,
      value: r.verdict === "HALLUCINATED" ? 1 : 0,
    })),
    seed("reader_hallucinated_pct"),
  );

  const refusedMetric = computeBootstrapCi(
    records.map<PerQueryValue>((r) => ({
      query_id: r.query_id,
      value: r.verdict === "REFUSED" ? 1 : 0,
    })),
    seed("reader_refused_pct"),
  );

  const unjudged_pct =
    records.length === 0
      ? 0
      : records.filter((r) => r.verdict === "UNJUDGED").length / records.length;

  let t5_top1_score_median: number | null = null;
  if (tier === "T5") {
    const scores = records
      .map((r) => r.t5_top1_score)
      .filter((s): s is number => s !== null)
      .sort((a, b) => a - b);
    if (scores.length > 0) {
      const mid = Math.floor(scores.length / 2);
      t5_top1_score_median =
        scores.length % 2 === 0
          ? (scores[mid - 1]! + scores[mid]!) / 2
          : scores[mid]!;
    }
  }

  return {
    query_count: records.length,
    recall_at_1: recall_at(1),
    recall_at_3: recall_at(3),
    recall_at_5: recall_at(5),
    recall_at_10: recall_at(10),
    mrr: mrrMetric,
    reader_correct_pct: correctMetric,
    reader_hallucinated_pct: hallucinatedMetric,
    reader_refused_pct: refusedMetric,
    unjudged_pct,
    t5_top1_score_median,
  };
};

const macroOverall = (
  perTier: Record<QueryTier, TierAggregates>,
): OverallAggregates => {
  const meanMetric = (pick: (t: TierAggregates) => MetricWithCi): MetricWithCi => {
    const xs = TIERS.map((t) => pick(perTier[t]));
    const point = xs.reduce((acc, m) => acc + m.point, 0) / xs.length;
    const ci_low = xs.reduce((acc, m) => acc + m.ci_low, 0) / xs.length;
    const ci_high = xs.reduce((acc, m) => acc + m.ci_high, 0) / xs.length;
    const query_ids = xs.flatMap((m) => m.query_ids);
    return { point, ci_low, ci_high, query_ids };
  };
  return {
    reader_correct_pct: meanMetric((t) => t.reader_correct_pct),
    recall_at_5: meanMetric((t) => t.recall_at_5),
    recall_at_10: meanMetric((t) => t.recall_at_10),
    mrr: meanMetric((t) => t.mrr),
  };
};

const microOverall = (
  records: readonly PerQueryRecord[],
  run_id: string,
): OverallAggregates => {
  const seed = (m: string): string => `${run_id}:${m}:overall_micro`;

  const reader_correct_pct = computeBootstrapCi(
    records.map<PerQueryValue>((r) => ({
      query_id: r.query_id,
      value:
        (r.tier === "T5" && r.verdict === "REFUSED") ||
        (r.tier !== "T5" && r.verdict === "CORRECT")
          ? 1
          : 0,
    })),
    seed("reader_correct_pct"),
  );

  const recall = (k: 5 | 10): MetricWithCi =>
    computeBootstrapCi(
      records
        .filter((r) => r.tier !== "T5")
        .map<PerQueryValue>((r) => ({
          query_id: r.query_id,
          value: r.recall_at_k[String(k) as "5" | "10"],
        })),
      seed(`recall_at_${k}`),
    );

  const mrr = computeBootstrapCi(
    records
      .filter((r) => r.tier !== "T5")
      .map<PerQueryValue>((r) => ({ query_id: r.query_id, value: r.mrr })),
    seed("mrr"),
  );

  return {
    reader_correct_pct,
    recall_at_5: recall(5),
    recall_at_10: recall(10),
    mrr,
  };
};

/**
 * Renders `summary.md` (§30.2).
 *
 * Sections, in order: headline → per-tier table → integrity block →
 * ten-verdicts-to-eyeball → what-this-means → run manifest → provenance footnote.
 */
export const renderSummary = (results: ResultsFile): string => {
  const parts: string[] = [];
  parts.push(headline(results));
  parts.push(perTierTable(results));
  parts.push(integrityBlock(results));
  parts.push(tenVerdicts(results));
  parts.push(whatThisMeans());
  parts.push(runManifestBlock(results));
  parts.push(
    `\n---\n\n<sub>Every number above traces back to per-query records in \`results.json\`; use \`jq\` or open the file to investigate.</sub>\n`,
  );
  return parts.join("\n");
};

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const metricCell = (m: MetricWithCi): string =>
  `${pct(m.point)} [${pct(m.ci_low)}, ${pct(m.ci_high)}]`;

const headline = (results: ResultsFile): string => {
  const hasBaseline = results.per_query.some((r) => r.baseline_verdict !== null);
  const readerCorrect = results.overall.micro.reader_correct_pct;
  let out = `# Bench results — \`${results.run_id}\`\n\n`;
  out += `**Bar question:** does june's retrieval + \`${results.manifest.roles.reader.model}\` beat no-RAG \`${results.manifest.roles.baseline?.model ?? "opus"}\` on the ingested corpus?\n\n`;
  out += `| Reader | Correct % | 95% CI |\n|---|---|---|\n`;
  out += `| \`${results.manifest.roles.reader.model}\` with retrieval | ${pct(readerCorrect.point)} | [${pct(readerCorrect.ci_low)}, ${pct(readerCorrect.ci_high)}] |\n`;
  if (hasBaseline) {
    const baselineCorrect = computeBaselineCorrectPct(results);
    out += `| \`${results.manifest.roles.baseline?.model ?? "baseline"}\` (no RAG) | ${pct(baselineCorrect)} | — |\n`;
  }
  return out;
};

const computeBaselineCorrectPct = (results: ResultsFile): number => {
  const withBaseline = results.per_query.filter((r) => r.baseline_verdict !== null);
  if (withBaseline.length === 0) return 0;
  const correct = withBaseline.filter(
    (r) =>
      (r.tier === "T5" && r.baseline_verdict === "REFUSED") ||
      (r.tier !== "T5" && r.baseline_verdict === "CORRECT"),
  ).length;
  return correct / withBaseline.length;
};

const perTierTable = (results: ResultsFile): string => {
  let out = `\n## Per-tier\n\n| Tier | N | Recall@5 | MRR | Reader-correct % |\n|---|---|---|---|---|\n`;
  for (const tier of TIERS) {
    const t = results.per_tier[tier];
    out += `| ${tier} | ${t.query_count} | ${metricCell(t.recall_at_5)} | ${metricCell(t.mrr)} | ${metricCell(t.reader_correct_pct)} |\n`;
  }
  out += `| **Macro** | — | ${metricCell(results.overall.macro.recall_at_5)} | ${metricCell(results.overall.macro.mrr)} | ${metricCell(results.overall.macro.reader_correct_pct)} |\n`;
  out += `| **Micro** | ${results.per_query.length} | ${metricCell(results.overall.micro.recall_at_5)} | ${metricCell(results.overall.micro.mrr)} | ${metricCell(results.overall.micro.reader_correct_pct)} |\n`;
  const t5 = results.per_tier.T5;
  if (t5.t5_top1_score_median !== null) {
    out += `\n<sub>T5 top-1 retrieval-score median: ${t5.t5_top1_score_median.toFixed(3)}</sub>\n`;
  }
  return out;
};

const integrityBlock = (results: ResultsFile): string => {
  const { integrity, manifest } = results;
  let out = `\n## Integrity\n\n`;
  out += `- Unresolved: ${pct(integrity.unresolved_pct)}\n`;
  out += `- Embedding-fallback: ${pct(integrity.embedding_pct)}\n`;
  out += `- UNJUDGED: ${pct(integrity.unjudged_pct)}\n`;
  out += `- Queries with leakage warning: ${integrity.queries_with_leakage_warning}\n`;
  out += `- Response caching: ${manifest.caching_enabled ? "**enabled**" : "disabled"}\n`;
  out += `- Total cost: $${results.cost_usd.total.toFixed(4)}\n`;
  return out;
};

const tenVerdicts = (results: ResultsFile): string => {
  const rng = seededRng(
    seedFromString(`${results.manifest.fixture_hash}:${results.run_id}`),
  );
  const sample = shuffle(rng, results.per_query).slice(0, 10);
  let out = `\n## Ten verdicts to eyeball\n\nSampled deterministically from this run's per-query records. Human calibration check (§22, Q5).\n`;
  for (const r of sample) {
    out += `\n**${r.query_id}** — \`${r.tier}\` — **${r.verdict}**\n\n> ${r.query_text}\n\nReader: ${r.reader_answer.slice(0, 400).replace(/\n/g, " ")}\n\nRationale: ${r.rationale}\n`;
  }
  return out;
};

const whatThisMeans = (): string =>
  `\n## What this means\n\nThese numbers are a synthetic-corpus proxy for real retrieval quality. Fictional-domain corpora catch gross regressions (chunker bugs, embedding-model mismatches, ranking failures) but may miss domain-specific failures tied to idioms in real docs (L7). Judge bias toward verbose answers is bounded by a rubric and calibrated Sonnet prompts, not eliminated (L3). Regenerating the fixture between runs introduces LLM-authored variance that drowns retrieval signal (L4) — compare runs against the same fixture. Small-N runs (< 200) have wide CIs (L6). Treat the headline as a verdict, not a score.\n`;

const runManifestBlock = (results: ResultsFile): string =>
  `\n## Run manifest\n\n<details><summary>Full manifest</summary>\n\n\`\`\`yaml\n${yamlStringify(results.manifest)}\n\`\`\`\n\n</details>\n`;
