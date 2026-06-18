// author: Claude
import { describe, expect, test } from "bun:test";
import type { AtomicFact, RelationalFact } from "@/types/facts";
import { buildDeepChains, deepChainFactIds, type DeepChain } from "@/stages/03-queries";
import { seededRng } from "@/lib/rng";

const rel = (id: string, subject: string, object: string): RelationalFact => ({
  kind: "relational",
  id,
  subject,
  predicate: "wraps",
  object,
  surface_hint: `${subject} wraps ${object}`,
});
const atom = (id: string, entity: string): AtomicFact => ({
  kind: "atomic",
  id,
  entity,
  attribute: "max_packet_size",
  value: "1024",
  surface_hint: `${entity} max packet size is 1024 bytes`,
});

/** A→B→C→D path plus a branch B→E, and one atomic per entity. */
const RELATIONAL = [
  rel("r-ab", "A", "B"),
  rel("r-bc", "B", "C"),
  rel("r-cd", "C", "D"),
  rel("r-be", "B", "E"),
];
const ATOMIC = [atom("a-A", "A"), atom("a-B", "B"), atom("a-C", "C"), atom("a-D", "D"), atom("a-E", "E")];

const isValidChain = (c: DeepChain, depth: number): boolean => {
  if (c.relationals.length !== depth - 1) return false;
  for (let i = 0; i + 1 < c.relationals.length; i++) {
    if (c.relationals[i]!.object !== c.relationals[i + 1]!.subject) return false;
  }
  const last = c.relationals[c.relationals.length - 1]!.object;
  if (c.atomic.entity !== last) return false;
  // entities along the path are distinct
  const ents = [c.relationals[0]!.subject, ...c.relationals.map((r) => r.object)];
  return new Set(ents).size === ents.length;
};

describe("buildDeepChains", () => {
  test("depth-3 chains link R1.object==R2.subject and atomic on the last entity", () => {
    const chains = buildDeepChains(ATOMIC, RELATIONAL, 3, 1000, seededRng(1));
    expect(chains.length).toBeGreaterThan(0);
    for (const c of chains) expect(isValidChain(c, 3)).toBe(true);
    // A→B→C(atomic a-C) must be among them
    const ids = chains.map((c) => deepChainFactIds(c).join(","));
    expect(ids).toContain("r-ab,r-bc,a-C");
    // A→B→E(atomic a-E) — the branch — must also appear
    expect(ids).toContain("r-ab,r-be,a-E");
  });

  test("depth-4 chains require three linked relationals", () => {
    const chains = buildDeepChains(ATOMIC, RELATIONAL, 4, 1000, seededRng(1));
    for (const c of chains) expect(isValidChain(c, 4)).toBe(true);
    const ids = chains.map((c) => deepChainFactIds(c).join(","));
    expect(ids).toContain("r-ab,r-bc,r-cd,a-D");
  });

  test("no cycles — an entity is never revisited within a chain", () => {
    // Add B→A so a naive walk could produce A→B→A.
    const withCycle = [...RELATIONAL, rel("r-ba", "B", "A")];
    const chains = buildDeepChains(ATOMIC, withCycle, 3, 1000, seededRng(1));
    for (const c of chains) {
      const ents = [c.relationals[0]!.subject, ...c.relationals.map((r) => r.object)];
      expect(new Set(ents).size).toBe(ents.length);
    }
  });

  test("count truncation is deterministic for a given seed", () => {
    const a = buildDeepChains(ATOMIC, RELATIONAL, 3, 2, seededRng(42));
    const b = buildDeepChains(ATOMIC, RELATIONAL, 3, 2, seededRng(42));
    expect(a.length).toBe(2);
    expect(a.map((c) => deepChainFactIds(c).join(","))).toEqual(
      b.map((c) => deepChainFactIds(c).join(",")),
    );
  });

  test("count 0 yields no chains", () => {
    expect(buildDeepChains(ATOMIC, RELATIONAL, 3, 0, seededRng(1))).toEqual([]);
  });

  test("under-supply: returns all available (fewer than requested) without crashing", () => {
    // The tiny graph yields a handful of depth-3 chains; ask for far more.
    const chains = buildDeepChains(ATOMIC, RELATIONAL, 3, 1000, seededRng(7));
    expect(chains.length).toBeGreaterThan(0);
    expect(chains.length).toBeLessThan(1000); // short, not padded — caller sees the real count
  });

  describe("entity-disjoint-first selection", () => {
    // Two A→B→{C,D} chains that share {A,B}, plus an independent X→Y→Z chain.
    const REL = [
      rel("r-ab", "A", "B"),
      rel("r-bc", "B", "C"),
      rel("r-bd", "B", "D"),
      rel("r-xy", "X", "Y"),
      rel("r-yz", "Y", "Z"),
    ];
    const AT = [atom("a-C", "C"), atom("a-D", "D"), atom("a-Z", "Z")];

    const entitySet = (c: DeepChain): Set<string> =>
      new Set([...c.relationals.flatMap((r) => [r.subject, r.object]), c.atomic.entity]);

    test("prefers independent chains: the picked subset shares no entity", () => {
      // 3 chains exist {ABC, ABD, XYZ}; ABC/ABD overlap. Disjoint-first must pull
      // in XYZ rather than returning both overlapping A-chains.
      const [c1, c2] = buildDeepChains(AT, REL, 3, 2, seededRng(3));
      expect(c1).toBeDefined();
      expect(c2).toBeDefined();
      const a = entitySet(c1!);
      const b = entitySet(c2!);
      expect([...a].some((e) => b.has(e))).toBe(false); // fully disjoint
    });
  });
});
