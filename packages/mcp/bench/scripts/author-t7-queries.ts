// author: Claude
/**
 * One-off T7 (4-hop) query authoring + splice — NOT part of the run pipeline.
 *
 * Phase 3 wired the T7 tier, but producing real T7 questions normally runs the
 * Anthropic Sonnet `query_author`, which was out of credits. The T7 chains only
 * reference facts ALREADY in the deep-hop fixture's corpus/ingest, so the corpus
 * author is not needed — only the query *text*. This script carries the exact
 * `(fact_ids, question)` pairs authored in-session (model-generic phrasing that
 * names only the start entity and hides all three bridges), verifies each chain
 * is a real `A→B→C→D` path ending at its atomic fact, computes the real
 * anti-leakage score, and appends T7 rows to the fixture's `queries.json`.
 *
 * It APPENDS, so run once on a fixture with no T7 rows (restore `queries.json`
 * from VCS/backup first if re-running). Evaluate with `--skip-ingest` against the
 * existing ingest — no re-ingest, no Anthropic. The questions are Opus-authored
 * (a mild authorship difference vs the Sonnet-authored T1–T6); for a brand-new
 * tier with no prior baseline this is acceptable, and the gemma control run
 * certifies the result. A full Sonnet regenerate supersedes this once credits
 * return.
 *
 * Usage:
 *   bun scripts/author-t7-queries.ts <fixture_dir>
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { jaccardOverlap } from "@/lib/tokens";

/**
 * Authoritative T7 set: each chain's `[R1, R2, R3, atomic]` fact ids paired with
 * the authored 4-hop question. Order is irrelevant — chains are matched by id.
 */
const T7: ReadonlyArray<{ fact_ids: [string, string, string, string]; text: string }> = [
  { fact_ids: ["f-rel-0009", "f-rel-0034", "f-rel-0003", "f-atomic-0064"], text: "How long does the handshake take for the framework depended on by the protocol depended on by the system that Snorblath Protocol supersedes?" },
  { fact_ids: ["f-rel-0012", "f-rel-0038", "f-rel-0028", "f-atomic-0065"], text: "Which port is used for control messages by the system that the session interoperating with the signal that Snorblath Protocol tunnels through authenticates via?" },
  { fact_ids: ["f-rel-0016", "f-rel-0017", "f-rel-0034", "f-atomic-0007"], text: "What compression algorithm is used by the protocol depended on by the system tunneled through by the transport that Viznet Exchange authenticates via?" },
  { fact_ids: ["f-rel-0039", "f-rel-0016", "f-rel-0017", "f-atomic-0069"], text: "What is the maximum packet size of the system tunneled through by the transport that the exchange Kreznak Signal tunnels through authenticates via?" },
  { fact_ids: ["f-rel-0020", "f-rel-0006", "f-rel-0025", "f-atomic-0063"], text: "What compression algorithm is used by the framework superseded by the session depended on by the protocol that Dargwave Transport authenticates via?" },
  { fact_ids: ["f-rel-0007", "f-rel-0033", "f-rel-0018", "f-atomic-0004"], text: "What is the session timeout of the protocol superseded by the transport extended by the system that Froznet v2 supersedes?" },
  { fact_ids: ["f-rel-0031", "f-rel-0011", "f-rel-0022", "f-atomic-0033"], text: "Which port is used for control messages by the transport that interoperates with the layer wrapped by the protocol that Plirnode Framework supersedes?" },
  { fact_ids: ["f-rel-0037", "f-rel-0009", "f-rel-0035", "f-atomic-0031"], text: "What compression algorithm is used by the exchange superseded by the system superseded by the protocol that Kreznak Signal authenticates via?" },
  { fact_ids: ["f-rel-0023", "f-rel-0006", "f-rel-0026", "f-atomic-0036"], text: "What is the session timeout of the transport tunneled through by the session depended on by the protocol that Querban Layer supersedes?" },
  { fact_ids: ["f-rel-0005", "f-rel-0029", "f-rel-0038", "f-atomic-0053"], text: "What is the maximum packet size of the session that interoperates with the signal tunneled through by the framework that Froznet v2 extends?" },
  { fact_ids: ["f-rel-0028", "f-rel-0035", "f-rel-0014", "f-atomic-0077"], text: "What is the maximum packet size of the signal depended on by the exchange superseded by the system that Wexmar Session authenticates via?" },
  { fact_ids: ["f-rel-0018", "f-rel-0003", "f-rel-0032", "f-atomic-0043"], text: "How often does the layer extended by the framework depended on by the protocol that Dargwave Transport supersedes send heartbeats?" },
  { fact_ids: ["f-rel-0002", "f-rel-0011", "f-rel-0022", "f-atomic-0034"], text: "Which port is used for data transfer by the transport that interoperates with the layer wrapped by the protocol that Glorbulon Protocol wraps?" },
  { fact_ids: ["f-rel-0027", "f-rel-0040", "f-rel-0035", "f-atomic-0026"], text: "Which port is used for data transfer by the exchange superseded by the system superseded by the signal that Wexmar Session wraps?" },
  { fact_ids: ["f-rel-0030", "f-rel-0008", "f-rel-0002", "f-atomic-0019"], text: "How often does the protocol wrapped by the protocol that the system Plirnode Framework depends on authenticates via send heartbeats?" },
];

