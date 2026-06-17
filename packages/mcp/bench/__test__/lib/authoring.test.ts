// author: Claude
import { describe, expect, test } from "bun:test";
import type { FactsFile } from "@/types/facts";
import {
  buildAuthoringPlan,
  assembleCorpus,
  assembleQueries,
  type AuthoringPlan,
} from "@/lib/authoring";
import { CorpusValidationError } from "@/lib/errors";

/**
 * No-API fixture authoring (Phase 3). The plan is deterministic; the assemblers
 * are the validity gate — a document missing a hint or a query that leaks is
 * rejected so the orchestrator re-authors it.
 */

const facts: FactsFile = {
  fixture_id: "FID",
  fixture_seed: 7,
  schema_version: 1,
  domain_name: "Test",
  generated_at: "2026-01-01T00:00:00Z",
  facts: [
    { kind: "atomic", id: "a1", entity: "Relay", attribute: "threshold", value: "9", surface_hint: "The Relay threshold is 9." },
    { kind: "atomic", id: "a2", entity: "Relay", attribute: "color", value: "blue", surface_hint: "The Relay color is blue." },
    { kind: "atomic", id: "a3", entity: "Gate", attribute: "width", value: "4m", surface_hint: "The Gate width is 4m." },
    { kind: "relational", id: "r1", subject: "Relay", predicate: "feeds", object: "Gate", surface_hint: "The Relay feeds the Gate." },
  ],
};

describe("buildAuthoringPlan", () => {
  test("is deterministic for the same facts + counts", () => {
    const opts = { maxFactsPerDoc: 10, counts: { T1: 2, T2: 2, T3: 2, T4: 1, T5: 2 } };
    const a = buildAuthoringPlan(facts, opts);
    const b = buildAuthoringPlan(facts, opts);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("groups facts into per-entity documents and plans the requested query counts", () => {
    const plan = buildAuthoringPlan(facts, { maxFactsPerDoc: 10, counts: { T1: 2, T2: 2, T3: 2, T4: 1, T5: 2 } });
    // Relay (3 facts incl. the relational) + Gate (1) → 2 documents.
    expect(plan.documents.map((d) => d.slug).sort()).toEqual(["gate", "relay"]);
    const byTier = (t: string) => plan.query_specs.filter((s) => s.tier === t).length;
    expect(byTier("T1")).toBe(2);
    expect(byTier("T4")).toBe(1);
    expect(byTier("T5")).toBe(2);
  });

  test("T4 specs target BOTH chain facts; T5 specs target none; T1 is not anti-leakage", () => {
    const plan = buildAuthoringPlan(facts, { maxFactsPerDoc: 10, counts: { T1: 1, T2: 1, T3: 1, T4: 1, T5: 1 } });
    const t4 = plan.query_specs.find((s) => s.tier === "T4")!;
    expect(t4.target_fact_ids).toHaveLength(2);
    expect(t4.anti_leakage).toBe(true);
    const t5 = plan.query_specs.find((s) => s.tier === "T5")!;
    expect(t5.target_fact_ids).toHaveLength(0);
    const t1 = plan.query_specs.find((s) => s.tier === "T1")!;
    expect(t1.anti_leakage).toBe(false);
  });
});

const plan2: AuthoringPlan = buildAuthoringPlan(facts, { maxFactsPerDoc: 10, counts: { T1: 1, T2: 1, T3: 1, T4: 0, T5: 1 } });

describe("assembleCorpus", () => {
  test("accepts documents that embed every surface hint verbatim", () => {
    const docMarkdown = new Map([
      ["relay", "# Relay\n\nThe Relay threshold is 9. The Relay color is blue. The Relay feeds the Gate.\n"],
      ["gate", "# Gate\n\nThe Gate width is 4m.\n"],
    ]);
    const { manifest, files } = assembleCorpus({ plan: plan2, docMarkdown, corpusDir: "/c", author: { provider: "claude-code-agent", model: "sonnet" } });
    expect(files).toHaveLength(2);
    expect(manifest.corpus_author.model).toBe("sonnet");
    const relay = manifest.documents.find((d) => d.filename === "relay.md")!;
    expect(relay.planted_fact_ids.sort()).toEqual(["a1", "a2", "r1"]);
    expect(relay.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("rejects a document missing a hint (re-author signal)", () => {
    const docMarkdown = new Map([
      ["relay", "# Relay\n\nThe Relay threshold is 9. The Relay feeds the Gate.\n"], // missing a2 (color)
      ["gate", "# Gate\n\nThe Gate width is 4m.\n"],
    ]);
    expect(() => assembleCorpus({ plan: plan2, docMarkdown, corpusDir: "/c", author: { provider: "x", model: "sonnet" } })).toThrow(CorpusValidationError);
  });

  test("matches hints across whitespace differences (normalize-include)", () => {
    const docMarkdown = new Map([
      ["relay", "# Relay\n\nThe   Relay    threshold is 9.\nThe Relay color is blue. The Relay feeds the Gate.\n"],
      ["gate", "The Gate width is 4m."],
    ]);
    expect(() => assembleCorpus({ plan: plan2, docMarkdown, corpusDir: "/c", author: { provider: "x", model: "s" } })).not.toThrow();
  });
});

describe("assembleQueries", () => {
  const queryText = (over: Record<string, string> = {}): Map<string, string> => {
    const base: Record<string, string> = {};
    for (const s of plan2.query_specs) base[s.spec_id] = "a perfectly neutral question phrasing";
    return new Map(Object.entries({ ...base, ...over }));
  };

  test("assigns sequential ids and scores anti-leakage for gated tiers only", () => {
    const out = assembleQueries({ plan: plan2, queryText: queryText(), threshold: 0.4, author: { provider: "claude-code-agent", model: "opus" } });
    expect(out.query_author.model).toBe("opus");
    expect(out.queries.map((q) => q.id)).toEqual(out.queries.map((_, i) => `q-${String(i + 1).padStart(4, "0")}`));
    const t1 = out.queries.find((q) => q.tier === "T1")!;
    const t2 = out.queries.find((q) => q.tier === "T2")!;
    const t5 = out.queries.find((q) => q.tier === "T5")!;
    expect(t1.anti_leakage_score).toBeNull(); // lexical-by-design
    expect(t5.anti_leakage_score).toBeNull(); // negative, no target
    expect(typeof t2.anti_leakage_score).toBe("number"); // gated
  });

  test("rejects a gated query that lexically echoes its hint (leak)", () => {
    // T2 targets an atomic fact; echo its hint words to force Jaccard over threshold.
    const t2 = plan2.query_specs.find((s) => s.tier === "T2")!;
    const hint = t2.facts[0]!.surface_hint; // e.g. "The Relay threshold is 9."
    expect(() => assembleQueries({ plan: plan2, queryText: queryText({ [t2.spec_id]: hint }), threshold: 0.4, author: { provider: "x", model: "opus" } })).toThrow(CorpusValidationError);
  });

  test("rejects a missing/empty query draft", () => {
    const t = queryText();
    const someId = plan2.query_specs[0]!.spec_id;
    t.set(someId, "   ");
    expect(() => assembleQueries({ plan: plan2, queryText: t, threshold: 0.4, author: { provider: "x", model: "opus" } })).toThrow(CorpusValidationError);
  });
});
