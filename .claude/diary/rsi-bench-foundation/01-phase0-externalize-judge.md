<!-- author: Claude -->
# RSI-Foundation · Phase 0 — Externalize the judge (no-API measurement instrument)

**Commits:** `664da18` → `a02eb9f`  ·  **Branch:** `rsi-bench-foundation`

## Summary
Re-architected `@june/mcp-bench` so it makes **no LLM API calls**: the bench runs retrieval
and the reader locally, emits a self-contained `judge_tasks.json`, and halts; the Claude Code
RSI orchestrator's Sonnet agents judge those tasks out-of-process and write `verdicts.json`;
`june-eval score` overlays the verdicts and finalizes the run. This is Phase 0 of the
foundation plan — make the eval a trustworthy fitness function before any self-improvement
loop is built.

## High-level (plain English)
The bench used to call an LLM judge in-process (deepseek/Sonnet via API). We split that in
two. The bench is now a deterministic *measurement instrument*: it produces the raw results
(retrieved chunks, recall@k/MRR which need no LLM, and the reader's answers) and a list of
"judge tasks." The *judging* — deciding whether each answer is correct — is done by the
Claude Code instance that drives the RSI loop, using its own Sonnet sub-agents (no API key,
billed to the Claude Code subscription, observable as agent runs). The bench then ingests the
agents' verdicts to compute correctness and confidence intervals. A `--mode control` run is
now fully local and zero-API. Crucially, a test proves the externalized scoring path produces
**numerically identical** results (point estimates and bootstrap CIs) to the old in-bench
path — we changed the transport, not the measurement.

## Steps performed
- Added `src/types/judge-tasks.ts` (`JudgeTask`, `JudgeTasksFile`, `VerdictsFile`,
  `JudgeProvenance`) and a `VerdictsFileSchema` in `src/schemas/verdict.ts` to validate
  agent-produced verdicts.
- Promoted the existing `buildRequests` into an exported `buildJudgeTasks` in
  `src/stages/08-judge.ts` that writes `judge_tasks.json` with the retrieved context
  pre-rendered and the judge prompt's SHA-256 stamped in (`promptTemplateHash` added to
  `src/lib/prompts.ts`).
- Added the `external` judge mode to `cli/run.ts` (now the default): after the reader stage it
  emits tasks, writes a partial `results.json` with `run_status: "awaiting_verdicts"` (every
  query UNJUDGED, retrieval metrics final), and halts. Generalized the manifest's judge
  identity (`provider` + `model` + `prompt_template_hash`).
- Added `cli/score.ts` (`june-eval score <run-dir> --verdicts <file>`) using a new
  `rescoreWithVerdicts` in `src/stages/09-score.ts`; registered it in `cli/bench.ts`.
- Added `awaiting_verdicts` to `RunStatus`; added `external` to the judge provider enum
  (`src/schemas/config.ts`, default `external`) and made it cost-free in `src/lib/cost.ts`;
  extended `src/lib/logger.ts` field vocabulary.
- Hardened `prompts/judge.md` (anti-bias guardrails, ordered decision procedure, strict
  JSON-only output) — same template vars + output contract, so the in-bench judge still works.
- Wrote `JUDGE-RUNNER.md` (the orchestrator protocol) and updated `README.md`.
- Tests: `__test__/stages/08-judge-tasks.test.ts` (task emission shape) and
  `__test__/stages/09-rescore.test.ts` (external == in-bench equivalence, point + CI).
- Verified: `bun run typecheck` clean; full suite green; CLI smoke (`score` registered, help
  renders, `run --help` shows `external` default).

## Action items / next steps
- **Phase 1 (done next):** make the regression gate statistically sound and add the
  cross-judge guard keyed on the judge identity recorded here.
- A live end-to-end no-API proof (`--mode control --judge external` with no API keys, then
  agent judging, then `score`) needs the local stack (Qdrant + Ollama gemma + `june ingest`)
  — to be run by the operator.
- The in-bench judge remains selectable (`--judge-provider deepseek|anthropic-batch`) but is
  no longer the default.
