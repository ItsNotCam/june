// author: Claude
/**
 * One-off "double the questions per tier" authoring + splice — NOT part of the
 * run pipeline.
 *
 * The deep-hop fixture's corpus/ingest is frozen and rich (10 entities, 40
 * relational edges, 80 atomic facts). Doubling the per-tier question count needs
 * no new facts — only new question *text*. That text is normally written by the
 * Anthropic Sonnet `query_author`, which was out of credits, so the new questions
 * were authored in-session (same model-generic phrasing rules as the pipeline)
 * and are carried here as the authoritative `(tier, fact_ids, text)` record.
 *
 * This script APPENDS to the fixture's `queries.json` and validates every row:
 *  - all `fact_ids` resolve to real facts;
 *  - T4/T6/T7 chains are real linear `A→…→D` paths ending at their atomic fact;
 *  - the question names ONLY its start entity — no bridge or answer entity leaks
 *    (T5 questions name NO real entity at all — they must stay unanswerable);
 *  - no fact-id set duplicates an existing query of the same tier or another new
 *    row;
 *  - anti-leakage jaccard is computed over the gold surface hints (null for the
 *    directly-named T1 and the unanswerable T5, matching the generator).
 *
 * Run once on a fixture whose tiers are still at their pre-double counts (restore
 * `queries.json` from VCS first if re-running). Evaluate with `--skip-ingest`
 * against the existing ingest — no re-ingest, no Anthropic. The questions are
 * Opus-authored (a mild authorship difference vs the Sonnet-authored originals);
 * the gemma control run certifies the result. A full Sonnet regenerate supersedes
 * this once credits return.
 *
 * Usage:
 *   bun scripts/author-double-queries.ts <fixture_dir>
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { jaccardOverlap } from "@/lib/tokens";

type NewQuery = { tier: string; fact_ids: string[]; text: string };

/**
 * Authoritative set of new questions, one block per tier. Order within a tier is
 * irrelevant — rows are matched to facts by id. Counts double each tier:
 * T1 +5, T2 +5, T3 +5, T4 +15, T5 +5, T6 +30, T7 +15 (= +80 total).
 */
