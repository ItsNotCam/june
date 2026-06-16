// author: Claude
/**
 * Multi-hop retriever — sequential N-bridge resolution + chain injection.
 *
 * The load-bearing test is PARITY: for a 2-hop (T4) decomposition the new
 * sequential walk must return an array element-identical to the old
 * single-bridge `injectAtomic`, so the pinned T4 golden cannot move. The 3-hop
 * tests prove the chain walk captures the intermediate relational chunk and
 * injects both it and the atomic into the reader window.
 */
import { describe, test, expect, beforeAll } from "bun:test";
import { createMultiHopRetriever } from "@/retriever/multi-hop";
import type { Retriever, RetrievalResult } from "@/retriever/types";
import type { LlmProvider, LlmCallRequest, LlmCallResponse } from "@/providers/types";
import { BudgetMeter } from "@/lib/cost";
import { loadTestConfig } from "../helpers";

const WINDOW_K = 5;
const K = 10;

const res = (id: string): RetrievalResult => ({ chunk_id: id, score: 1, rank_source: "fused" });
const ids = (rs: readonly RetrievalResult[]): string[] => rs.map((r) => r.chunk_id);

/**
 * A scripted inner retriever: maps a query string to a result list by matching
 * `routes` predicates in order (first match wins), falling back to `base`.
 */
const makeInner = (
  base: RetrievalResult[],
  routes: Array<{ match: (q: string) => boolean; results: RetrievalResult[] }>,
): Retriever => ({
  name: "stub",
  config_snapshot: {},
  retrieve: async (queryText: string): Promise<RetrievalResult[]> => {
    for (const route of routes) {
      if (route.match(queryText)) return route.results;
    }
    return base;
  },
});

/**
 * A scripted planner provider. `decompose` returns the given hops JSON; each
 * `extract` entry answers a bridge call whose rendered prompt contains its
 * `when` substring (so different hop questions resolve to different entities).
 */
const makeProvider = (script: {
  hops: unknown;
  extracts: Array<{ when: string; entity: string; chunk_id?: string }>;
}): LlmProvider => ({
  name: "deepseek",
  call: async (req: LlmCallRequest): Promise<LlmCallResponse> => {
    const prompt = req.messages.map((m) => m.content).join("\n");
    const resp = (text: string): LlmCallResponse => ({
      text,
      prompt_tokens: 1,
      completion_tokens: 1,
      cost_usd: 0,
      latency_ms: 1,
    });
    // The decompose prompt is the only one carrying the planner header.
    if (prompt.includes("retrieval query planner")) {
      return resp(JSON.stringify(script.hops));
    }
    // Otherwise it's an extract-bridge call — match on the embedded question.
    for (const e of script.extracts) {
      if (prompt.includes(e.when)) {
        return resp(JSON.stringify(e.chunk_id ? { entity: e.entity, chunk_id: e.chunk_id } : { entity: e.entity }));
      }
    }
    return resp(JSON.stringify({ entity: "" }));
  },
});

const build = (inner: Retriever, provider: LlmProvider) =>
  createMultiHopRetriever({
    inner,
    plannerProvider: provider,
    plannerModel: "deepseek-v4-flash",
    plannerMaxTokens: 256,
    fetchChunkContent: (id) => `content of ${id}`,
    windowK: WINDOW_K,
    budget: new BudgetMeter(),
  });

beforeAll(async () => {
  await loadTestConfig();
});

describe("multi-hop — single-pass passthrough", () => {
  test("a 1-hop decomposition returns base unchanged", async () => {
    const base = ["c1", "c2", "c3", "c4", "c5", "c6"].map(res);
    const inner = makeInner(base, []);
    const provider = makeProvider({ hops: { hops: [{ query: "what port does X use?" }] }, extracts: [] });
    const out = await build(inner, provider).retrieve("what port does X use?", K);
    expect(ids(out)).toEqual(ids(base));
  });
});

