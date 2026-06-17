// author: Claude
import { stringify as yamlStringify } from "yaml";
import type { MetricWithCi, RunStatus } from "@/types/results";
import type {
  HoldoutManifest,
  HoldoutPerQuery,
  HoldoutQuery,
  HoldoutResultsFile,
} from "@/types/holdout";
import type { JudgeProvenance, VerdictsFile } from "@/types/judge-tasks";
import type { VerdictRecord } from "@/types/judge";
import { BASELINE_QUERY_PREFIX } from "@/types/judge";
import type { Verdict } from "@/types/verdict";
import { computeBootstrapCi, type PerQueryValue } from "@/lib/bootstrap";
import { computeDocRecall, computeDocMrr, median, type RetrievedDoc } from "@/lib/holdout";

/**
 * Holdout scoring + report (§ RSI Phase 4) — the doc-native analog of Stage 9.
 *
 * Pure code: aggregates per-query doc-level retrieval + reader verdicts into the
 * holdout's answerable / unanswerable blocks (with bootstrap CIs) and renders a
 * summary that **leads with retrieval** and carries the parametric-knowledge
 * caveat. Retrieval metrics are deterministic and final at `run-holdout` time;
 * the reader verdicts are overlaid later from external agent verdicts
 * (`rescoreHoldoutWithVerdicts`), exactly like the synthetic external-judge seam.
 */

/** Input to build one per-query record (retrieval already resolved to docs). */
export type HoldoutPerQueryInput = {
  query: HoldoutQuery;
  expected_doc_ids: string[];
  /** Retrieved chunks projected to docs, in rank order. */
  retrieved: RetrievedDoc[];
  reader_answer: string;
  baseline_answer: string | null;
};

/** Builds per-query records with doc-level retrieval metrics; verdicts start UNJUDGED. */
export const buildHoldoutPerQuery = (
  inputs: readonly HoldoutPerQueryInput[],
): HoldoutPerQuery[] =>
  inputs.map((inp) => {
    const recall_at_k = {
      "1": computeDocRecall(inp.expected_doc_ids, inp.retrieved, 1),
      "3": computeDocRecall(inp.expected_doc_ids, inp.retrieved, 3),
      "5": computeDocRecall(inp.expected_doc_ids, inp.retrieved, 5),
      "10": computeDocRecall(inp.expected_doc_ids, inp.retrieved, 10),
    };
    return {
      query_id: inp.query.id,
      query_text: inp.query.text,
      unanswerable: inp.query.unanswerable,
      expected_doc_ids: inp.expected_doc_ids,
      expected_doc_filenames: inp.query.expected_doc_filenames,
      retrieved_chunk_ids: inp.retrieved.map((r) => r.chunk_id),
      retrieved_doc_ids: inp.retrieved.map((r) => r.doc_id),
      recall_at_k,
      mrr: computeDocMrr(inp.expected_doc_ids, inp.retrieved),
      top1_score: inp.retrieved[0]?.score ?? null,
      reader_answer: inp.reader_answer,
      verdict: "UNJUDGED" as Verdict,
      rationale: "",
      baseline_answer: inp.baseline_answer,
      baseline_verdict: null,
    };
  });

/** A holdout answer is correct when it CONVEYS the answer (answerable) or REFUSES (unanswerable). */
const correctForQuery = (unanswerable: boolean, verdict: Verdict | null): boolean =>
  unanswerable ? verdict === "REFUSED" : verdict === "CORRECT";

type Aggregates = Pick<
  HoldoutResultsFile,
  "answerable" | "unanswerable" | "reader_rag_correct_pct" | "reader_norag_correct_pct"
>;

/** Aggregates per-query records into the holdout's answerable/unanswerable blocks. */
export const aggregateHoldout = (
  per_query: readonly HoldoutPerQuery[],
  run_id: string,
): Aggregates => {
  const seed = (m: string): string => `${run_id}:${m}:holdout`;
  const answerable = per_query.filter((r) => !r.unanswerable);
  const unanswerable = per_query.filter((r) => r.unanswerable);

  const recallMetric = (k: 1 | 3 | 5 | 10): MetricWithCi =>
    computeBootstrapCi(
      answerable.map<PerQueryValue>((r) => ({
        query_id: r.query_id,
        value: r.recall_at_k[String(k) as "1" | "3" | "5" | "10"],
      })),
      seed(`recall_at_${k}`),
    );

  const hasBaseline = per_query.some((r) => r.baseline_answer !== null);

  return {
    answerable: {
      query_count: answerable.length,
      recall_at_1: recallMetric(1),
      recall_at_3: recallMetric(3),
      recall_at_5: recallMetric(5),
      recall_at_10: recallMetric(10),
      mrr: computeBootstrapCi(
        answerable.map<PerQueryValue>((r) => ({ query_id: r.query_id, value: r.mrr })),
        seed("mrr"),
      ),
      reader_correct_pct: computeBootstrapCi(
        answerable.map<PerQueryValue>((r) => ({
          query_id: r.query_id,
          value: r.verdict === "CORRECT" ? 1 : 0,
        })),
        seed("answerable_reader_correct"),
      ),
    },
    unanswerable: {
      query_count: unanswerable.length,
      reader_refused_pct: computeBootstrapCi(
        unanswerable.map<PerQueryValue>((r) => ({
          query_id: r.query_id,
          value: r.verdict === "REFUSED" ? 1 : 0,
        })),
        seed("unanswerable_reader_refused"),
      ),
      top1_score_median: median(
        unanswerable
          .map((r) => r.top1_score)
          .filter((s): s is number => s !== null),
      ),
    },
    reader_rag_correct_pct: computeBootstrapCi(
      per_query.map<PerQueryValue>((r) => ({
        query_id: r.query_id,
        value: correctForQuery(r.unanswerable, r.verdict) ? 1 : 0,
      })),
      seed("reader_rag_correct"),
    ),
    reader_norag_correct_pct: hasBaseline
      ? computeBootstrapCi(
          per_query.map<PerQueryValue>((r) => ({
            query_id: r.query_id,
            value: correctForQuery(r.unanswerable, r.baseline_verdict) ? 1 : 0,
          })),
          seed("reader_norag_correct"),
        )
      : null,
  };
};

