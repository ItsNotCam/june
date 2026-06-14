// author: Claude
/**
 * THROWAWAY judge-agreement screen — NOT part of the run pipeline.
 *
 * Re-judges an already-judged run's 180 reader answers with a second model
 * (deepseek-v4-pro) using the EXACT production judge prompt + parser, then
 * compares verdict-for-verdict against the Sonnet verdicts already on disk.
 * Answers: "can deepseek-v4-pro mirror the Anthropic (Sonnet) judge?"
 *
 * Strictly read-only on the repo:
 *   - reads run artifacts, fixture, and the scratch june.db (opened readonly)
 *   - makes ZERO Anthropic calls (reuses the existing Sonnet verdicts)
 *   - writes only to /tmp; never under state/runs; no git, no batch
 *
 * Usage:  bun scripts/judge-screen.ts   (from packages/mcp/bench)
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { Database } from "bun:sqlite";
import { loadConfig, getConfig } from "@/lib/config";
import { getEnv } from "@/lib/env";
import { renderChunksById } from "@/lib/sqlite";
import { renderPrompt } from "@/lib/prompts";
import { createDeepseekProvider } from "@/providers/deepseek";
import { parseVerdictPayload } from "@/judge/llm-judge";
import { mapConcurrent } from "@/lib/concurrency";

const RUN_DIR = "state/runs/20260614180533-Z61RJC6F";
const FIXTURE_DIR = "state/fixtures/RP6PNN3KW7Q2JS2R0GQ3Z00JZG";
const JUDGE_MODEL = "deepseek-v4-pro";
const CONCURRENCY = 8;
const REPORT_MD = "/tmp/judge-screen.md";
const REPORT_JSON = "/tmp/judge-screen.json";

const CLASSES = ["CORRECT", "PARTIAL", "INCORRECT", "REFUSED", "HALLUCINATED", "UNJUDGED"] as const;
type Cls = (typeof CLASSES)[number];

const readJson = (p: string): unknown => JSON.parse(readFileSync(p, "utf-8"));

const main = async (): Promise<void> => {
  await loadConfig(getEnv().CONFIG_PATH);
  const maxTokens = getConfig().roles.judge.max_tokens;
  const apiKey = getEnv().DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not set");
  const provider = createDeepseekProvider(apiKey);

  // --- load (read-only) ---
  const readerFile = readJson(join(RUN_DIR, "reader_answers.json")) as {
    answers: { query_id: string; answer_text: string; retrieved_chunk_ids: string[] }[];
  };
  const judgeFile = readJson(join(RUN_DIR, "judge_results.json")) as {
    verdicts: { query_id: string; verdict: string }[];
  };
  const manifest = readJson(join(RUN_DIR, "ingest_manifest.json")) as { scratch_path: string };
  const queriesRaw = readJson(join(FIXTURE_DIR, "queries.json")) as
    | { queries: QueryRec[] }
    | QueryRec[];
  const factsRaw = readJson(join(FIXTURE_DIR, "facts.json")) as
    | { facts: FactRec[] }
    | FactRec[];

  const queries = Array.isArray(queriesRaw) ? queriesRaw : queriesRaw.queries;
  const facts = Array.isArray(factsRaw) ? factsRaw : factsRaw.facts;
  const queryById = new Map(queries.map((q) => [q.id, q]));
  const surfaceById = new Map(facts.map((f) => [f.id, f.surface_hint]));

  // Sonnet verdicts: reader pass only (drop baseline_* siblings).
  const sonnetByQid = new Map<string, Cls>();
  for (const v of judgeFile.verdicts) {
    if (v.query_id.startsWith("baseline_")) continue;
    sonnetByQid.set(v.query_id, asCls(v.verdict));
  }

  const db = new Database(join(manifest.scratch_path, "june.db"), { readonly: true });

  // --- re-judge with deepseek-v4-pro using the production prompt + parser ---
  type Row = {
    query_id: string;
    tier: string;
    sonnet: Cls;
    deepseek: Cls;
    ds_rationale: string;
  };
  let done = 0;
  const rows: Row[] = await mapConcurrent(readerFile.answers, CONCURRENCY, async (ans) => {
    const q = queryById.get(ans.query_id);
    if (!q) throw new Error(`query not found: ${ans.query_id}`);
    const expected = q.expected_fact_ids
      .map((id) => surfaceById.get(id))
      .filter((s): s is string => s !== undefined);

    const content = await renderPrompt("judge", {
      query_tier: q.tier,
      query_text: q.text,
      expected_surface_hints_bulleted:
        expected.length > 0
          ? expected.map((s) => `- ${s}`).join("\n")
          : "- (no expected facts — T5 negative query)",
      reader_answer: ans.answer_text,
      retrieved_context:
        renderChunksById(db, ans.retrieved_chunk_ids) ||
        "(no retrieved context — this is a no-RAG baseline answer)",
    });

    let deepseek: Cls = "UNJUDGED";
    let ds_rationale = "";
    try {
      const res = await provider.call({
        model: JUDGE_MODEL,
        messages: [{ role: "user", content }],
        max_tokens: maxTokens,
        temperature: 0,
        response_format: "json",
      });
      const parsed = parseVerdictPayload(res.text);
      if (parsed) {
        deepseek = asCls(parsed.verdict);
        ds_rationale = parsed.rationale;
      } else {
        ds_rationale = `unparseable: ${res.text.slice(0, 120)}`;
      }
    } catch (err) {
      ds_rationale = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
    }
    done++;
    if (done % 20 === 0) process.stderr.write(`  judged ${done}/${readerFile.answers.length}\n`);
    return {
      query_id: ans.query_id,
      tier: q.tier,
      sonnet: sonnetByQid.get(ans.query_id) ?? "UNJUDGED",
      deepseek,
      ds_rationale,
    };
  });
  db.close();

  // --- compare ---
  const n = rows.length;
  const agree = rows.filter((r) => r.sonnet === r.deepseek).length;
  const po = agree / n;
  const kappa = cohensKappa(rows.map((r) => [r.sonnet, r.deepseek]));

  const perTier = (["T1", "T2", "T3", "T4"] as const).map((t) => {
    const tr = rows.filter((r) => r.tier === t);
    const a = tr.filter((r) => r.sonnet === r.deepseek).length;
    return { tier: t, n: tr.length, agree: a, pct: tr.length ? a / tr.length : 0 };
  });

  // Decision-critical slices.
  const t4 = rows.filter((r) => r.tier === "T4");
  const t4Boundary = t4.filter(
    (r) =>
      (r.sonnet === "CORRECT" || r.sonnet === "PARTIAL") &&
      (r.deepseek === "CORRECT" || r.deepseek === "PARTIAL"),
  );
  const t4BoundaryAgree = t4Boundary.filter((r) => r.sonnet === r.deepseek).length;
  const refusedSlice = sliceAgreement(rows, "REFUSED");
  const halSlice = sliceAgreement(rows, "HALLUCINATED");

  const matrix = confusion(rows);
  const disagreements = rows.filter((r) => r.sonnet !== r.deepseek);

  // --- report ---
  const L: string[] = [];
  L.push(`# Judge-agreement screen — Sonnet vs ${JUDGE_MODEL}`);
  L.push(`Run ${RUN_DIR}  ·  n=${n} reader answers  ·  thinking DISABLED (provider default)\n`);
  L.push(`## Headline`);
  L.push(`- Overall agreement: **${pct(po)}** (${agree}/${n})`);
  L.push(`- Cohen's κ: **${kappa.toFixed(3)}** ${kappaLabel(kappa)}`);
  L.push(
    `- T4 CORRECT↔PARTIAL boundary agreement: **${pct(t4Boundary.length ? t4BoundaryAgree / t4Boundary.length : 0)}** (${t4BoundaryAgree}/${t4Boundary.length}) — the decision-critical slice`,
  );
  L.push(`- REFUSED agreement: ${fmtSlice(refusedSlice)}`);
  L.push(`- HALLUCINATED agreement: ${fmtSlice(halSlice)}\n`);

  L.push(`## Per-tier agreement`);
  L.push(`| tier | n | agree | % |`);
  L.push(`|---|--:|--:|--:|`);
  for (const t of perTier) L.push(`| ${t.tier} | ${t.n} | ${t.agree} | ${pct(t.pct)} |`);
  L.push("");

  L.push(`## Confusion matrix (rows = Sonnet, cols = ${JUDGE_MODEL})`);
  L.push(`| Sonnet \\ DS | ${CLASSES.join(" | ")} |`);
  L.push(`|---|${CLASSES.map(() => "--:").join("|")}|`);
  for (const s of CLASSES) {
    const row = CLASSES.map((d) => matrix[s][d] || "").join(" | ");
    if (CLASSES.some((d) => matrix[s][d] > 0)) L.push(`| **${s}** | ${row} |`);
  }
  L.push("");

  L.push(`## Disagreements (${disagreements.length})`);
  for (const r of disagreements) {
    L.push(`- **${r.query_id}** [${r.tier}] Sonnet=${r.sonnet} → DS=${r.deepseek}`);
    L.push(`    DS: ${r.ds_rationale.slice(0, 200)}`);
  }

  const report = L.join("\n");
  writeFileSync(REPORT_MD, report);
  writeFileSync(
    REPORT_JSON,
    JSON.stringify({ overall: po, kappa, perTier, t4Boundary: { agree: t4BoundaryAgree, n: t4Boundary.length }, matrix, rows }, null, 2),
  );
  process.stdout.write(report + `\n\nWrote ${REPORT_MD} and ${REPORT_JSON}\n`);
};

type QueryRec = { id: string; tier: string; text: string; expected_fact_ids: string[] };
type FactRec = { id: string; surface_hint: string };

const asCls = (v: string): Cls => (CLASSES.includes(v as Cls) ? (v as Cls) : "UNJUDGED");
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

const sliceAgreement = (
  rows: { sonnet: Cls; deepseek: Cls }[],
  cls: Cls,
): { sonnetN: number; bothN: number; dsN: number } => {
  const sonnetN = rows.filter((r) => r.sonnet === cls).length;
  const dsN = rows.filter((r) => r.deepseek === cls).length;
  const bothN = rows.filter((r) => r.sonnet === cls && r.deepseek === cls).length;
  return { sonnetN, bothN, dsN };
};
const fmtSlice = (s: { sonnetN: number; bothN: number; dsN: number }): string =>
  `${s.bothN}/${s.sonnetN} of Sonnet's caught (DS flagged ${s.dsN} total)`;

const confusion = (rows: { sonnet: Cls; deepseek: Cls }[]): Record<Cls, Record<Cls, number>> => {
  const m = Object.fromEntries(
    CLASSES.map((s) => [s, Object.fromEntries(CLASSES.map((d) => [d, 0]))]),
  ) as Record<Cls, Record<Cls, number>>;
  for (const r of rows) m[r.sonnet][r.deepseek]++;
  return m;
};

const cohensKappa = (pairs: [Cls, Cls][]): number => {
  const n = pairs.length;
  if (n === 0) return 0;
  const po = pairs.filter(([a, b]) => a === b).length / n;
  const aCount: Record<string, number> = {};
  const bCount: Record<string, number> = {};
  for (const [a, b] of pairs) {
    aCount[a] = (aCount[a] ?? 0) + 1;
    bCount[b] = (bCount[b] ?? 0) + 1;
  }
  let pe = 0;
  for (const c of CLASSES) pe += ((aCount[c] ?? 0) / n) * ((bCount[c] ?? 0) / n);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
};

const kappaLabel = (k: number): string =>
  k >= 0.8 ? "(almost perfect)" : k >= 0.6 ? "(substantial)" : k >= 0.4 ? "(moderate)" : k >= 0.2 ? "(fair)" : "(poor)";

main();
