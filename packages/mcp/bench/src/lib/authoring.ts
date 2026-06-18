// author: Claude
import type { Fact, AtomicFact, RelationalFact, FactsFile } from "@/types/facts";
import type { CorpusDocument, CorpusManifest } from "@/types/corpus";
import type { Query, QueriesFile, QueryTier } from "@/types/query";
import { groupFactsIntoDocuments } from "@/stages/02-corpus";
import { buildFactChains, buildDeepChains, deepChainFactIds } from "@/stages/03-queries";
import { seededRng, seedFromString, shuffle, type Rng } from "@/lib/rng";
import { normalizeForResolution } from "@/lib/normalize";
import { jaccardOverlap } from "@/lib/tokens";
import { sha256Hex } from "@/lib/artifacts";
import { CorpusValidationError } from "@/lib/errors";

/**
 * No-API fixture authoring (§ RSI Phase 3 — the user's directive: "no APIs;
 * Claude Code pre-generates the corpus and queries; sonnet corpus, opus
 * queries").
 *
 * This module is the deterministic skeleton + the validating assembler around
 * agent-authored creative content — the same externalized-seam shape as the
 * Phase-0 judge:
 *   1. `buildAuthoringPlan(facts)` — purely deterministic (reuses Stage 1's
 *      seeded facts, Stage 2's doc grouping, Stage 3's chain builder). It says
 *      WHAT to write (which facts each document must plant; which fact(s) each
 *      query targets) but writes no prose.
 *   2. Claude Code agents author the prose — sonnet writes each document, opus
 *      writes each query (distinct models ⇒ anti-collusion, audit gap #7).
 *   3. `assembleCorpus` / `assembleQueries` — validate that the agent output is
 *      USABLE as a fixture (every surface hint is embedded verbatim so Stage 5
 *      can resolve it; every gated query stays under the anti-leakage threshold)
 *      and emit `corpus_manifest.json` / `queries.json`. Validation failures are
 *      thrown so the orchestrator re-authors the offending item.
 *
 * No provider/SDK is imported here — the only "LLM" is the orchestrator's
 * agents, out of process. The whole path is API-free.
 */

/** One document the corpus author must write — it must plant every listed fact's hint verbatim. */
export type DocPlan = {
  doc_index: number;
  slug: string;
  /** The entity the document is about (its narrative subject). */
  entity_label: string;
  facts: Fact[];
};

/** One query the query author must write — a natural-language question targeting `target_fact_ids`. */
export type QuerySpec = {
  spec_id: string;
  tier: QueryTier;
  /** Facts whose chunks must appear in top-K (empty for T5 negatives). */
  target_fact_ids: string[];
  /** Facts (with hints) the author needs as context; empty-hint for T5's off-topic anchor. */
  facts: Fact[];
  /** When true, the question must NOT lexically echo the hint (Jaccard ≤ threshold). */
  anti_leakage: boolean;
};

export type AuthoringPlan = {
  fixture_id: string;
  domain: string;
  seed: number;
  documents: DocPlan[];
  query_specs: QuerySpec[];
};

/** Per-tier query counts for the plan. Small by default — agent authoring is hand-paced. */
export type QueryCounts = { T1: number; T2: number; T3: number; T4: number; T5: number; T6: number; T7: number };
export const DEFAULT_QUERY_COUNTS: QueryCounts = { T1: 6, T2: 6, T3: 6, T4: 6, T5: 6, T6: 0, T7: 0 };

const slugify = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Stage 3's per-fact sampler (inlined — same seeded shuffle + modulo wrap). */
const samplePerFact = (rng: Rng, facts: readonly Fact[], count: number): Fact[] => {
  if (count <= 0 || facts.length === 0) return [];
  const shuffled = shuffle(rng, facts);
  const out: Fact[] = [];
  for (let i = 0; i < count; i++) out.push(shuffled[i % shuffled.length]!);
  return out;
};

const entityOf = (f: Fact): string => (f.kind === "atomic" ? f.entity : f.subject);