/** Assembles a full `HoldoutResultsFile` from per-query records + manifest. */
export const buildHoldoutResults = (args: {
  holdout_id: string;
  holdout_hash: string;
  run_id: string;
  run_status: RunStatus;
  started_at: string;
  completed_at: string;
  manifest: HoldoutManifest;
  per_query: HoldoutPerQuery[];
  queries_with_unknown_doc: number;
  cost_usd: HoldoutResultsFile["cost_usd"];
}): HoldoutResultsFile => {
  const agg = aggregateHoldout(args.per_query, args.run_id);
  const unjudged = args.per_query.filter((r) => r.verdict === "UNJUDGED").length;
  return {
    kind: "holdout",
    sealed: true,
    holdout_id: args.holdout_id,
    holdout_hash: args.holdout_hash,
    run_id: args.run_id,
    schema_version: 1,
    run_status: args.run_status,
    started_at: args.started_at,
    completed_at: args.completed_at,
    manifest: args.manifest,
    ...agg,
    per_query: args.per_query,
    integrity: {
      unjudged_pct: args.per_query.length === 0 ? 0 : unjudged / args.per_query.length,
      queries_with_unknown_doc: args.queries_with_unknown_doc,
    },
    cost_usd: args.cost_usd,
  };
};

/**
 * Finalizes an `awaiting_verdicts` holdout from external agent verdicts — the
 * doc-native sibling of `rescoreWithVerdicts`. Overlays reader + baseline
 * verdicts onto the partial's per-query records and re-aggregates; retrieval
 * metrics are untouched (deterministic, already final).
 */
export const rescoreHoldoutWithVerdicts = (args: {
  partial: HoldoutResultsFile;
  verdicts: readonly VerdictRecord[];
  judge: JudgeProvenance;
  run_status: RunStatus;
  completed_at: string;
}): HoldoutResultsFile => {
  const readerVerdict = new Map(
    args.verdicts
      .filter((v) => !v.query_id.startsWith(BASELINE_QUERY_PREFIX))
      .map((v) => [v.query_id, v]),
  );
  const baselineVerdict = new Map(
    args.verdicts
      .filter((v) => v.query_id.startsWith(BASELINE_QUERY_PREFIX))
      .map((v) => [v.query_id.slice(BASELINE_QUERY_PREFIX.length), v]),
  );

  const per_query: HoldoutPerQuery[] = args.partial.per_query.map((r) => {
    const v = readerVerdict.get(r.query_id);
    const bv = baselineVerdict.get(r.query_id);
    return {
      ...r,
      verdict: v?.verdict ?? "UNJUDGED",
      rationale: v?.rationale ?? "",
      baseline_verdict: r.baseline_answer !== null ? (bv?.verdict ?? "UNJUDGED") : null,
    };
  });

  const agg = aggregateHoldout(per_query, args.partial.run_id);
  const unjudged = per_query.filter((r) => r.verdict === "UNJUDGED").length;
  return {
    ...args.partial,
    run_status: args.run_status,
    completed_at: args.completed_at,
    manifest: {
      ...args.partial.manifest,
      completed_at: args.completed_at,
      judge: {
        provider: args.judge.kind,
        model: args.judge.model,
        prompt_template_hash: args.judge.prompt_template_hash,
      },
    },
    ...agg,
    per_query,
    integrity: {
      ...args.partial.integrity,
      unjudged_pct: per_query.length === 0 ? 0 : unjudged / per_query.length,
    },
  };
};

/** Light structural validation of an agent-produced `verdicts.json` for a holdout run. */
export const validateHoldoutVerdicts = (raw: unknown): VerdictsFile => {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("verdicts.json is not an object");
  }
  const file = raw as VerdictsFile;
  if (!Array.isArray(file.verdicts)) {
    throw new Error("verdicts.json has no `verdicts` array");
  }
  if (!file.judge || typeof file.judge.model !== "string") {
    throw new Error("verdicts.json has no `judge.model`");
  }
  return file;
};

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const metricCell = (m: MetricWithCi): string =>
  `${pct(m.point)} [${pct(m.ci_low)}, ${pct(m.ci_high)}]`;

