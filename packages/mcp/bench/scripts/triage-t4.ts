// author: Claude
/**
 * T4 multi-hop retrieval triage (not part of the run pipeline).
 *
 * A T4 query needs BOTH its relational chunk (`f-rel-*`) and its atomic chunk
 * (`f-atomic-*`) in the reader's top-5 to count as a recall hit (the `.every`
 * rule, `src/stages/06-retrieval.ts`). This script answers two questions about
 * every T4 miss, deterministically and without an LLM:
 *
 *   Level 1 (retrieval_results.json + ground_truth.json — no judge needed):
 *     which expected chunk is missing — atomic, relational, or both?
 *     Confirms the premise that the original query reliably surfaces the
 *     relational chunk and the gap is the atomic one.
 *
 *   Level 2 (optional multi_hop debug log): for each atomic-missing query, WHY
 *     the atomic chunk never reached the window — sorted into the failure
 *     sub-classes the fix levers map onto:
 *       - no-atomic-retrieval   → decompose-miss OR bridge-fail (planner never
 *                                 ran the atomic sub-query; lever = decompose /
 *                                 extract-bridge prompt).
 *       - atomic-not-in-cands   → the atomic sub-query (depth HOP_FETCH_K) did
 *                                 not surface the true chunk; lever = HOP_FETCH_K
 *                                 or wrong-bridge (extract-bridge prompt).
 *       - candidate-not-injected→ the atomic chunk WAS a sub-query candidate but
 *                                 injectAtomic did not place it in-window; lever
 *                                 = INJECT_SLOTS / the break-on-in-window rule.
 *
 * The debug log must be the JSON-lines output of a run with LOG_LEVEL=debug and
 * --log-json (so `multi_hop.atomic_candidates` lines are present).
 *
 * Usage:
 *   bun scripts/triage-t4.ts <run_dir> <fixture_dir> [debug_log]
 *   bun scripts/triage-t4.ts state/runs/20260615-XXXX \
 *       state/fixtures/RP6PNN3KW7Q2JS2R0GQ3Z00JZG /tmp/t4-debug.log
 */
import { readFileSync } from "fs";
import { join } from "path";
import { z } from "zod";

/** The reader window — a chunk must land in the top-`WINDOW_K` to count. */
const WINDOW_K = 5;
/** `text_preview` is `queryText.slice(0, 200)` in multi-hop.ts; match on that. */
const PREVIEW_LEN = 200;

const QuerySchema = z.object({
  id: z.string(),
  tier: z.string(),
  text: z.string(),
  expected_fact_ids: z.array(z.string()),
});
const QueriesSchema = z.object({ queries: z.array(QuerySchema) });

const ResolutionSchema = z.object({
  fact_id: z.string(),
  chunk_id: z.string().nullable(),
});
const GroundTruthSchema = z.object({ resolutions: z.array(ResolutionSchema) });

const RetrievalRecordSchema = z.object({
  query_id: z.string(),
  retrieved: z.array(z.object({ chunk_id: z.string() })),
});
const RetrievalResultsSchema = z.object({
  results: z.array(RetrievalRecordSchema),
});

type Level1 = "hit" | "atomic-missing" | "relational-missing" | "both-missing";
type Level2 =
  | "no-atomic-retrieval"
  | "atomic-not-in-cands"
  | "candidate-not-injected"
  | "relational-missing"
  | "n/a";

type Row = {
  qid: string;
  relChunk: string | undefined;
  atomicChunk: string | undefined;
  relIn: boolean;
  atomicIn: boolean;
  l1: Level1;
  l2: Level2;
  detail: string;
};

/** Index `multi_hop.atomic_candidates` debug lines by the original-query preview. */
const indexAtomicCandidates = (logPath: string): Map<string, string[]> => {
  const byPreview = new Map<string, string[]>();
  const raw = readFileSync(logPath, "utf-8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes("multi_hop.atomic_candidates")) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const parsed = z
      .object({
        message: z.string(),
        text_preview: z.string(),
        chunk_ids: z.array(z.string()),
      })
      .safeParse(obj);
    if (!parsed.success || parsed.data.message !== "multi_hop.atomic_candidates") continue;
    byPreview.set(parsed.data.text_preview, parsed.data.chunk_ids);
  }
  return byPreview;
};