/**
 * Builds the deterministic authoring plan from a fixture's facts. Same facts +
 * same counts → byte-identical plan (one rng seeded from the fixture id, drawn
 * in a fixed tier order), so re-authoring always targets the same facts.
 */
export const buildAuthoringPlan = (
  facts: FactsFile,
  opts: { maxFactsPerDoc: number; counts?: QueryCounts },
): AuthoringPlan => {
  const counts = opts.counts ?? DEFAULT_QUERY_COUNTS;
  const groups = groupFactsIntoDocuments(facts.facts, opts.maxFactsPerDoc);
  const slugSeen = new Map<string, number>();
  const documents: DocPlan[] = groups.map((group, doc_index) => {
    const entity_label = entityOf(group[0]!);
    const base = slugify(entity_label);
    const n = slugSeen.get(base) ?? 0;
    slugSeen.set(base, n + 1);
    return { doc_index, slug: base + (n > 0 ? `-${n}` : ""), entity_label, facts: group };
  });

  const atomic = facts.facts.filter((f): f is AtomicFact => f.kind === "atomic");
  const relational = facts.facts.filter((f): f is RelationalFact => f.kind === "relational");
  const rng = seededRng(seedFromString(`authoring:${facts.fixture_id}`));
  const factById = new Map(facts.facts.map((f) => [f.id, f]));
  const query_specs: QuerySpec[] = [];

  const pushSingle = (tier: QueryTier, pool: readonly Fact[], count: number, anti_leakage: boolean) => {
    samplePerFact(rng, pool, count).forEach((f, i) => {
      query_specs.push({
        spec_id: `${tier}-${i + 1}`,
        tier,
        target_fact_ids: [f.id],
        facts: [f],
        anti_leakage,
      });
    });
  };

  pushSingle("T1", facts.facts, counts.T1, false); // lexical — overlap is the point
  pushSingle("T2", facts.facts, counts.T2, true); // paraphrase
  pushSingle("T3", atomic, counts.T3, true); // conceptual
  // T4 — two-hop chains: target BOTH the relational and the atomic fact.
  buildFactChains(atomic, relational, counts.T4, rng).forEach((chain, i) => {
    query_specs.push({
      spec_id: `T4-${i + 1}`,
      tier: "T4",
      target_fact_ids: [chain.relational.id, chain.atomic.id],
      facts: [chain.relational, chain.atomic],
      anti_leakage: true,
    });
  });
  // T5 — negatives: a plausible question about the anchor entity whose answer is
  // NOT in the corpus. No target facts; the anchor is context only.
  samplePerFact(rng, facts.facts, counts.T5).forEach((f, i) => {
    query_specs.push({
      spec_id: `T5-${i + 1}`,
      tier: "T5",
      target_fact_ids: [],
      facts: [f],
      anti_leakage: false,
    });
  });
  // T6 — three-hop chains: 2 relationals + 1 atomic; target every fact in the chain.
  buildDeepChains(atomic, relational, 3, counts.T6, rng).forEach((chain, i) => {
    query_specs.push({
      spec_id: `T6-${i + 1}`,
      tier: "T6",
      target_fact_ids: deepChainFactIds(chain),
      facts: [...chain.relationals, chain.atomic],
      anti_leakage: true,
    });
  });
  // T7 — four-hop chains: 3 relationals + 1 atomic; target every fact in the chain.
  buildDeepChains(atomic, relational, 4, counts.T7, rng).forEach((chain, i) => {
    query_specs.push({
      spec_id: `T7-${i + 1}`,
      tier: "T7",
      target_fact_ids: deepChainFactIds(chain),
      facts: [...chain.relationals, chain.atomic],
      anti_leakage: true,
    });
  });

  void factById;
  return { fixture_id: facts.fixture_id, domain: facts.domain_name, seed: facts.fixture_seed, documents, query_specs };
};