const RelSchema = z.object({ id: z.string(), kind: z.literal("relational"), subject: z.string(), object: z.string(), surface_hint: z.string() });
const AtomSchema = z.object({ id: z.string(), kind: z.literal("atomic"), entity: z.string(), surface_hint: z.string() });
const FactsSchema = z.object({ facts: z.array(z.union([RelSchema, AtomSchema, z.object({ id: z.string(), kind: z.string() }).passthrough()])) });

const main = (): void => {
  const fixtureDir = process.argv[2];
  if (!fixtureDir) {
    process.stderr.write("usage: bun scripts/author-t7-queries.ts <fixture_dir>\n");
    process.exit(64);
  }
  const facts = FactsSchema.parse(JSON.parse(readFileSync(join(fixtureDir, "facts.json"), "utf-8"))).facts;
  const byId = new Map(facts.map((f) => [f.id, f]));

  // Integrity: every chain must be a real A→B→C→D path ending at its atomic fact.
  for (const { fact_ids, text } of T7) {
    const [r1, r2, r3, at] = fact_ids.map((id) => byId.get(id));
    const rels = [r1, r2, r3];
    if (rels.some((r) => !r || r.kind !== "relational") || !at || at.kind !== "atomic") {
      throw new Error(`bad fact kinds in chain ${fact_ids.join(",")}`);
    }
    const [R1, R2, R3] = rels as Array<z.infer<typeof RelSchema>>;
    const A = at as z.infer<typeof AtomSchema>;
    if (R1!.object !== R2!.subject || R2!.object !== R3!.subject || R3!.object !== A.entity) {
      throw new Error(`chain ${fact_ids.join(",")} is not a linear path`);
    }
    if (!text.toLowerCase().includes(R1!.subject.toLowerCase())) {
      throw new Error(`question does not name its start entity: ${text}`);
    }
  }

  const queriesPath = join(fixtureDir, "queries.json");
  const file = JSON.parse(readFileSync(queriesPath, "utf-8")) as { queries: Array<{ id: string; tier: string }> };
  if (file.queries.some((q) => q.tier === "T7")) {
    throw new Error("fixture already has T7 rows — restore queries.json before re-running");
  }
  let maxN = 0;
  for (const row of file.queries) maxN = Math.max(maxN, parseInt(row.id.slice(2), 10));

  const rows = T7.map((c, i) => {
    const hints = c.fact_ids.map((id) => (byId.get(id) as { surface_hint: string }).surface_hint);
    return {
      id: `q-${String(maxN + 1 + i).padStart(4, "0")}`,
      tier: "T7",
      text: c.text,
      expected_fact_ids: [...c.fact_ids],
      anti_leakage_score: jaccardOverlap(c.text, hints),
      generation_attempts: 1,
    };
  });

  file.queries = [...file.queries, ...rows];
  writeFileSync(queriesPath, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
  for (const r of rows) process.stdout.write(`${r.id} leak=${r.anti_leakage_score.toFixed(3)}  ${r.text}\n`);
  process.stdout.write(`appended ${rows.length} T7 rows; total now ${file.queries.length}\n`);
};

main();