describe("multi-hop — N=2 PARITY (must equal old injectAtomic byte-for-byte)", () => {
  const base = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10"].map(res);
  const hops = {
    hops: [
      { query: "What does A authenticate via?" },
      { query: "What is the max packet size of {0}?", depends_on: 0 },
    ],
  };

  test("atomic#1 NOVEL → injected at the reserved tail slot, head top-4 preserved", async () => {
    const inner = makeInner(base, [
      { match: (q) => q.includes("max packet size"), results: ["aX", "aY"].map(res) },
    ]);
    const provider = makeProvider({ hops, extracts: [{ when: "authenticate", entity: "B" }] });
    const out = await build(inner, provider).retrieve("orig query", K);
    // headCount = 5 - 1 = 4 → [c1..c4, aX, then base tail minus aX].
    expect(ids(out)).toEqual(["c1", "c2", "c3", "c4", "aX", "c5", "c6", "c7", "c8", "c9"]);
  });

  test("atomic#1 ALREADY in base window → nothing injected, base returned", async () => {
    const inner = makeInner(base, [
      { match: (q) => q.includes("max packet size"), results: ["c2", "aY"].map(res) },
    ]);
    const provider = makeProvider({ hops, extracts: [{ when: "authenticate", entity: "B" }] });
    const out = await build(inner, provider).retrieve("orig query", K);
    expect(ids(out)).toEqual(ids(base).slice(0, K));
  });

  test("bridge extraction fails → base returned (unsliced floor)", async () => {
    const inner = makeInner(base, [
      { match: (q) => q.includes("max packet size"), results: ["aX"].map(res) },
    ]);
    const provider = makeProvider({ hops, extracts: [{ when: "authenticate", entity: "" }] });
    const out = await build(inner, provider).retrieve("orig query", K);
    expect(ids(out)).toEqual(ids(base));
  });
});

describe("multi-hop — N=3 chain walk", () => {
  const base = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10"].map(res);
  const hops = {
    hops: [
      { query: "What does A authenticate via?" },
      { query: "What does {0} wrap?", depends_on: 0 },
      { query: "What is the max packet size of {1}?", depends_on: 1 },
    ],
  };

  test("captures the cited intermediate chunk + atomic, both land in top-5", async () => {
    const inner = makeInner(base, [
      { match: (q) => q.includes("wrap"), results: ["rel2", "distractor"].map(res) },
      { match: (q) => q.includes("max packet size"), results: ["atomic", "aY"].map(res) },
    ]);
    const provider = makeProvider({
      hops,
      extracts: [
        { when: "authenticate", entity: "B1" },
        { when: "wrap", entity: "B2", chunk_id: "rel2" }, // extractor cites rel2 as source
      ],
    });
    const out = await build(inner, provider).retrieve("orig query", K);
    // reserve = [rel2, atomic] → headCount = 5 - 2 = 3 → top-5 = c1,c2,c3,rel2,atomic.
    expect(ids(out).slice(0, WINDOW_K)).toEqual(["c1", "c2", "c3", "rel2", "atomic"]);
    expect(ids(out)).toContain("rel2");
    expect(ids(out)).toContain("atomic");
  });

  test("no cited chunk_id → falls back to the top-novel sub candidate", async () => {
    const inner = makeInner(base, [
      { match: (q) => q.includes("wrap"), results: ["rel2", "more"].map(res) },
      { match: (q) => q.includes("max packet size"), results: ["atomic"].map(res) },
    ]);
    const provider = makeProvider({
      hops,
      extracts: [
        { when: "authenticate", entity: "B1" },
        { when: "wrap", entity: "B2" }, // no chunk_id → fallback to rel2 (top novel)
      ],
    });
    const out = await build(inner, provider).retrieve("orig query", K);
    expect(ids(out).slice(0, WINDOW_K)).toEqual(["c1", "c2", "c3", "rel2", "atomic"]);
  });

  test("an intermediate hop that fails to resolve → base floor", async () => {
    const inner = makeInner(base, [
      { match: (q) => q.includes("wrap"), results: ["rel2"].map(res) },
      { match: (q) => q.includes("max packet size"), results: ["atomic"].map(res) },
    ]);
    const provider = makeProvider({
      hops,
      extracts: [
        { when: "authenticate", entity: "B1" },
        { when: "wrap", entity: "" }, // B2 unresolved
      ],
    });
    const out = await build(inner, provider).retrieve("orig query", K);
    expect(ids(out)).toEqual(ids(base));
  });
});

describe("multi-hop — malformed chains degrade to the floor", () => {
  const base = ["c1", "c2", "c3", "c4", "c5"].map(res);

  test("a branching (non-linear) decomposition returns base", async () => {
    const inner = makeInner(base, []); // degrades before any sub-query retrieval
    // two hops both depend on hop 0 → branching, not a linear chain.
    const provider = makeProvider({
      hops: {
        hops: [
          { query: "root?" },
          { query: "uses {0}?", depends_on: 0 },
          { query: "also {0}?", depends_on: 0 },
        ],
      },
      extracts: [{ when: "root", entity: "B" }],
    });
    const out = await build(inner, provider).retrieve("orig query", K);
    expect(ids(out)).toEqual(ids(base));
  });

  test("no root hop (every hop has depends_on) returns base", async () => {
    const inner = makeInner(base, []); // degrades before any sub-query retrieval
    const provider = makeProvider({
      hops: {
        hops: [
          { query: "a {1}?", depends_on: 1 },
          { query: "b {0}?", depends_on: 0 },
        ],
      },
      extracts: [],
    });
    const out = await build(inner, provider).retrieve("orig query", K);
    expect(ids(out)).toEqual(ids(base));
  });
});