/**
 * Validates + assembles agent-authored documents into a `CorpusManifest`.
 * `docMarkdown` maps each plan slug → the markdown the corpus agent wrote. Every
 * planned fact's `surface_hint` must NORMALIZE-INCLUDE into its document (the
 * exact condition Stage 5 tier-1 resolution needs) or the doc is rejected.
 */
export const assembleCorpus = (args: {
  plan: AuthoringPlan;
  docMarkdown: ReadonlyMap<string, string>;
  corpusDir: string;
  author: { provider: string; model: string };
}): { manifest: CorpusManifest; files: Array<{ filename: string; markdown: string }> } => {
  const documents: CorpusDocument[] = [];
  const files: Array<{ filename: string; markdown: string }> = [];
  for (const doc of args.plan.documents) {
    const markdown = args.docMarkdown.get(doc.slug);
    if (markdown === undefined) {
      throw new CorpusValidationError(
        `assembleCorpus: no authored markdown for document "${doc.slug}"`,
        doc.slug,
        doc.facts.map((f) => f.id),
      );
    }
    const docNorm = normalizeForResolution(markdown);
    const missing = doc.facts
      .filter((f) => !docNorm.includes(normalizeForResolution(f.surface_hint)))
      .map((f) => f.id);
    if (missing.length > 0) {
      throw new CorpusValidationError(
        `assembleCorpus: document "${doc.slug}" is missing ${missing.length} surface hint(s) verbatim — re-author it (the hints must appear so Stage 5 can resolve them): ${missing.join(", ")}`,
        doc.slug,
        missing,
      );
    }
    const filename = `${doc.slug}.md`;
    documents.push({
      filename,
      absolute_path: `${args.corpusDir}/${filename}`,
      document_title: `${doc.entity_label}: reference`,
      planted_fact_ids: doc.facts.map((f) => f.id),
      validator_attempts: 1,
      validator_status: "pass",
      content_hash: sha256Hex(markdown),
    });
    files.push({ filename, markdown });
  }
  const manifest: CorpusManifest = {
    fixture_id: args.plan.fixture_id,
    schema_version: 1,
    documents,
    corpus_author: args.author,
  };
  return { manifest, files };
};

/**
 * Validates + assembles agent-authored query texts into a `QueriesFile`.
 * `queryText` maps each spec_id → the question the query agent wrote. A gated
 * spec whose Jaccard overlap with its target hints EXCEEDS `threshold` is
 * rejected (it lexically echoes the corpus — the anti-leakage guard).
 */
export const assembleQueries = (args: {
  plan: AuthoringPlan;
  queryText: ReadonlyMap<string, string>;
  threshold: number;
  author: { provider: string; model: string };
}): QueriesFile => {
  const queries: Query[] = [];
  let n = 0;
  for (const spec of args.plan.query_specs) {
    const text = args.queryText.get(spec.spec_id);
    if (text === undefined || text.trim().length === 0) {
      throw new CorpusValidationError(
        `assembleQueries: no authored text for query spec "${spec.spec_id}"`,
        spec.spec_id,
        spec.target_fact_ids,
      );
    }
    // T1 (lexical-by-design) and T5 (no target) carry no anti-leakage score.
    let anti_leakage_score: number | null = null;
    if (spec.anti_leakage) {
      const hints = spec.facts.map((f) => f.surface_hint);
      anti_leakage_score = jaccardOverlap(text, hints);
      if (anti_leakage_score > args.threshold) {
        throw new CorpusValidationError(
          `assembleQueries: query "${spec.spec_id}" leaks — Jaccard ${anti_leakage_score.toFixed(3)} > threshold ${args.threshold}. Re-author it to avoid echoing the hint's content words.`,
          spec.spec_id,
          spec.target_fact_ids,
        );
      }
    }
    queries.push({
      id: `q-${String(++n).padStart(4, "0")}`,
      tier: spec.tier,
      text: text.trim(),
      expected_fact_ids: spec.target_fact_ids,
      anti_leakage_score,
      generation_attempts: 1,
    });
  }
  return {
    fixture_id: args.plan.fixture_id,
    schema_version: 1,
    query_author: args.author,
    queries,
  };
};