/**
 * Renders `holdout_summary.md`. Retrieval LEADS (it's the un-contaminated
 * signal); the reader block carries the loud parametric-knowledge caveat.
 */
export const renderHoldoutSummary = (results: HoldoutResultsFile): string => {
  const a = results.answerable;
  const u = results.unanswerable;
  const parts: string[] = [];

  parts.push(
    `> 🔒 **SEALED REAL-DOC HOLDOUT** — reader \`${results.manifest.reader.model}\` (mode \`${results.manifest.mode}\`). ` +
      `Reported SEPARATELY; **never pinned, gated, or tuned against.** Synthetic↔holdout divergence is the reward-hacking alarm.\n`,
  );
  parts.push(`# Holdout results — \`${results.run_id}\`\n`);
  parts.push(
    `**Source:** ${results.manifest.source.name} (${results.manifest.source.doc_count} real docs) · ` +
      `${a.query_count} answerable + ${u.query_count} unanswerable queries.\n`,
  );

  if (results.run_status === "awaiting_verdicts") {
    parts.push(
      `\n> ⏳ **Awaiting verdicts.** Retrieval metrics below are FINAL; reader correctness is pending external agent judging.\n`,
    );
  }

  // 1. Retrieval — leads, because it is NOT contaminated by parametric memory.
  parts.push(`\n## Retrieval (doc-level, answerable only) — the trustworthy signal\n`);
  parts.push(`| Metric | Value | 95% CI |\n|---|---|---|`);
  parts.push(`| Recall@1 | ${pct(a.recall_at_1.point)} | [${pct(a.recall_at_1.ci_low)}, ${pct(a.recall_at_1.ci_high)}] |`);
  parts.push(`| Recall@5 | ${pct(a.recall_at_5.point)} | [${pct(a.recall_at_5.ci_low)}, ${pct(a.recall_at_5.ci_high)}] |`);
  parts.push(`| Recall@10 | ${pct(a.recall_at_10.point)} | [${pct(a.recall_at_10.ci_low)}, ${pct(a.recall_at_10.ci_high)}] |`);
  parts.push(`| MRR | ${pct(a.mrr.point)} | [${pct(a.mrr.ci_low)}, ${pct(a.mrr.ci_high)}] |`);
  parts.push(
    `\n<sub>Doc-level recall@k = a chunk from a labeled expected document appears in top-k. No synthetic facts, no Stage-5 resolution.</sub>\n`,
  );

  // 2. Reader — secondary, with the caveat.
  parts.push(`\n## Reader (secondary — read the caveat)\n`);
  parts.push(`| Metric | Value | 95% CI |\n|---|---|---|`);
  parts.push(`| Answerable correct% (RAG) | ${metricCell(a.reader_correct_pct)} |`);
  parts.push(`| Unanswerable refused% | ${metricCell(u.reader_refused_pct)} |`);
  parts.push(`| Overall correct% (RAG) | ${metricCell(results.reader_rag_correct_pct)} |`);
  if (results.reader_norag_correct_pct) {
    const delta =
      results.reader_rag_correct_pct.point - results.reader_norag_correct_pct.point;
    parts.push(`| Overall correct% (no-RAG, same reader) | ${metricCell(results.reader_norag_correct_pct)} |`);
    parts.push(
      `\n**RAG vs no-RAG delta: ${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}pp.** ` +
        `This — not the absolute correct% — is the honest reader signal: how much retrieval ADDS on top of what the reader already knows.\n`,
    );
  }

  // 3. The validity trap, stated loudly (the holdout's L-caveat).
  parts.push(
    `\n## ⚠️ Parametric-knowledge caveat (HOLDOUT-L1)\n\n` +
      `The reader and the judge agents were trained on real ${results.manifest.source.name}. They have ` +
      `**parametric knowledge of these answers**, so reader-correct% can be satisfied from MEMORY, not retrieval — it is ` +
      `NOT a clean measure of RAG quality on this holdout. **Trust the retrieval metrics** (recall@k/MRR over the labeled ` +
      `expected docs); they are immune to parametric memory. Treat reader-correct% as secondary, and the RAG−noRAG delta as ` +
      `the only honest reader signal. A holdout exists to be DIVERGENT from the synthetic fixture, never to be optimized.\n`,
  );

  parts.push(`\n## Integrity\n`);
  parts.push(`- UNJUDGED: ${pct(results.integrity.unjudged_pct)}`);
  parts.push(`- Queries with an unresolved expected doc: ${results.integrity.queries_with_unknown_doc}`);
  parts.push(`- Total cost: $${results.cost_usd.total.toFixed(4)}`);
  if (u.top1_score_median !== null) {
    parts.push(`- Unanswerable top-1 retrieval-score median: ${u.top1_score_median.toFixed(3)}`);
  }

  parts.push(
    `\n## Run manifest\n\n<details><summary>Full manifest</summary>\n\n\`\`\`yaml\n${yamlStringify(results.manifest)}\n\`\`\`\n\n</details>\n`,
  );
  return parts.join("\n");
};
