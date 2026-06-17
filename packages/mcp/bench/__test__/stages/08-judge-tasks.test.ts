// author: Claude
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Database } from "bun:sqlite";
import type { FactsFile } from "@/types/facts";
import type { QueriesFile } from "@/types/query";
import type { BaselineAnswersFile, ReaderAnswersFile } from "@/types/reader";
import type { JudgeTasksFile } from "@/types/judge-tasks";
import { buildJudgeTasks } from "@/stages/08-judge";
import { readJson } from "@/lib/artifacts";
import { loadTestConfig } from "../helpers";

/**
 * The no-API judge path: `buildJudgeTasks` must emit a self-contained
 * judge_tasks.json — every task carrying the PRE-RENDERED retrieved context (so
 * an out-of-process judge needs no DB), baseline tasks carrying the
 * BASELINE_QUERY_PREFIX, and the judge prompt's hash stamped in for the
 * cross-judge guard. No LLM is called.
 */

const CHUNK_ID = "chunk-snorblath-control";
const CHUNK_TEXT =
  "Snorblath Protocol uses port 7455 for control messages, including session " +
  "negotiation, keepalive signaling, and administrative commands.";

let scratchDir: string;

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
  reader: { provider: "ollama", model: "gemma4:26b", temperature: 0 },
  answers: [
    {
      query_id: "q-1",
      answer_text: "Snorblath Protocol uses port 7455 for control messages.",
      retrieved_chunk_ids: [CHUNK_ID],
      latency_ms: 1,
      prompt_tokens: null,
      completion_tokens: null,
    },
  ],
};

const baseline: BaselineAnswersFile = {
  fixture_id: "TESTFIXTURE",
  baseline: { provider: "anthropic", model: "claude-opus-4-7", temperature: 0 },
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

beforeAll(async () => {
  await loadTestConfig();
  scratchDir = await mkdtemp(join(tmpdir(), "bench-judge-tasks-"));
  const db = new Database(join(scratchDir, "june.db"));
  db.run(`CREATE TABLE chunks (chunk_id TEXT PRIMARY KEY, raw_content TEXT NOT NULL)`);
  db.run(`INSERT INTO chunks (chunk_id, raw_content) VALUES (?, ?)`, [CHUNK_ID, CHUNK_TEXT]);
  db.close();
});

describe("Stage 8 — externalized judge tasks (no-API path)", () => {
  test("emits reader + baseline tasks with pre-rendered context and a prompt hash", async () => {
    const outPath = join(scratchDir, "judge_tasks.json");
    const file = await buildJudgeTasks({
      facts,
      queries,
      reader,
      baseline,
      run_id: "run-xyz",
      scratch_path: scratchDir,
      out_path: outPath,
    });

    // The on-disk artifact equals the returned value.
    const onDisk = (await readJson(outPath)) as JudgeTasksFile;
    expect(onDisk).toEqual(file);

    expect(file.fixture_id).toBe("TESTFIXTURE");
    expect(file.run_id).toBe("run-xyz");
    expect(file.prompt_template).toBe("judge");
    // SHA-256 of prompts/judge.md — 64 lowercase hex chars.
    expect(file.prompt_template_hash).toMatch(/^[0-9a-f]{64}$/);

    // One reader task + one baseline task.
    expect(file.tasks).toHaveLength(2);

    const readerTask = file.tasks.find((t) => !t.is_baseline)!;
    expect(readerTask.query_id).toBe("q-1");
    expect(readerTask.tier).toBe("T1");
    expect(readerTask.expected_facts).toEqual([
      { surface_hint: "Snorblath Protocol uses port 7455 for control messages" },
    ]);
    // Context is PRE-RENDERED — the external judge needs no DB access.
    expect(readerTask.retrieved_context).toContain(`<chunk id="${CHUNK_ID}">`);
    expect(readerTask.retrieved_context).toContain(CHUNK_TEXT);

    const baselineTask = file.tasks.find((t) => t.is_baseline)!;
    // Baseline tasks carry the prefix so Stage 9 / score splits the streams.
    expect(baselineTask.query_id).toBe("baseline_q-1");
    // No-RAG baseline saw no chunks.
    expect(baselineTask.retrieved_context).toBe("");
  });

  test("omits baseline tasks when no baseline pass ran", async () => {
    const file = await buildJudgeTasks({
      facts,
      queries,
      reader,
      baseline: null,
      run_id: "run-no-baseline",
      scratch_path: scratchDir,
      out_path: join(scratchDir, "judge_tasks_nb.json"),
    });
    expect(file.tasks).toHaveLength(1);
    expect(file.tasks[0]!.is_baseline).toBe(false);
  });
});
