// author: Claude
import { describe, expect, test } from "bun:test";
import type { Query, QueryTier } from "@/types/query";
import type { ResultsFile } from "@/types/results";
import { parseTierLimit, perTierLimit } from "../../cli/run";
import { assertFullFixture } from "../../cli/control";
import { UsageError } from "@/lib/errors";

/**
 * `--tier-limit` fast-iteration sampling (absolute per-tier caps) + the
 * certification guard that keeps a subsampled run from being pinned/gated as a
 * golden. Sampling is deterministic (sorts each tier by id, takes the head),
 * so the same fixture + caps always yields the same subset.
 */

const q = (id: string, tier: QueryTier): Query => ({
  id,
  tier,
  text: "q",
  expected_fact_ids: [],
  anti_leakage_score: null,
  generation_attempts: 1,
});

// 4 of T1, 3 of T6, 2 of T7 — deliberately out of id order to prove sorting.
const QUERIES: Query[] = [
  q("q-0004", "T1"), q("q-0001", "T1"), q("q-0003", "T1"), q("q-0002", "T1"),
  q("q-0011", "T6"), q("q-0010", "T6"), q("q-0012", "T6"),
  q("q-0021", "T7"), q("q-0020", "T7"),
];

describe("parseTierLimit", () => {
  test("bare integer → uniform cap on every tier", () => {
    const m = parseTierLimit("10");
    expect(m.get("T1")).toBe(10);
    expect(m.get("T7")).toBe(10);
    expect(m.size).toBe(7);
  });

  test("per-tier CSV caps only the listed tiers", () => {
    const m = parseTierLimit("T6:5,T7:3");
    expect(m.get("T6")).toBe(5);
    expect(m.get("T7")).toBe(3);
    expect(m.has("T1")).toBe(false);
    expect(m.size).toBe(2);
  });

  test.each(["0", "T6:0", "T9:5", "abc", "T6:", "T6:-2", "T6:2,bogus"])(
    "rejects invalid spec %p",
    (bad) => {
      expect(() => parseTierLimit(bad)).toThrow(UsageError);
    },
  );
});

describe("perTierLimit", () => {
  test("caps each listed tier at its count, taking the lexicographically-smallest ids", () => {
    const out = perTierLimit(QUERIES, new Map<QueryTier, number>([["T1", 2], ["T6", 1]]));
    const t1 = out.filter((x) => x.tier === "T1").map((x) => x.id);
    const t6 = out.filter((x) => x.tier === "T6").map((x) => x.id);
    const t7 = out.filter((x) => x.tier === "T7").map((x) => x.id);
    expect(t1).toEqual(["q-0001", "q-0002"]); // head of sorted, deterministic
    expect(t6).toEqual(["q-0010"]);
    expect(t7).toEqual(["q-0020", "q-0021"]); // T7 unlisted → runs in full
  });

  test("is deterministic (same input → same subset)", () => {
    const limits = new Map<QueryTier, number>([["T1", 3]]);
    expect(perTierLimit(QUERIES, limits)).toEqual(perTierLimit(QUERIES, limits));
  });

  test("a cap ≥ tier size keeps the whole tier", () => {
    const out = perTierLimit(QUERIES, new Map<QueryTier, number>([["T7", 99]]));
    expect(out.filter((x) => x.tier === "T7")).toHaveLength(2);
  });

  test("output stays in canonical tier order", () => {
    const out = perTierLimit(QUERIES, new Map<QueryTier, number>([["T1", 1], ["T6", 1], ["T7", 1]]));
    expect(out.map((x) => x.tier)).toEqual(["T1", "T6", "T7"]);
  });
});

describe("assertFullFixture — certification guard", () => {
  const withSampling = (sampling: ResultsFile["manifest"]["sampling"]): ResultsFile =>
    ({ manifest: { sampling } } as unknown as ResultsFile);

  test("rejects a tier-limit (subsampled) run", () => {
    const r = withSampling({ mode: "tier-limit", detail: "T6:5,T7:5" });
    expect(() => assertFullFixture(r, "control-pin")).toThrow(/FULL-fixture/);
  });

  test("rejects a ratio (--sample) run", () => {
    expect(() => assertFullFixture(withSampling({ mode: "ratio", detail: "0.1" }), "control-check")).toThrow(
      UsageError,
    );
  });

  test("accepts an explicit full run", () => {
    expect(() => assertFullFixture(withSampling({ mode: "full" }), "control-pin")).not.toThrow();
  });

  test("accepts an old run with no sampling field (undefined ⇒ full)", () => {
    expect(() => assertFullFixture(withSampling(undefined), "control-pin")).not.toThrow();
  });
});
