// author: Claude
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { glorbulonProtocol } from "@/domains/glorbulon-protocol";
import { validateFacts } from "@/stages/01-facts";
import { fixtureId } from "@/lib/ids";
import { seededRng } from "@/lib/rng";
import type { AtomicFact, RelationalFact } from "@/types/facts";

/**
 * Entity-count scaling for glorbulon-v3. The load-bearing invariant: at the
 * default 10 entities the output is BYTE-IDENTICAL to the frozen v1/v2 fixtures
 * (and shares their fixture_id), so existing goldens stay valid. Larger counts
 * scale the graph deterministically and still pass Stage-1 validation.
 */

const FROZEN_V2 = JSON.parse(
  readFileSync(join(import.meta.dir, "../../fixtures/glorbulon-v2/facts.json"), "utf8"),
) as { fixture_seed: number; fixture_id: string; facts: unknown[] };

const entitiesOf = (facts: (AtomicFact | RelationalFact)[]): Set<string> => {
  const s = new Set<string>();
  for (const f of facts) {
    if (f.kind === "atomic") s.add(f.entity);
    else {
      s.add(f.subject);
      s.add(f.object);
    }
  }
  return s;
};

describe("byte-identity at the default 10 entities", () => {
  test("generate() default === generate({entityCount:10})", () => {
    const a = glorbulonProtocol.generate(seededRng(FROZEN_V2.fixture_seed));
    const b = glorbulonProtocol.generate(seededRng(FROZEN_V2.fixture_seed), { entityCount: 10 });
    expect(a).toEqual(b);
  });

  test("reproduces the frozen glorbulon-v2 facts byte-for-byte", () => {
    const gen = glorbulonProtocol.generate(seededRng(FROZEN_V2.fixture_seed), { entityCount: 10 });
    expect(gen.facts).toEqual(FROZEN_V2.facts as typeof gen.facts);
    expect(gen.facts).toHaveLength(120); // 10×8 atomic + 10×4 relational
  });

  test("fixtureId is unchanged at 10 (== legacy id) and discriminated at 100", () => {
    const legacy = fixtureId(FROZEN_V2.fixture_seed, "Glorbulon Protocol");
    expect(legacy).toBe(FROZEN_V2.fixture_id);
    expect(fixtureId(FROZEN_V2.fixture_seed, "Glorbulon Protocol", 10)).toBe(legacy);
    expect(fixtureId(FROZEN_V2.fixture_seed, "Glorbulon Protocol", 100)).not.toBe(legacy);
  });
});

describe("scaling to 100 entities", () => {
  const { facts } = glorbulonProtocol.generate(seededRng(31337), { entityCount: 100 });
  const atomic = facts.filter((f): f is AtomicFact => f.kind === "atomic");
  const relational = facts.filter((f): f is RelationalFact => f.kind === "relational");

  test("yields 100 entities / 800 atomic / 400 relational", () => {
    expect(entitiesOf(facts as (AtomicFact | RelationalFact)[]).size).toBe(100);
    expect(atomic).toHaveLength(800); // 100 × 8
    expect(relational).toHaveLength(400); // 100 × 4
  });

  test("all fact ids are unique and the Stage-1 validator passes", () => {
    const ids = new Set(facts.map((f) => f.id));
    expect(ids.size).toBe(facts.length);
    expect(() => validateFacts(facts)).not.toThrow();
  });

  test("the 10 hardcoded protocols are preserved as a prefix", () => {
    const names = entitiesOf(facts as (AtomicFact | RelationalFact)[]);
    expect(names.has("Glorbulon Protocol")).toBe(true);
    expect(names.has("Kreznak Signal")).toBe(true);
  });

  test("is deterministic in the seed", () => {
    const a = glorbulonProtocol.generate(seededRng(42), { entityCount: 100 });
    const b = glorbulonProtocol.generate(seededRng(42), { entityCount: 100 });
    expect(a.facts).toEqual(b.facts);
  });
});
