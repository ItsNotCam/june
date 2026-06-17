<!-- author: Claude -->
# Judge runner protocol (the no-API judge)

The bench is a **deterministic measurement instrument that makes no LLM API
calls.** It runs retrieval (local Qdrant — deterministic recall@k/MRR) and the
reader (local model), then emits `judge_tasks.json` and halts. **The Claude Code
instance running the RSI loop judges those tasks with its own Sonnet sub-agents**
(Claude Code's agent mechanism — no API keys) and writes `verdicts.json`, which
`june-eval score` ingests to finalize the run.

This file is the contract between the bench and that orchestrator. The automated
loop that *invokes* this protocol is out of scope for the current foundation;
until it exists, a human-driven Claude Code session plays the orchestrator.

```
june-eval run <fixture> --mode control            # bench, local, NO API
   → writes <run-dir>/judge_tasks.json  (run_status: awaiting_verdicts)

orchestrator (Claude Code)                         # Sonnet agents, NO API key
   → reads judge_tasks.json
   → for each task: render prompts/judge.md, judge with a constrained Sonnet agent
   → writes verdicts.json

june-eval score <run-dir> --verdicts verdicts.json # bench, pure aggregation
   → finalizes results.json + summary.md  (run_status: completed)

june-eval control-check <run-dir>                  # the regression gate
```

## 1. Read `judge_tasks.json`

```jsonc
{
  "fixture_id": "…",
  "run_id": "…",
  "schema_version": 1,
  "prompt_template": "judge",          // render prompts/<this>.md
  "prompt_template_hash": "<sha256>",  // copy verbatim into verdicts.json
  "tasks": [
    {
      "query_id": "q-0001",            // baseline tasks are "baseline_q-0001"
      "query_text": "…",
      "tier": "T1",
      "expected_facts": [{ "surface_hint": "…" }],
      "reader_answer": "…",
      "retrieved_context": "<chunk id=\"…\">…</chunk>\n\n…",  // "" for baseline
      "is_baseline": false
    }
  ]
}
```

Each task is **self-contained** — `retrieved_context` is pre-rendered, so the
judge needs no database or Qdrant access.

## 2. Render the judge prompt per task

Load `prompts/judge.md` (the template whose hash is in the file) and substitute,
one task at a time:

| Placeholder | Value from the task |
|---|---|
| `{{query_tier}}` | `task.tier` |
| `{{query_text}}` | `task.query_text` |
| `{{expected_surface_hints_bulleted}}` | `task.expected_facts` as `- <surface_hint>` lines; if empty (T5), `- (no expected facts — T5 negative query)` |
| `{{retrieved_context}}` | `task.retrieved_context`; if empty, `(no retrieved context — this is a no-RAG baseline answer)` |
| `{{reader_answer}}` | `task.reader_answer` |

This mirrors `renderJudgePrompt` in `src/judge/llm-judge.ts` exactly — keep it in
sync so in-bench and external judging see byte-identical prompts.

## 3. Judge each task with a constrained Sonnet agent

Spawn a **Sonnet** sub-agent per task (or a small batch per agent). Constrain it
to act as a pure judge, not a free-roaming agent:

- **Model:** Sonnet (`claude-sonnet-4-6`).
- **No tools / single turn.** The rendered prompt is the entire input; the reply
  must be the JSON verdict object and nothing else.
- **Blind.** Do not tell the agent which model wrote the answer (avoids
  self-preference bias). Never reveal the expected verdict.
- Run tasks concurrently for throughput; verdicts are independent.

The agent returns `{"verdict": "...", "rationale": "..."}`. Parse it with the
SAME tolerant parser the bench uses (`parseVerdictPayload` in
`src/judge/llm-judge.ts`) so a fenced or prose-wrapped object still maps to a
verdict; if it cannot be parsed, record `UNJUDGED` with a reason rather than
guessing.

> Determinism note: the agent path has no `temperature=0` lever, so judging is
> not bit-stable. That is expected and handled downstream — `measure-consistency`
> quantifies judge variance, the gate compares confidence intervals (not point
> estimates), and `validate-judge` gates the judge's agreement (Cohen's κ) with a
> human-labeled gold set before its verdicts may certify a run.

## 4. Write `verdicts.json`

```jsonc
{
  "fixture_id": "<copy from tasks file>",
  "run_id": "<copy from tasks file>",
  "schema_version": 1,
  "judge": {
    "kind": "claude-code-agent",
    "model": "claude-sonnet-4-6",
    "prompt_template_hash": "<copy from tasks file>",
    "judged_at": "<ISO-8601>"
  },
  "verdicts": [
    { "query_id": "q-0001", "verdict": "CORRECT", "rationale": "…", "unjudged_reason": null }
    // include baseline_-prefixed verdicts too, if the run had a baseline pass
  ]
}
```

- Keep the `baseline_` prefix on baseline verdicts — `score` splits the streams by it.
- `prompt_template_hash` MUST equal the one in `judge_tasks.json`. `score` warns
  on mismatch; the regression gate refuses to compare verdicts judged under a
  different prompt or a different model (the cross-judge guard).

## 5. Finalize

```
june-eval score <run-dir> --verdicts verdicts.json
```

Validates `verdicts.json`, overlays it onto the run's own per-query records,
recomputes correctness + bootstrap CIs, and rewrites `results.json` (now
`completed`) and `summary.md`. Then gate with `june-eval control-check <run-dir>`.
