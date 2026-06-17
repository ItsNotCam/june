// author: Claude
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Database } from "bun:sqlite";
import type {
  BatchLlmProvider,
  BatchSubmitRequest,
} from "@/providers/types";
import type { FactsFile } from "@/types/facts";
import type { QueriesFile } from "@/types/query";
import type { BaselineAnswersFile, ReaderAnswersFile } from "@/types/reader";
import { runStage8 } from "@/stages/08-judge";
import { loadTestConfig } from "../helpers";

/**
 * Stage 8 must hand the judge the SAME chunk text the reader saw, hydrated from
 * the scratch SQLite by `retrieved_chunk_ids`. This is the structural fix for
 * the judge-false-negative class: without the retrieved context, the judge only
 * sees the one-line surface_hint and scores all grounded elaboration as
 * hallucination. These tests assert the context actually reaches the prompt.
 */

const CHUNK_ID = "chunk-snorblath-control";
const CHUNK_TEXT =
  "Snorblath Protocol uses port 7455 for control messages, including session " +
  "negotiation, keepalive signaling, and administrative commands.";

let scratchDir: string;

/** Captures every BatchSubmitRequest so the test can inspect the rendered prompt. */
const capturingProvider = (
  sink: BatchSubmitRequest[],
): BatchLlmProvider => ({
  name: "anthropic-batch",
  submit: async (reqs: BatchSubmitRequest[]) => {
    sink.push(...reqs);
    return { batch_id: "test-batch" };
  },
  poll: async () => ({
    status: "ended" as const,
    results_url: "https://example/results",
  }),
  retrieve: async () =>
    sink.map((r) => ({
      custom_id: r.custom_id,
      status: "succeeded" as const,
      text: JSON.stringify({ verdict: "CORRECT", rationale: "ok" }),
      error: null,
      cost_usd: 0,
      prompt_tokens: null,
      completion_tokens: null,
    })),
});

const facts: FactsFile = {
  fixture_id: "TESTFIXTURE",
  fixture_seed: 1,
  schema_version: 1,
  domain_name: "test",
  generated_at: "2026-01-01T00:00:00Z",
  facts: [
    {
      kind: "atomic",
      id: "f-1",
      entity: "Snorblath Protocol",
      attribute: "control_port",
      value: "7455",
      surface_hint: "Snorblath Protocol uses port 7455 for control messages",
    },
  ],
};

const queries: QueriesFile = {
  fixture_id: "TESTFIXTURE",
  schema_version: 1,
  query_author: { provider: "anthropic", model: "claude-sonnet-4-6" },
  queries: [
    {
      id: "q-1",
      tier: "T1",
      text: "What port does Snorblath Protocol use for control messages?",
      expected_fact_ids: ["f-1"],
      anti_leakage_score: null,
      generation_attempts: 1,
    },
  ],
};

const reader: ReaderAnswersFile = {
  fixture_id: "TESTFIXTURE",
  reader: { provider: "ollama", model: "llama3.1:latest", temperature: 0 },
  answers: [
    {
      query_id: "q-1",
      answer_text:
        "Snorblath Protocol uses port 7455 for control messages, including " +
        "session negotiation, keepalive signaling, and administrative commands.",
      retrieved_chunk_ids: [CHUNK_ID],
      latency_ms: 1,
      prompt_tokens: null,
      completion_tokens: null,
    },
  ],
};

beforeAll(async () => {
  await loadTestConfig();
  scratchDir = await mkdtemp(join(tmpdir(), "bench-judge-ctx-"));
  // Build a minimal june.db with the one column renderChunksById reads.
  const db = new Database(join(scratchDir, "june.db"));
  db.run(`CREATE TABLE chunks (chunk_id TEXT PRIMARY KEY, raw_content TEXT NOT NULL)`);
  db.run(`INSERT INTO chunks (chunk_id, raw_content) VALUES (?, ?)`, [
    CHUNK_ID,
    CHUNK_TEXT,
  ]);
  db.close();
});

afterAll(() => {
  // tmpdir is reclaimed by the OS; nothing to do.
});

describe("Stage 8 — judge grounding context (§22)", () => {
  test("buildRequests hydrates retrieved chunk text into the judge prompt", async () => {
    const submitted: BatchSubmitRequest[] = [];
    const outPath = join(scratchDir, "judge_results.json");
    await runStage8({
      facts,
      queries,
      reader,
      baseline: null,
      judge: {
        providerName: "anthropic-batch",
        batchProvider: capturingProvider(submitted),
        syncProvider: null,
        model: "claude-sonnet-4-6",
        max_tokens: 512,
        concurrency: 8,
      },
      checkpoint_path: join(scratchDir, "batch_submission.json"),
      resume_batch_id: undefined,
      out_path: outPath,
      scratch_path: scratchDir,
    });

    expect(submitted.length).toBe(1);
    const content = submitted[0]!.messages[0]!.content;
    // The full chunk text — including the elaboration that the old judge would
    // have flagged as hallucination — must be present as grounding.
    expect(content).toContain(CHUNK_TEXT);
    expect(content).toContain(`<chunk id="${CHUNK_ID}">`);
    expect(content).toContain("session negotiation");
  });

  test("baseline answers (no retrieval) get an explicit empty-context marker", async () => {
    const submitted: BatchSubmitRequest[] = [];
    const baseline: BaselineAnswersFile = {
      fixture_id: "TESTFIXTURE",
      baseline: { provider: "anthropic", model: "claude-sonnet-4-6", temperature: 0 },
      answers: [
        {
          query_id: "q-1",
          answer_text: "The provided context does not contain information to answer this question.",
          retrieved_chunk_ids: [],
          latency_ms: 1,
          prompt_tokens: null,
          completion_tokens: null,
        },
      ],
    };
    await runStage8({
      facts,
      queries,
      reader,
      baseline,
      judge: {
        providerName: "anthropic-batch",
        batchProvider: capturingProvider(submitted),
        syncProvider: null,
        model: "claude-sonnet-4-6",
        max_tokens: 512,
        concurrency: 8,
      },
      checkpoint_path: join(scratchDir, "batch_submission2.json"),
      resume_batch_id: undefined,
      out_path: join(scratchDir, "judge_results2.json"),
      scratch_path: scratchDir,
    });

    // reader (1) + baseline (1) requests captured across both judge passes.
    const baselineReq = submitted.find((r) => r.custom_id === "baseline_q-1");
    expect(baselineReq).toBeDefined();
    expect(baselineReq!.messages[0]!.content).toContain("no retrieved context");
  });
});
