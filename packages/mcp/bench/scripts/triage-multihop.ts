// author: Claude
/**
 * Multi-hop retrieval triage (T4 / T6 / T7) — not part of the run pipeline.
 *
 * An N-hop query needs ALL N of its gold chunks (`(N-1)` relational `f-rel-*` +
 * one atomic `f-atomic-*`) in the reader's top-`WINDOW_K` to count as a recall
 * hit (the `.every` rule, `src/stages/06-retrieval.ts`). This script answers,
 * deterministically and without an LLM, which gold chunk is missing on every
 * miss and — with a debug log — WHY, sorted into the failure sub-classes the fix
 * levers map onto.
 *
 *   Level 1 (retrieval_results.json + ground_truth.json — no judge needed):
 *     which expected chunk(s) are missing — per gold position (rel1, rel2, …,
 *     atomic). `rel1` is the only relational chunk with a base-query hook; the
 *     rest are injected during the chain walk.
 *
 *   Level 2 (debug log with `multi_hop.*` lines) — per MISSING gold chunk:
 *     - gold-base-evicted-by-injection → the chunk WAS in the pre-injection base
 *         window but the injected reserve pushed it out of the final top-k.
 *         Lever = per-tier `reader_eval.k` / fewer inject slots. (The window-
 *         pressure failure the deep-hop tiers are most exposed to.)
 *     - base-retrieval-miss (rel1 only) → rel1 never even reached the base
 *         window. Lever = base retrieval (rare).
 *     - candidate-not-injected → the chunk WAS a sub-query candidate but was not
 *         placed in-window. Lever = INJECT_SLOTS / the injectChunks merge.
 *     - not-in-candidates → the chunk never appeared among any sub-query's
 *         candidates. Lever = HOP_FETCH_K / decompose / extract-bridge prompt.
 *
 * The debug log must be the JSON-lines output of a run with LOG_LEVEL=debug and
 * --log-json (so `multi_hop.base_window` / `hop_candidates` / `atomic_candidates`
 * lines are present).
 *
 * Usage:
 *   bun scripts/triage-multihop.ts <run_dir> <fixture_dir> [debug_log]
 */
import { readFileSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { isMultiHopTier, type QueryTier } from "@/types/query";

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
const RetrievalResultsSchema = z.object({ results: z.array(RetrievalRecordSchema) });

type Level2 =
  | "gold-base-evicted-by-injection"
  | "base-retrieval-miss"
  | "candidate-not-injected"
  | "not-in-candidates"
  | "n/a";

type GoldMiss = {
  label: string; // rel1 / rel2 / … / atomic
  chunk: string;
  l2: Level2;
};

type Row = {
  qid: string;
  tier: string;
  goldCount: number;
  presentCount: number;
  misses: GoldMiss[];
};

const LEVER: Record<Level2, string> = {
  "gold-base-evicted-by-injection": "per-tier reader_eval.k / fewer inject slots",
  "base-retrieval-miss": "base retrieval (rare)",
  "candidate-not-injected": "INJECT_SLOTS / injectChunks merge",
  "not-in-candidates": "HOP_FETCH_K / decompose / extract-bridge prompt",
  "n/a": "(pass debug_log for the sub-class)",
};

/** Per-query debug telemetry, keyed by the original-query preview. */
type DebugIndex = {
  baseWindow: Map<string, Set<string>>;
  /** Union of all sub-query candidate chunk ids (hop_candidates ∪ atomic_candidates). */
  subCandidates: Map<string, Set<string>>;
  /** Whether ANY sub-query candidate line exists for this preview at all. */
  hasAtomicLine: Set<string>;
};

const indexDebug = (logPath: string): DebugIndex => {
  const baseWindow = new Map<string, Set<string>>();
  const subCandidates = new Map<string, Set<string>>();
  const hasAtomicLine = new Set<string>();
  const LineSchema = z.object({
    message: z.string(),
    text_preview: z.string(),
    chunk_ids: z.array(z.string()),
  });
  const addSub = (preview: string, ids: string[]): void => {
    const set = subCandidates.get(preview) ?? new Set<string>();
    for (const id of ids) set.add(id);
    subCandidates.set(preview, set);
  };
  for (const line of readFileSync(logPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes("multi_hop.")) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const parsed = LineSchema.safeParse(obj);
    if (!parsed.success) continue;
    const { message, text_preview, chunk_ids } = parsed.data;
    if (message === "multi_hop.base_window") baseWindow.set(text_preview, new Set(chunk_ids));
    else if (message === "multi_hop.hop_candidates") addSub(text_preview, chunk_ids);
    else if (message === "multi_hop.atomic_candidates") {
      addSub(text_preview, chunk_ids);
      hasAtomicLine.add(text_preview);
    }
  }
  return { baseWindow, subCandidates, hasAtomicLine };
};

/** Classify one missing gold chunk into its failure sub-class. */
const classify = (
  chunk: string,
  isRel1: boolean,
  preview: string,
  debug: DebugIndex | undefined,
): Level2 => {
  if (!debug) return "n/a";
  const inBase = debug.baseWindow.get(preview)?.has(chunk) ?? false;
  if (inBase) return "gold-base-evicted-by-injection";
  if (isRel1) return "base-retrieval-miss"; // rel1 is base-hooked, not injected
  const cands = debug.subCandidates.get(preview);
  if (!cands) return "not-in-candidates";
  return cands.has(chunk) ? "candidate-not-injected" : "not-in-candidates";
};

const main = (): void => {
  const [runDir, fixtureDir, debugLog] = process.argv.slice(2);
  if (!runDir || !fixtureDir) {
    process.stderr.write("usage: bun scripts/triage-multihop.ts <run_dir> <fixture_dir> [debug_log]\n");
    process.exit(64);
  }

  const queries = QueriesSchema.parse(JSON.parse(readFileSync(join(fixtureDir, "queries.json"), "utf-8")));
  const gt = GroundTruthSchema.parse(JSON.parse(readFileSync(join(runDir, "ground_truth.json"), "utf-8")));
  const retr = RetrievalResultsSchema.parse(
    JSON.parse(readFileSync(join(runDir, "retrieval_results.json"), "utf-8")),
  );

  const factToChunk = new Map<string, string>();
  for (const r of gt.resolutions) {
    if (r.chunk_id) factToChunk.set(r.fact_id, r.chunk_id);
  }
  const topByQuery = new Map<string, Set<string>>();
  for (const rec of retr.results) {
    topByQuery.set(rec.query_id, new Set(rec.retrieved.slice(0, WINDOW_K).map((c) => c.chunk_id)));
  }
  const debug = debugLog ? indexDebug(debugLog) : undefined;

  const rows: Row[] = [];
  for (const q of queries.queries) {
    if (!isMultiHopTier(q.tier as QueryTier)) continue;
    // Gold chunks in CHAIN order: relationals as they appear in expected_fact_ids
    // (rel1 first — the base-hooked hop), then the atomic.
    const relFacts = q.expected_fact_ids.filter((f) => f.startsWith("f-rel-"));
    const atomicFact = q.expected_fact_ids.find((f) => f.startsWith("f-atomic-"));
    const gold: Array<{ label: string; chunk: string | undefined; isRel1: boolean }> = [
      ...relFacts.map((f, i) => ({ label: `rel${i + 1}`, chunk: factToChunk.get(f), isRel1: i === 0 })),
      { label: "atomic", chunk: atomicFact ? factToChunk.get(atomicFact) : undefined, isRel1: false },
    ];
    const top = topByQuery.get(q.id) ?? new Set<string>();
    const preview = q.text.slice(0, PREVIEW_LEN);

    const misses: GoldMiss[] = [];
    let presentCount = 0;
    for (const g of gold) {
      if (g.chunk && top.has(g.chunk)) {
        presentCount++;
        continue;
      }
      misses.push({
        label: g.label,
        chunk: g.chunk ?? "(unresolved)",
        l2: g.chunk ? classify(g.chunk, g.isRel1, preview, debug) : "n/a",
      });
    }
    rows.push({ qid: q.id, tier: q.tier, goldCount: gold.length, presentCount, misses });
  }

  const out: string[] = [];
  const missRows = rows.filter((r) => r.misses.length > 0);
  out.push(
    `multi-hop triage — ${rows.length} queries, ${rows.length - missRows.length} hits, ${missRows.length} misses (run ${runDir})\n\n`,
  );
  out.push(`${"qid".padEnd(8)} ${"tier".padEnd(5)} ${"gold".padEnd(5)} missing (label:chunk → sub-class)\n`);
  out.push("-".repeat(100) + "\n");
  for (const r of missRows) {
    const detail = r.misses.map((m) => `${m.label}:${m.chunk}→${m.l2}`).join("  ");
    out.push(`${r.qid.padEnd(8)} ${r.tier.padEnd(5)} ${`${r.presentCount}/${r.goldCount}`.padEnd(5)} ${detail}\n`);
  }

  // Sub-class histogram over all missing gold chunks.
  const allMisses = missRows.flatMap((r) => r.misses);
  out.push("\nSub-class (why a gold chunk missed) → lever:\n");
  const classes: Level2[] = [
    "gold-base-evicted-by-injection",
    "base-retrieval-miss",
    "candidate-not-injected",
    "not-in-candidates",
    "n/a",
  ];
  for (const c of classes) {
    const n = allMisses.filter((m) => m.l2 === c).length;
    if (n === 0 && c === "n/a") continue;
    out.push(`  ${c.padEnd(34)} ${String(n).padEnd(4)} → ${LEVER[c]}\n`);
  }
  if (!debug) out.push("\n(pass a debug_log path for the sub-class histogram)\n");

  process.stdout.write(out.join(""));
};

main();
