// author: Claude
import type { Fact } from "@/types/facts";
import type { Rng } from "@/lib/rng";

/**
 * A domain template — the contract between Stage 1 and a pluggable fact
 * generator (§15).
 *
 * `generate(rng)` must be pure: same seeded Rng → same facts array. No LLM,
 * no network, no Date.now(). The Stage 1 validator then asserts: unique
 * ids, relational subjects/objects as atomic entities, byte-distinct
 * surface hints, value/object substring inclusion.
 *
 * `domain_name` is a static field (fixed per template) so callers can derive
 * `fixture_id` without invoking `generate()` — important because
 * `fixture_id` is needed to decide the output directory before facts are
 * produced.
 */
export type DomainTemplate = {
  name: string;
  domain_name: string;
  /**
   * `opts.entityCount` scales the corpus (default 10 = the legacy hardcoded
   * set). At the default the output is byte-identical to the historical
   * fixtures; larger counts append deterministically-generated entities.
   */
  generate: (rng: Rng, opts?: { entityCount?: number }) => { facts: Fact[] };
};