const NEW: ReadonlyArray<NewQuery> = [
  // ---- T1 (+5): direct single-fact lookup, entity named ----
  { tier: "T1", fact_ids: ["f-atomic-0068"], text: "What is the session timeout in seconds for Borghyl Control?" },
  { tier: "T1", fact_ids: ["f-rel-0033"], text: "What does Borghyl Control extend?" },
  { tier: "T1", fact_ids: ["f-atomic-0035"], text: "What is the heartbeat interval in milliseconds for Dargwave Transport?" },
  { tier: "T1", fact_ids: ["f-rel-0006"], text: "What does Froznet v2 depend on?" },
  { tier: "T1", fact_ids: ["f-atomic-0004"], text: "What is the session timeout in seconds for Glorbulon Protocol?" },

  // ---- T2 (+5): single fact, entity referred to by a paraphrase/nickname ----
  { tier: "T2", fact_ids: ["f-atomic-0007"], text: "What algorithm does the Glorbulon protocol stack use to compress its payloads?" },
  { tier: "T2", fact_ids: ["f-atomic-0030"], text: "Which serialization format does the Viznet interchange service encode its messages in?" },
  { tier: "T2", fact_ids: ["f-atomic-0067"], text: "How frequently does the Borghyl controller emit heartbeat signals?" },
  { tier: "T2", fact_ids: ["f-atomic-0045"], text: "What is the maximum packet size handled by the Querban layer module?" },
  { tier: "T2", fact_ids: ["f-rel-0005"], text: "Which framework does the Froznet v2 platform build upon as an extension?" },

  // ---- T3 (+5): conversational scenario, single atomic fact ----
  { tier: "T3", fact_ids: ["f-atomic-0040"], text: "We're debugging slow connection setups on a link that runs Dargwave Transport, and ops suspects the initial handshake is the holdup — roughly how many seconds should a Dargwave Transport handshake take to complete?" },
  { tier: "T3", fact_ids: ["f-atomic-0011"], text: "Our monitoring keeps flagging Froznet v2 links as idle between keepalives — how many milliseconds apart are Froznet v2's heartbeats supposed to be so I can set the alert threshold correctly?" },
  { tier: "T3", fact_ids: ["f-atomic-0062"], text: "I'm writing a parser for traffic captured off a Plirnode Framework endpoint and need to know how the payloads are serialized — which encoding format does Plirnode Framework put on the wire?" },
  { tier: "T3", fact_ids: ["f-atomic-0017"], text: "Setting up firewall rules for a host that speaks Snorblath Protocol — which port do I need to open for its control-channel messages?" },
  { tier: "T3", fact_ids: ["f-atomic-0044"], text: "A long-lived Querban Layer session in our cluster keeps dropping and I think it's hitting the idle limit — after how many seconds of inactivity does a Querban Layer session time out?" },

  // ---- T4 (+15): 2-hop (1 relational + 1 atomic), bridge hidden ----
  { tier: "T4", fact_ids: ["f-rel-0015", "f-atomic-0049"], text: "Which port is used for control messages by the session extended by Viznet Exchange?" },
  { tier: "T4", fact_ids: ["f-rel-0014", "f-atomic-0077"], text: "What is the maximum packet size of the signal depended on by Viznet Exchange?" },
  { tier: "T4", fact_ids: ["f-rel-0022", "f-atomic-0036"], text: "What is the session timeout of the transport that interoperates with Querban Layer?" },
  { tier: "T4", fact_ids: ["f-rel-0017", "f-atomic-0072"], text: "How long does the handshake take for the system tunneled through by Dargwave Transport?" },
  { tier: "T4", fact_ids: ["f-rel-0039", "f-atomic-0027"], text: "How often does the exchange tunneled through by Kreznak Signal send heartbeats?" },
  { tier: "T4", fact_ids: ["f-rel-0018", "f-atomic-0001"], text: "Which port is used for control messages by the protocol superseded by Dargwave Transport?" },
  { tier: "T4", fact_ids: ["f-rel-0008", "f-atomic-0001"], text: "Which port is used for control messages by the protocol that Froznet v2 authenticates via?" },
  { tier: "T4", fact_ids: ["f-rel-0026", "f-atomic-0033"], text: "Which port is used for control messages by the transport tunneled through by Wexmar Session?" },
  { tier: "T4", fact_ids: ["f-rel-0038", "f-atomic-0050"], text: "Which port is used for data transfer by the session that interoperates with Kreznak Signal?" },
  { tier: "T4", fact_ids: ["f-rel-0037", "f-atomic-0022"], text: "What serialization encoding is used by the protocol that Kreznak Signal authenticates via?" },
  { tier: "T4", fact_ids: ["f-rel-0031", "f-atomic-0024"], text: "How long does the handshake take for the protocol superseded by Plirnode Framework?" },
  { tier: "T4", fact_ids: ["f-rel-0023", "f-atomic-0011"], text: "How often does the system superseded by Querban Layer send heartbeats?" },
  { tier: "T4", fact_ids: ["f-rel-0020", "f-atomic-0014"], text: "What serialization encoding is used by the system that Dargwave Transport authenticates via?" },
  { tier: "T4", fact_ids: ["f-rel-0019", "f-atomic-0027"], text: "How often does the exchange that interoperates with Dargwave Transport send heartbeats?" },
  { tier: "T4", fact_ids: ["f-rel-0017", "f-atomic-0069"], text: "What is the maximum packet size of the system tunneled through by Dargwave Transport?" },

  // ---- T5 (+5): unanswerable — fictional entity NOT in the corpus ----
  { tier: "T5", fact_ids: [], text: "What is the heartbeat interval in milliseconds for the Zylthorne Protocol?" },
  { tier: "T5", fact_ids: [], text: "Which port does the Mavrunk Gateway use for control-channel traffic?" },
  { tier: "T5", fact_ids: [], text: "What compression algorithm does the Brindlewise Session apply to its payloads?" },
  { tier: "T5", fact_ids: [], text: "How long does the handshake take for the Quobblefen Transport?" },
  { tier: "T5", fact_ids: [], text: "What serialization encoding does the Plexnard Layer use on the wire?" },

  // ---- T6 (+30): 3-hop (2 relational + 1 atomic), two bridges hidden ----
  { tier: "T6", fact_ids: ["f-rel-0036", "f-rel-0031", "f-atomic-0019"], text: "How often does the protocol superseded by the framework tunneled through by Borghyl Control send heartbeats?" },
  { tier: "T6", fact_ids: ["f-rel-0027", "f-rel-0037", "f-atomic-0019"], text: "How often does the protocol that the signal wrapped by Wexmar Session authenticates via send heartbeats?" },
  { tier: "T6", fact_ids: ["f-rel-0009", "f-rel-0033", "f-atomic-0033"], text: "Which port is used for control messages by the transport extended by the system superseded by Snorblath Protocol?" },
  { tier: "T6", fact_ids: ["f-rel-0011", "f-rel-0023", "f-atomic-0013"], text: "What is the maximum packet size of the system superseded by the layer wrapped by Snorblath Protocol?" },
  { tier: "T6", fact_ids: ["f-rel-0036", "f-rel-0032", "f-atomic-0048"], text: "How long does the handshake take for the layer extended by the framework tunneled through by Borghyl Control?" },
  { tier: "T6", fact_ids: ["f-rel-0034", "f-rel-0004", "f-atomic-0025"], text: "Which port is used for control messages by the exchange superseded by the protocol depended on by Borghyl Control?" },
  { tier: "T6", fact_ids: ["f-rel-0035", "f-rel-0014", "f-atomic-0079"], text: "What compression algorithm is used by the signal depended on by the exchange superseded by Borghyl Control?" },
  { tier: "T6", fact_ids: ["f-rel-0006", "f-rel-0025", "f-atomic-0061"], text: "What is the maximum packet size of the framework superseded by the session depended on by Froznet v2?" },
  { tier: "T6", fact_ids: ["f-rel-0018", "f-rel-0004", "f-atomic-0030"], text: "What serialization encoding is used by the exchange superseded by the protocol superseded by Dargwave Transport?" },
  { tier: "T6", fact_ids: ["f-rel-0003", "f-rel-0030", "f-atomic-0009"], text: "Which port is used for control messages by the system depended on by the framework depended on by Glorbulon Protocol?" },
  { tier: "T6", fact_ids: ["f-rel-0016", "f-rel-0018", "f-atomic-0005"], text: "What is the maximum packet size of the protocol superseded by the transport that Viznet Exchange authenticates via?" },
  { tier: "T6", fact_ids: ["f-rel-0018", "f-rel-0004", "f-atomic-0031"], text: "What compression algorithm is used by the exchange superseded by the protocol superseded by Dargwave Transport?" },
  { tier: "T6", fact_ids: ["f-rel-0026", "f-rel-0019", "f-atomic-0030"], text: "What serialization encoding is used by the exchange that interoperates with the transport tunneled through by Wexmar Session?" },
  { tier: "T6", fact_ids: ["f-rel-0027", "f-rel-0037", "f-atomic-0018"], text: "Which port is used for data transfer by the protocol that the signal wrapped by Wexmar Session authenticates via?" },
  { tier: "T6", fact_ids: ["f-rel-0030", "f-rel-0008", "f-atomic-0005"], text: "What is the maximum packet size of the protocol that the system depended on by Plirnode Framework authenticates via?" },
  { tier: "T6", fact_ids: ["f-rel-0008", "f-rel-0004", "f-atomic-0028"], text: "What is the session timeout of the exchange superseded by the protocol that Froznet v2 authenticates via?" },
  { tier: "T6", fact_ids: ["f-rel-0018", "f-rel-0001", "f-atomic-0042"], text: "Which port is used for data transfer by the layer that the protocol superseded by Dargwave Transport authenticates via?" },
  { tier: "T6", fact_ids: ["f-rel-0032", "f-rel-0023", "f-atomic-0012"], text: "What is the session timeout of the system superseded by the layer extended by Plirnode Framework?" },
  { tier: "T6", fact_ids: ["f-rel-0037", "f-rel-0010", "f-atomic-0003"], text: "How often does the protocol depended on by the protocol that Kreznak Signal authenticates via send heartbeats?" },
  { tier: "T6", fact_ids: ["f-rel-0010", "f-rel-0003", "f-atomic-0064"], text: "How long does the handshake take for the framework depended on by the protocol depended on by Snorblath Protocol?" },
  { tier: "T6", fact_ids: ["f-rel-0001", "f-rel-0023", "f-atomic-0015"], text: "What compression algorithm is used by the system superseded by the layer that Glorbulon Protocol authenticates via?" },
  { tier: "T6", fact_ids: ["f-rel-0004", "f-rel-0015", "f-atomic-0051"], text: "How often does the session extended by the exchange superseded by Glorbulon Protocol send heartbeats?" },
  { tier: "T6", fact_ids: ["f-rel-0028", "f-rel-0033", "f-atomic-0037"], text: "What is the maximum packet size of the transport extended by the system that Wexmar Session authenticates via?" },
  { tier: "T6", fact_ids: ["f-rel-0023", "f-rel-0007", "f-atomic-0069"], text: "What is the maximum packet size of the system superseded by the system superseded by Querban Layer?" },
  { tier: "T6", fact_ids: ["f-rel-0012", "f-rel-0040", "f-atomic-0066"], text: "Which port is used for data transfer by the system superseded by the signal tunneled through by Snorblath Protocol?" },
  { tier: "T6", fact_ids: ["f-rel-0020", "f-rel-0007", "f-atomic-0069"], text: "What is the maximum packet size of the system superseded by the system that Dargwave Transport authenticates via?" },
  { tier: "T6", fact_ids: ["f-rel-0003", "f-rel-0030", "f-atomic-0013"], text: "What is the maximum packet size of the system depended on by the framework depended on by Glorbulon Protocol?" },
  { tier: "T6", fact_ids: ["f-rel-0039", "f-rel-0013", "f-atomic-0008"], text: "How long does the handshake take for the protocol that interoperates with the exchange tunneled through by Kreznak Signal?" },
  { tier: "T6", fact_ids: ["f-rel-0034", "f-rel-0003", "f-atomic-0058"], text: "Which port is used for data transfer by the framework depended on by the protocol depended on by Borghyl Control?" },
  { tier: "T6", fact_ids: ["f-rel-0007", "f-rel-0034", "f-atomic-0001"], text: "Which port is used for control messages by the protocol depended on by the system superseded by Froznet v2?" },

  // ---- T7 (+15): 4-hop (3 relational + 1 atomic), three bridges hidden ----
  { tier: "T7", fact_ids: ["f-rel-0002", "f-rel-0012", "f-rel-0038", "f-atomic-0050"], text: "Which port is used for data transfer by the session that interoperates with the signal tunneled through by the protocol wrapped by Glorbulon Protocol?" },
  { tier: "T7", fact_ids: ["f-rel-0008", "f-rel-0002", "f-rel-0009", "f-atomic-0072"], text: "How long does the handshake take for the system superseded by the protocol wrapped by the protocol that Froznet v2 authenticates via?" },
  { tier: "T7", fact_ids: ["f-rel-0021", "f-rel-0004", "f-rel-0016", "f-atomic-0036"], text: "What is the session timeout of the transport that the exchange superseded by the protocol wrapped by Querban Layer authenticates via?" },
  { tier: "T7", fact_ids: ["f-rel-0036", "f-rel-0032", "f-rel-0022", "f-atomic-0039"], text: "What compression algorithm is used by the transport that interoperates with the layer extended by the framework tunneled through by Borghyl Control?" },
  { tier: "T7", fact_ids: ["f-rel-0029", "f-rel-0039", "f-rel-0015", "f-atomic-0052"], text: "What is the session timeout of the session extended by the exchange tunneled through by the signal tunneled through by Plirnode Framework?" },
  { tier: "T7", fact_ids: ["f-rel-0036", "f-rel-0032", "f-rel-0023", "f-atomic-0016"], text: "How long does the handshake take for the system superseded by the layer extended by the framework tunneled through by Borghyl Control?" },
  { tier: "T7", fact_ids: ["f-rel-0016", "f-rel-0018", "f-rel-0002", "f-atomic-0020"], text: "What is the session timeout of the protocol wrapped by the protocol superseded by the transport that Viznet Exchange authenticates via?" },
  { tier: "T7", fact_ids: ["f-rel-0025", "f-rel-0030", "f-rel-0007", "f-atomic-0071"], text: "What compression algorithm is used by the system superseded by the system depended on by the framework superseded by Wexmar Session?" },
  { tier: "T7", fact_ids: ["f-rel-0008", "f-rel-0002", "f-rel-0011", "f-atomic-0041"], text: "Which port is used for control messages by the layer wrapped by the protocol wrapped by the protocol that Froznet v2 authenticates via?" },
  { tier: "T7", fact_ids: ["f-rel-0013", "f-rel-0001", "f-rel-0022", "f-atomic-0034"], text: "Which port is used for data transfer by the transport that interoperates with the layer that the protocol that interoperates with Viznet Exchange authenticates via?" },
  { tier: "T7", fact_ids: ["f-rel-0033", "f-rel-0018", "f-rel-0001", "f-atomic-0046"], text: "What serialization encoding is used by the layer that the protocol superseded by the transport extended by Borghyl Control authenticates via?" },
  { tier: "T7", fact_ids: ["f-rel-0029", "f-rel-0040", "f-rel-0033", "f-atomic-0034"], text: "Which port is used for data transfer by the transport extended by the system superseded by the signal tunneled through by Plirnode Framework?" },
  { tier: "T7", fact_ids: ["f-rel-0039", "f-rel-0015", "f-rel-0028", "f-atomic-0071"], text: "What compression algorithm is used by the system that the session extended by the exchange tunneled through by Kreznak Signal authenticates via?" },
  { tier: "T7", fact_ids: ["f-rel-0035", "f-rel-0016", "f-rel-0018", "f-atomic-0001"], text: "Which port is used for control messages by the protocol superseded by the transport that the exchange superseded by Borghyl Control authenticates via?" },
  { tier: "T7", fact_ids: ["f-rel-0027", "f-rel-0039", "f-rel-0016", "f-atomic-0033"], text: "Which port is used for control messages by the transport that the exchange tunneled through by the signal wrapped by Wexmar Session authenticates via?" },
];