const main = (): void => {
  const [runDir, fixtureDir, debugLog] = process.argv.slice(2);
  if (!runDir || !fixtureDir) {
    process.stderr.write(
      "usage: bun scripts/triage-t4.ts <run_dir> <fixture_dir> [debug_log]\n",
    );
    process.exit(64);
  }

  const queries = QueriesSchema.parse(
    JSON.parse(readFileSync(join(fixtureDir, "queries.json"), "utf-8")),
  );
  const gt = GroundTruthSchema.parse(
    JSON.parse(readFileSync(join(runDir, "ground_truth.json"), "utf-8")),
  );
  const retr = RetrievalResultsSchema.parse(
    JSON.parse(readFileSync(join(runDir, "retrieval_results.json"), "utf-8")),
  );

  const factToChunk = new Map<string, string>();
  for (const r of gt.resolutions) {
    if (r.chunk_id) factToChunk.set(r.fact_id, r.chunk_id);
  }
  const topByQuery = new Map<string, Set<string>>();
  for (const rec of retr.results) {
    topByQuery.set(
      rec.query_id,
      new Set(rec.retrieved.slice(0, WINDOW_K).map((c) => c.chunk_id)),
    );
  }
  const atomicCands = debugLog ? indexAtomicCandidates(debugLog) : undefined;

  const rows: Row[] = [];
  for (const q of queries.queries) {
    if (q.tier !== "T4") continue;
    const relFact = q.expected_fact_ids.find((f) => f.startsWith("f-rel-"));
    const atomicFact = q.expected_fact_ids.find((f) => f.startsWith("f-atomic-"));
    const relChunk = relFact ? factToChunk.get(relFact) : undefined;
    const atomicChunk = atomicFact ? factToChunk.get(atomicFact) : undefined;
    const top = topByQuery.get(q.id) ?? new Set<string>();
    const relIn = relChunk !== undefined && top.has(relChunk);
    const atomicIn = atomicChunk !== undefined && top.has(atomicChunk);

    const l1: Level1 = relIn && atomicIn
      ? "hit"
      : !relIn && !atomicIn
        ? "both-missing"
        : !atomicIn
          ? "atomic-missing"
          : "relational-missing";

    let l2: Level2 = "n/a";
    let detail = "";
    if (l1 === "atomic-missing" || l1 === "both-missing") {
      if (!relIn) {
        l2 = "relational-missing";
        detail = "relational chunk also absent from top-5";
      } else if (atomicCands) {
        const cands = atomicCands.get(q.text.slice(0, PREVIEW_LEN));
        if (!cands) {
          l2 = "no-atomic-retrieval";
          detail = "no atomic_candidates line (single-hop or bridge-fail)";
        } else if (atomicChunk && cands.includes(atomicChunk)) {
          l2 = "candidate-not-injected";
          detail = `atomic chunk at sub-query rank ${cands.indexOf(atomicChunk) + 1}/${cands.length}, not injected`;
        } else {
          l2 = "atomic-not-in-cands";
          detail = `atomic chunk absent from ${cands.length} sub-query candidates`;
        }
      } else {
        detail = "(pass debug_log for Level-2 sub-class)";
      }
    }
    rows.push({ qid: q.id, relChunk, atomicChunk, relIn, atomicIn, l1, l2, detail });
  }

  const out: string[] = [];
  const misses = rows.filter((r) => r.l1 !== "hit");
  out.push(
    `T4 triage — ${rows.length} queries, ${rows.length - misses.length} hits, ${misses.length} misses (run ${runDir})\n\n`,
  );
  out.push(
    `${"qid".padEnd(8)} ${"relIn".padEnd(6)} ${"atomIn".padEnd(7)} ${"level1".padEnd(18)} ${"level2".padEnd(24)} detail\n`,
  );
  out.push("-".repeat(110) + "\n");
  for (const r of misses) {
    out.push(
      `${r.qid.padEnd(8)} ${String(r.relIn).padEnd(6)} ${String(r.atomicIn).padEnd(7)} ${r.l1.padEnd(18)} ${r.l2.padEnd(24)} ${r.detail}\n`,
    );
  }

  // Level-1 histogram.
  const l1Classes: Level1[] = ["atomic-missing", "relational-missing", "both-missing"];
  out.push("\nLevel-1 (which chunk missing):\n");
  for (const c of l1Classes) {
    out.push(`  ${c.padEnd(20)} ${rows.filter((r) => r.l1 === c).length}\n`);
  }
  // Level-2 histogram (only meaningful with a debug log).
  if (atomicCands) {
    const l2Classes: Level2[] = [
      "no-atomic-retrieval",
      "atomic-not-in-cands",
      "candidate-not-injected",
      "relational-missing",
    ];
    out.push("\nLevel-2 (why atomic missed) → lever:\n");
    const lever: Record<string, string> = {
      "no-atomic-retrieval": "decompose / extract-bridge prompt",
      "atomic-not-in-cands": "HOP_FETCH_K / extract-bridge prompt",
      "candidate-not-injected": "INJECT_SLOTS / injectAtomic break-rule",
      "relational-missing": "base retrieval (rare)",
    };
    for (const c of l2Classes) {
      out.push(
        `  ${c.padEnd(24)} ${String(rows.filter((r) => r.l2 === c).length).padEnd(4)} → ${lever[c]}\n`,
      );
    }
  } else {
    out.push("\n(pass a debug_log path for the Level-2 sub-class histogram)\n");
  }

  process.stdout.write(out.join(""));
};

main();
