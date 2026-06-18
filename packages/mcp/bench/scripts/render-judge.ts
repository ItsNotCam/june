#!/usr/bin/env bun
/**
 * Render a run's judge_tasks.json into per-task prompts using the bench's OWN
 * renderJudgePrompt — guarantees byte-identical prompts to in-bench judging.
 * Usage: bun scripts/render-judge.ts <run_dir>
 * Emits to stdout: { run_id, fixture_id, prompt_template_hash, tasks: [{query_id, tier, prompt}] }
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { renderJudgePrompt } from "@/judge/llm-judge";

const runDir = process.argv[2];
if (!runDir) throw new Error("usage: render-judge.ts <run_dir>");

const tasksFile = JSON.parse(
  await readFile(join(runDir, "judge_tasks.json"), "utf8"),
);

const tasks = [];
for (const t of tasksFile.tasks) {
  const prompt = await renderJudgePrompt({
    query_id: t.query_id,
    query_text: t.query_text,
    tier: t.tier,
    expected_facts: t.expected_facts ?? [],
    reader_answer: t.reader_answer,
    retrieved_context: t.retrieved_context ?? "",
  } as any);
  tasks.push({ query_id: t.query_id, tier: t.tier, prompt });
}

process.stdout.write(
  JSON.stringify(
    {
      run_id: tasksFile.run_id,
      fixture_id: tasksFile.fixture_id,
      prompt_template_hash: tasksFile.prompt_template_hash,
      tasks,
    },
    null,
    0,
  ),
);
