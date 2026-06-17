// author: Claude
import { describe, expect, test, beforeAll } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { CorpusManifest } from "@/types/corpus";
import type { HoldoutManifest, HoldoutQuery } from "@/types/holdout";
import {
  computeDocRecall,
  computeDocMrr,
  median,
  resolveExpectedDocIds,
  type RetrievedDoc,
} from "@/lib/holdout";
import {
  buildHoldoutPerQuery,
  buildHoldoutResults,
  rescoreHoldoutWithVerdicts,
  renderHoldoutSummary,
  type HoldoutPerQueryInput,
} from "@/lib/holdout-score";
import { juneDocId } from "@/lib/ids";
import { GroundTruthResolutionError } from "@/lib/errors";
import { loadTestConfig } from "../helpers";

/**
 * Doc-level holdout scoring (Phase 4). Recall@k is "a chunk from an expected
 * DOCUMENT in top-k" (no fact resolution); the honest reader signal is the
 * RAG−noRAG delta. Aggregation reuses the bootstrap-CI machinery.
 */

beforeAll(async () => {
  await loadTestConfig();
});

const r = (doc_id: string, score: number): RetrievedDoc => ({ chunk_id: `c-${doc_id}-${score}`, doc_id, score });

describe("computeDocRecall", () => {
  test("hits when any expected doc's chunk is in top-k", () => {
    const retrieved = [r("d2", 0.9), r("d1", 0.8), r("d3", 0.7)];
    expect(computeDocRecall(["d1"], retrieved, 1)).toBe(0);
    expect(computeDocRecall(["d1"], retrieved, 3)).toBe(1);
    expect(computeDocRecall(["d3"], retrieved, 2)).toBe(0);
  });
  test("is 0 for an unanswerable query (no expected docs)", () => {
    expect(computeDocRecall([], [r("d1", 0.9)], 10)).toBe(0);
  });
  test("multiple expected docs — any one suffices", () => {
    expect(computeDocRecall(["dX", "d2"], [r("d2", 0.9)], 1)).toBe(1);
  });
});

describe("computeDocMrr", () => {
  test("reciprocal rank of the earliest expected-doc chunk", () => {
    expect(computeDocMrr(["d1"], [r("d2", 0.9), r("d1", 0.8)])).toBe(1 / 2);
    expect(computeDocMrr(["d2"], [r("d2", 0.9), r("d1", 0.8)])).toBe(1);
  });
  test("0 when no expected-doc chunk is retrieved or unanswerable", () => {
    expect(computeDocMrr(["dX"], [r("d1", 0.9)])).toBe(0);
    expect(computeDocMrr([], [r("d1", 0.9)])).toBe(0);
  });
});

describe("median", () => {
  test("odd / even / empty", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(null);
  });
});

describe("resolveExpectedDocIds", () => {
  test("maps filenames to june doc_ids and throws on an unknown filename", async () => {
    const dir = await mkdtemp(join(tmpdir(), "holdout-resolve-"));
    await mkdir(join(dir, "corpus"), { recursive: true });
    const docPath = join(dir, "corpus", "app-routing.md");
    await writeFile(docPath, "# Routing\n", "utf-8");
    const manifest: CorpusManifest = {
      fixture_id: "H", schema_version: 1, corpus_author: { provider: "real", model: "nextjs-docs" },
      documents: [{
        filename: "app-routing.md", absolute_path: docPath, document_title: "Routing",
        planted_fact_ids: [], validator_attempts: 1, validator_status: "pass", content_hash: "x",
      }],
    };
    const q: HoldoutQuery = {
      id: "q-0001", text: "routes?", expected_doc_filenames: ["app-routing.md"],
      gold_answer: "folders", unanswerable: false, source_urls: [],
    };
    expect(resolveExpectedDocIds(q, manifest)).toEqual([juneDocId(docPath)]);

    const bad: HoldoutQuery = { ...q, expected_doc_filenames: ["missing.md"] };
    expect(() => resolveExpectedDocIds(bad, manifest)).toThrow(GroundTruthResolutionError);
  });
});

const manifest: HoldoutManifest = {
  holdout_id: "H", holdout_hash: "HH", run_id: "RUN", bench_version: "0.1.0", schema_version: 1,
  started_at: "t0", completed_at: "t1", mode: "control",
  reader: { provider: "ollama", model: "gemma4:26b", temperature: 0 },
  judge: { provider: "external", model: "", prompt_template_hash: "ph" },
  baseline: { provider: "ollama", model: "gemma4:26b" },
  june: { ingest_run_id: "ir", schema_version: 1, embedding_model: "e", embedding_model_version: "1" },
  source: { name: "Next.js documentation", url: "u", doc_count: 2 },
  label_author: { provider: "claude-code-agent", model: "claude-opus-4-8" },
};

