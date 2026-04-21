// author: Claude
/**
 * Atomic fact: a single (entity, attribute, value) triple.
 *
 * The `surface_hint` is the canonical sentence the corpus author is asked to
 * plant verbatim in the generated document. It is also what the ground-truth
 * resolver (§19) substring-matches against `chunks.raw_content`.
 *
 * Produced deterministically from a seed (§15) — never by an LLM.
 */
export type AtomicFact = {
  kind: "atomic";
  id: string;
  entity: string;
  attribute: string;
  value: string;
  surface_hint: string;
};

/**
 * Relational fact: a (subject, predicate, object) triple that connects two
 * atomic entities.
 *
 * Required for T4 multi-hop queries — without relational facts, multi-hop
 * collapses into awkward pseudo-multi-hop over atomic facts (DD-1).
 *
 * Both `subject` and `object` must appear as the `entity` of some atomic fact;
 * the Stage 1 validator enforces this (connected-graph property, §15).
 */
export type RelationalFact = {
  kind: "relational";
  id: string;
  subject: string;
  predicate: string;
  object: string;
  surface_hint: string;
};

/** A planted fact — atomic or relational. The fixture stores a flat array of these. */
export type Fact = AtomicFact | RelationalFact;

/**
 * On-disk shape of `facts.json` — the fixture's document of record.
 *
 * `fixture_id` is a deterministic 26-character Crockford-base32 hash of seed
 * + domain_name (§15). Same seed + same domain produce the same id forever —
 * never a ULID, no timestamp component.
 */
export type FactsFile = {
  fixture_id: string;
  fixture_seed: number;
  schema_version: 1;
  domain_name: string;
  generated_at: string;
  facts: Fact[];
};