const RelSchema = z.object({ id: z.string(), kind: z.literal("relational"), subject: z.string(), object: z.string(), surface_hint: z.string() });
const AtomSchema = z.object({ id: z.string(), kind: z.literal("atomic"), entity: z.string(), surface_hint: z.string() });
const FactsSchema = z.object({ facts: z.array(z.union([RelSchema, AtomSchema, z.object({ id: z.string(), kind: z.string() }).passthrough()])) });

type Rel = z.infer<typeof RelSchema>;
type Atom = z.infer<typeof AtomSchema>;

/** Per-tier expected gold-chunk count (relationals + atomic). T5 has none. */
const HOPS: Record<string, number> = { T1: 1, T2: 1, T3: 1, T4: 2, T5: 0, T6: 3, T7: 4 };
/** Tiers whose anti-leakage jaccard is recorded (others stay null, per the generator). */
const SCORED = new Set(["T2", "T3", "T4", "T6", "T7"]);

const main = (): void => {
  const fixtureDir = process.argv[2];
  if (!fixtureDir) {
    process.stderr.write("usage: bun scripts/author-double-queries.ts <fixture_dir>\n");
    process.exit(64);
  }
  const facts = FactsSchema.parse(JSON.parse(readFileSync(join(fixtureDir, "facts.json"), "utf-8"))).facts;
  const byId = new Map(facts.map((f) => [f.id, f]));
  // Distinctive proper-name token per entity (first word), to detect leaked entities.
  const entities = new Set<string>();
  for (const f of facts) {
    if (f.kind === "relational") { entities.add((f as Rel).subject); entities.add((f as Rel).object); }
    else if (f.kind === "atomic") { entities.add((f as Atom).entity); }
  }
  const tokenToEntity = new Map<string, string>();
  for (const e of entities) tokenToEntity.set(e.split(" ")[0]!.toLowerCase(), e);

  const namedEntities = (text: string): Set<string> => {
    const lower = text.toLowerCase();
    const hit = new Set<string>();
    for (const [tok, ent] of tokenToEntity) if (lower.includes(tok)) hit.add(ent);
    return hit;
  };

  // Validate every row; collect gold surface hints for anti-leakage.
  const seenInBatch = new Set<string>();
  for (const q of NEW) {
    const want = HOPS[q.tier];
    if (want === undefined) throw new Error(`unknown tier ${q.tier}`);
    if (q.fact_ids.length !== want) throw new Error(`${q.tier} expects ${want} fact_ids, got ${q.fact_ids.length}: ${q.text}`);

    if (q.tier === "T5") {
      const leaked = namedEntities(q.text);
      if (leaked.size > 0) throw new Error(`T5 must be unanswerable but names real entity ${[...leaked]}: ${q.text}`);
      continue;
    }

    const objs = q.fact_ids.map((id) => byId.get(id));
    if (objs.some((o) => !o)) throw new Error(`unknown fact id in ${q.fact_ids.join(",")}`);

    if (want >= 2) {
      // Multi-hop: relationals then one atomic, forming a linear A→…→D path.
      const rels = objs.slice(0, -1) as Rel[];
      const atom = objs[objs.length - 1] as Atom;
      if (rels.some((r) => r.kind !== "relational") || atom.kind !== "atomic") {
        throw new Error(`bad fact kinds in chain ${q.fact_ids.join(",")}`);
      }
      for (let i = 0; i < rels.length - 1; i++) {
        if (rels[i]!.object !== rels[i + 1]!.subject) throw new Error(`chain ${q.fact_ids.join(",")} breaks at hop ${i}`);
      }
      if (rels[rels.length - 1]!.object !== atom.entity) throw new Error(`chain ${q.fact_ids.join(",")} atomic does not match terminal entity`);
      const start = rels[0]!.subject;
      const named = namedEntities(q.text);
      named.delete(start);
      if (named.size > 0) throw new Error(`${q.tier} leaks non-start entity ${[...named]}: ${q.text}`);
      if (!q.text.toLowerCase().includes(start.split(" ")[0]!.toLowerCase())) throw new Error(`${q.tier} does not name start entity ${start}: ${q.text}`);
    } else {
      // Single-fact (T1/T2/T3): names exactly the fact's own entity, nothing else.
      const o = objs[0]!;
      const own = o.kind === "relational" ? (o as Rel).subject : (o as Atom).entity;
      const named = namedEntities(q.text);
      named.delete(own);
      if (named.size > 0) throw new Error(`${q.tier} names a foreign entity ${[...named]}: ${q.text}`);
      if (!q.text.toLowerCase().includes(own.split(" ")[0]!.toLowerCase())) throw new Error(`${q.tier} does not name its entity ${own}: ${q.text}`);
    }

    const key = `${q.tier}|${[...q.fact_ids].sort().join(",")}`;
    if (q.fact_ids.length > 0 && seenInBatch.has(key)) throw new Error(`duplicate fact set within batch: ${key}`);
    seenInBatch.add(key);
  }

  // Append, deduping against existing rows of the same tier.
  const queriesPath = join(fixtureDir, "queries.json");
  const file = JSON.parse(readFileSync(queriesPath, "utf-8")) as { queries: Array<{ id: string; tier: string; expected_fact_ids?: string[] }> };
  const existing = new Set(file.queries.map((q) => `${q.tier}|${[...(q.expected_fact_ids ?? [])].sort().join(",")}`));
  for (const q of NEW) {
    if (q.fact_ids.length === 0) continue; // T5 rows have no fact set to dedup
    const key = `${q.tier}|${[...q.fact_ids].sort().join(",")}`;
    if (existing.has(key)) throw new Error(`fact set already in fixture: ${key} — ${q.text}`);
  }
  let maxN = 0;
  for (const row of file.queries) maxN = Math.max(maxN, parseInt(row.id.slice(2), 10));

  const rows = NEW.map((q, i) => {
    const hints = q.fact_ids.map((id) => (byId.get(id) as { surface_hint?: string }).surface_hint ?? "");
    return {
      id: `q-${String(maxN + 1 + i).padStart(4, "0")}`,
      tier: q.tier,
      text: q.text,
      expected_fact_ids: [...q.fact_ids],
      anti_leakage_score: SCORED.has(q.tier) ? jaccardOverlap(q.text, hints) : null,
      generation_attempts: 1,
    };
  });

  file.queries = [...file.queries, ...rows];
  writeFileSync(queriesPath, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
  const byTier: Record<string, number> = {};
  for (const r of rows) byTier[r.tier] = (byTier[r.tier] ?? 0) + 1;
  for (const r of rows) {
    const score = r.anti_leakage_score === null ? "n/a" : r.anti_leakage_score.toFixed(3);
    process.stdout.write(`${r.id} ${r.tier} leak=${score}  ${r.text}\n`);
  }
  process.stdout.write(`appended ${rows.length} rows ${JSON.stringify(byTier)}; total now ${file.queries.length}\n`);
};

main();