const q = (id: string, unanswerable: boolean): HoldoutQuery => ({
  id, text: `${id}?`, expected_doc_filenames: unanswerable ? [] : ["d.md"],
  gold_answer: unanswerable ? "" : "ans", unanswerable, source_urls: [],
});

const inputs: HoldoutPerQueryInput[] = [
  { query: q("q-0001", false), expected_doc_ids: ["d1"], retrieved: [r("d1", 0.9)], reader_answer: "a1", baseline_answer: "b1" },
  { query: q("q-0002", false), expected_doc_ids: ["d2"], retrieved: [r("dX", 0.9)], reader_answer: "a2", baseline_answer: "b2" },
  { query: q("q-0003", true), expected_doc_ids: [], retrieved: [r("dY", 0.5)], reader_answer: "a3", baseline_answer: "b3" },
];

describe("buildHoldoutResults + rescore", () => {
  test("partial run: retrieval final, verdicts pending, blocks split by answerability", () => {
    const partial = buildHoldoutResults({
      holdout_id: "H", holdout_hash: "HH", run_id: "RUN", run_status: "awaiting_verdicts",
      started_at: "t0", completed_at: "t1", manifest,
      per_query: buildHoldoutPerQuery(inputs), queries_with_unknown_doc: 0,
      cost_usd: { role_1: 0, role_2: 0, role_3: 0, role_4: 0, total: 0 },
    });
    expect(partial.kind).toBe("holdout");
    expect(partial.sealed).toBe(true);
    expect(partial.answerable.query_count).toBe(2);
    expect(partial.unanswerable.query_count).toBe(1);
    // q-0001 recall@1 = 1 (d1 ranked first); q-0002 = 0 (dX) → answerable recall@1 point = 0.5.
    expect(partial.answerable.recall_at_1.point).toBe(0.5);
    expect(partial.integrity.unjudged_pct).toBe(1);
    expect(partial.unanswerable.top1_score_median).toBe(0.5);
  });

  test("rescore overlays verdicts; RAG correct% counts refusal-correct for unanswerable", () => {
    const partial = buildHoldoutResults({
      holdout_id: "H", holdout_hash: "HH", run_id: "RUN", run_status: "awaiting_verdicts",
      started_at: "t0", completed_at: "t1", manifest,
      per_query: buildHoldoutPerQuery(inputs), queries_with_unknown_doc: 0,
      cost_usd: { role_1: 0, role_2: 0, role_3: 0, role_4: 0, total: 0 },
    });
    const final = rescoreHoldoutWithVerdicts({
      partial,
      verdicts: [
        { query_id: "q-0001", verdict: "CORRECT", rationale: "", unjudged_reason: null },
        { query_id: "q-0002", verdict: "INCORRECT", rationale: "", unjudged_reason: null },
        { query_id: "q-0003", verdict: "REFUSED", rationale: "", unjudged_reason: null },
        { query_id: "baseline_q-0001", verdict: "CORRECT", rationale: "", unjudged_reason: null },
        { query_id: "baseline_q-0002", verdict: "CORRECT", rationale: "", unjudged_reason: null },
        { query_id: "baseline_q-0003", verdict: "INCORRECT", rationale: "", unjudged_reason: null },
      ],
      judge: { kind: "claude-code-agent", model: "claude-sonnet-4-6", prompt_template_hash: "ph", judged_at: "t2" },
      run_status: "completed", completed_at: "t2",
    });
    expect(final.run_status).toBe("completed");
    // answerable correct = q-0001 only → 1/2
    expect(final.answerable.reader_correct_pct.point).toBe(0.5);
    // overall RAG correct = q-0001 (CORRECT) + q-0003 (REFUSED) → 2/3
    expect(final.reader_rag_correct_pct.point).toBeCloseTo(2 / 3, 5);
    // overall no-RAG correct = baseline q-0001 + q-0002 CORRECT; q-0003 INCORRECT (refusal expected, not met) → 2/3
    expect(final.reader_norag_correct_pct?.point).toBeCloseTo(2 / 3, 5);
    expect(final.manifest.judge.model).toBe("claude-sonnet-4-6");
    expect(final.integrity.unjudged_pct).toBe(0);
  });

  test("summary leads with retrieval and carries the parametric caveat", () => {
    const partial = buildHoldoutResults({
      holdout_id: "H", holdout_hash: "HH", run_id: "RUN", run_status: "awaiting_verdicts",
      started_at: "t0", completed_at: "t1", manifest,
      per_query: buildHoldoutPerQuery(inputs), queries_with_unknown_doc: 0,
      cost_usd: { role_1: 0, role_2: 0, role_3: 0, role_4: 0, total: 0 },
    });
    const md = renderHoldoutSummary(partial);
    expect(md).toContain("SEALED REAL-DOC HOLDOUT");
    expect(md).toContain("Parametric-knowledge caveat");
    expect(md.indexOf("## Retrieval")).toBeLessThan(md.indexOf("## Reader"));
  });
});
