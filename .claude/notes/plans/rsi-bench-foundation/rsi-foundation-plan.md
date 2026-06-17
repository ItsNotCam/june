---
title: "RSI-Foundation - plan"
type: plan
project: june
feature: rsi-bench-foundation
status: in-progress
created: 2026-06-17
tags: [plan, rsi-bench-foundation, mcp-bench]
summary: "Approved 8-phase plan to harden the bench into a trustworthy RSI fitness function."
---

# Plan: Re-architect `@june/mcp-bench` into a no-API measurement instrument for an RSI loop

## Context

The goal is an **RSI (Recursive Self-Improvement) loop** that drives june's RAG retrieval quality
up automatically. The research is unambiguous on the precondition: in every RSI framework (STaR,
FunSearch, ADAS, DSPy/MIPRO, RLVR) **the evaluator *is* the optimization pressure** — a flawed
evaluator is *reliably* exploited (specification gaming / Goodhart). So the testing pipeline must
be hardened **before** any loop is built. Scope here is **foundation only** — make the gauge
trustworthy; do **not** build the optimizer.

A second, decisive constraint emerged from the user: **the bench must make no LLM API calls.**
Instead of the bench calling a judge model, the architecture splits:

> **The bench is a deterministic measurement instrument.** It ingests a frozen fixture, runs
> retrieval (local Qdrant — deterministic recall@k/MRR, no LLM) and the reader (local model),
> and **emits the raw results plus self-contained judge tasks.** It calls no judge.
> **The Claude Code instance running the RSI loop spawns its own Sonnet sub-agents to audit/judge**
> those tasks (Claude Code's own agent mechanism — no API keys), writes verdicts, and the bench
> ingests them to finalize scoring and run the regression gate.

This dissolves the API/determinism tension entirely: the deterministic half lives in the bench;
the judgment half is the orchestrator's agents. A `--mode control` bench run becomes **fully local
and zero-API** (local Qdrant + local gemma reader + pure-math scoring).

This plan is grounded in a full audit of `packages/mcp/bench` + the relevant half of
`packages/mcp/ingest` (load-bearing claims verified by direct reads) and an in-depth research
dossier on RSI + automated-testing + RAG-eval best practices (sources at end).

### Decisions locked (from the user)
1. **Foundation only** — harden + test the gauge; design the loop's seams but don't build the optimizer.
2. **Freeze fixtures** — commit corpus + queries (the LLM-authored, non-deterministic inputs) as
   versioned immutable artifacts; runs always evaluate the frozen set.
3. **Real-doc holdout: yes, small** — a sealed real-document + hand-labeled set the loop never sees.
4. **Externalized judge, Sonnet agents, no API** — the bench emits judge tasks; the Claude Code
   orchestrator's **Sonnet agents** do the judging and the RSI **validation** (adversarial audit +
   judge calibration). Keep the single-judge design but make it honest (cross-judge guard +
   κ-calibration gate). **Harden the judge prompt** since the agent runs it without `temperature=0`.

---

## The architecture (the heart of this change)

### Data-flow seam
```
june-eval run <fixture> --mode control --judge external          [bench — local, NO API]
  ├─ Stage 4  ingest        (june CLI → local Qdrant + SQLite)
  ├─ Stage 5  resolve GT     (facts→chunk_ids, deterministic substring)
  ├─ Stage 6  retrieval eval (recall@k, MRR — pure math, NO LLM)        ← deterministic signal
  ├─ Stage 7  reader         (local gemma → answers)
  ├─ Stage 8' EMIT judge_tasks.json   (NO judge LLM call)
  └─ Stage 9' write results.json  run_status="awaiting_verdicts"
            (retrieval metrics filled; verdict-derived metrics pending)
  ⟶ halts: "judge_tasks.json ready → judge, then `june-eval score`"

[orchestrator = the Claude Code instance running the RSI loop]   [agents — NO API key]
  reads judge_tasks.json → spawns Sonnet sub-agents (Agent tool), each runs the hardened
  prompt on one self-contained task → writes verdicts.json (+ provenance: model, prompt hash)

june-eval score <run-dir> --verdicts verdicts.json               [bench — pure math]
  └─ Stage 9 (full): run-dir artifacts + verdicts → results.json + summary.md  status="completed"

june-eval control-check <run-dir>                                [the gate — Phase 1]
```

### Two new artifacts (the contract)
- **`judge_tasks.json`** (`JudgeTasksFile`): `{ fixture_id, run_id, prompt_template_hash, tasks: JudgeTask[] }`.
  Each `JudgeTask` is the externalized `JudgeRequest` already built by
  [`buildRequests`](packages/mcp/bench/src/stages/08-judge.ts:199): `query_id, tier, query_text,
  expected_facts[{surface_hint}], reader_answer, retrieved_context` (**pre-rendered** via
  [`renderChunksById`](packages/mcp/bench/src/lib/sqlite.ts:52) so the agent needs no DB/Qdrant
  access), plus an `is_baseline` flag.
- **`verdicts.json`** (`VerdictsFile`): `{ fixture_id, run_id, judge: { kind:"claude-code-agent",
  model, prompt_template_hash, judged_at }, verdicts: VerdictRecord[] }`. `VerdictRecord` already
  exists ([types/judge.ts](packages/mcp/bench/src/types/judge.ts)). The `judge` provenance block is
  what the cross-judge guard keys on.

### Why this is a clean cut, not a rewrite
- `buildRequests` already produces exactly the task shape (with rendered context) — promote it to
  an exported `buildJudgeTasks` that writes the artifact.
- `runStage9` already consumes a verdict list (`args.judge.verdicts`) — the new `score` command
  feeds it verdicts from `verdicts.json` instead of from an in-bench judge.
- The in-bench LLM judge (`08-judge.ts`, `sync-llm-judge.ts`, providers) is **kept as an optional
  path** (`--judge-provider anthropic-batch|deepseek`) — reversible, already κ-validated, useful for
  fully-automated non-orchestrated runs. `external` becomes the **default** for `--mode` runs.

---

## Audit findings the foundation must fix (condensed, ranked)

| # | Gap | Evidence | Why it breaks an RSI loop |
|---|-----|----------|---------------------------|
| 1 | **Gate ignores its own statistics** — raw point-estimate vs typed threshold; bootstrap CIs computed but unused | [`cli/control.ts:146`](packages/mcp/bench/cli/control.ts:146) | Optimizer banks noise as wins; real regressions inside the CI pass |
| 2 | **Noise floor is a guess** (default `0.05`, hand-typed) | [`cli/control.ts:91`](packages/mcp/bench/cli/control.ts:91) | Wrong floor → false accept/reject compounds each iteration |
| 3 | **Gate watches only `reader_correct_pct`** — recall@k / MRR (the real retrieval signal, and now the only deterministic one) not gated | [`cli/control.ts:55`](packages/mcp/bench/cli/control.ts:55) | A retrieval loop steers by a downstream proxy |
| 4 | **No judge identity / cross-judge guard** — golden stores none; manifest hardcodes `judge.provider:"anthropic-batch"` | [`control.ts:19`](packages/mcp/bench/cli/control.ts:19), [`run.ts:1039`](packages/mcp/bench/cli/run.ts:1039) | Verdicts from different agents/prompts compared as equal |
| 5 | **Non-deterministic inputs** — corpus + queries LLM-generated; same seed → different fixture; tier-2 GT resolution unseeded | [`02-corpus.ts`](packages/mcp/bench/src/stages/02-corpus.ts), [`05-resolve.ts`](packages/mcp/bench/src/stages/05-resolve.ts) | Loop can't separate signal from input drift |
| 6 | **100% synthetic/fictional**; no real-doc holdout; caveat only in CLAUDE.md | [`domains/glorbulon-protocol.ts`](packages/mcp/bench/src/domains/glorbulon-protocol.ts) | Loop overfits the toy domain |
| 7 | **Anti-collusion weakened** — `corpus_author` & `query_author` both `anthropic/claude-sonnet-4-6` | [`config.yaml:13`](packages/mcp/bench/config.yaml:13) | Queries lexically echo corpus → inflated recall |
| 8 | **Validity-critical paths untested** — corpus/query gen, GT resolution, `control-check`, determinism | `__test__/` inventory | The gauge's own correctness is unverified |
| 9 | **RRF tie-break unstable** (no secondary key); `reranker.ts` has the right pattern | [`src/retriever/rrf.ts`](packages/mcp/bench/src/retriever/rrf.ts) | Rank churn injects noise into recall@1/MRR |
| 10 | **Multi-hop scored per-chain, not per-fact** | [`06-retrieval.ts`](packages/mcp/bench/src/stages/06-retrieval.ts) | Loop's failure feedback is blind |

**Research bar:** strict train/holdout split; **significance-based** acceptance (not point estimates);
deterministic/verifiable rewards (retrieval metrics — lean on them); judge calibration vs human labels
(Cohen's κ ≥ 0.7) + blinding (position/verbosity/self-preference); metamorphic/property invariants;
regression suite; hermeticity; real-doc holdout; human checkpoints; multi-metric monitoring.

---

## Roadmap

Each phase ends with `bun test` green, README updated, and an `engineering-log` entry (prev→new commit).
New CLI commands respect the mode/intent discipline (the PreToolUse hook blocking `run` without `--mode`).

### Phase 0 — Externalize the judge (the pivot)
- **New types** `src/types/judge-tasks.ts` (`JudgeTask`, `JudgeTasksFile`) + extend
  [`types/judge.ts`](packages/mcp/bench/src/types/judge.ts) with `VerdictsFile` (wrapping existing
  `VerdictRecord` + judge-provenance block).
- **Promote** `buildRequests` → exported `buildJudgeTasks(...)` (in `08-judge.ts` or a new
  `src/stages/08-judge-tasks.ts`) that writes `judge_tasks.json` with `prompt_template_hash`
  (`sha256Hex` of `prompts/judge.md`). Reuses [`renderChunksById`](packages/mcp/bench/src/lib/sqlite.ts:52).
- **`cli/run.ts`**: add `external` judge mode (default for `--mode` runs). When external: after
  Stage 7, emit `judge_tasks.json`, write `results.json` with retrieval metrics + `run_status:
  "awaiting_verdicts"`, print next steps, return (skip in-bench judge + final score). Fix the
  hardcoded `judge.provider` in `buildManifest` ([run.ts:1038](packages/mcp/bench/cli/run.ts:1038))
  to record real judge identity + `judge_prompt_hash`.
- **New `cli/score.ts`** → `june-eval score <run-dir> --verdicts <file>`: load run-dir + fixture
  artifacts + `verdicts.json`, adapt to the shape [`runStage9`](packages/mcp/bench/src/stages/09-score.ts:53)
  expects, write final `results.json` + `summary.md`, `run_status:"completed"`. Register a
  `case "score":` in the [`cli/bench.ts`](packages/mcp/bench/cli/bench.ts) switch.
- **`src/types/results.ts`**: add `run_status:"awaiting_verdicts"`; generalize `manifest.roles.judge`
  to `{ kind/provider:string; model:string; prompt_hash:string }`.
- **`src/schemas/config.ts`**: add `"external"` to `JudgeRoleSchema.provider`; external ignores temp.
- **Harden `prompts/judge.md`** (the user's ask) — robust, model-generic, JSON-only-output discipline,
  explicit edge-case handling, position/verbosity/self-preference guardrails. It is now the shipped
  contract; its hash travels in both artifacts.
- **Doc** `JUDGE-RUNNER.md` — the protocol the orchestrator follows (read tasks → spawn Sonnet agents
  → write `verdicts.json`). The automated loop that invokes it is out of scope; *this* session acts as
  the orchestrator for verification.
- **Tests:** task-emission shape (context pre-rendered, prompt hash stamped); `score` round-trips a
  fixture `verdicts.json` into correct results; `awaiting_verdicts` status path.

### Phase 1 — Statistically-sound gate (gaps 1, 3, 4)
- **`cli/control.ts`**: regression = point drop beyond floor **AND** candidate CI doesn't overlap
  golden CI (reuse [`bootstrap`/`computeBootstrapCi`](packages/mcp/bench/src/lib/bootstrap.ts)).
- Gate **recall@5/@1 + MRR** (deterministic) alongside correct%; extend `GoldenEntry` + `perTierCorrect`.
- **Cross-judge guard**: store judge identity (`model` + `prompt_hash` from `verdicts.json`/manifest) in
  `GoldenEntry`; `control-check` hard-fails on mismatch.
- **Tests:** first-ever `control-pin`/`control-check` unit tests (regression, CI-overlap, cross-judge, no-golden).

### Phase 2 — Measured noise floor (gap 2)
- **`cli/measure.ts`** → `measure-noise-floor` / `measure-consistency`: retrieval metrics are now
  fully deterministic in-bench (assert ≈0 variance); consistency = re-judge via agents N times,
  report verdict variance. Fan out with [`mapConcurrent`](packages/mcp/bench/src/lib/concurrency.ts).
- **`control-pin`** consumes a measured `noise-floor.json`; refuse a bare typed number (or `--accept-floor`).

### Phase 3 — Freeze fixtures (gaps 5, 7)
- Commit a canonical fixture dir (`facts.json` + `corpus/` + `corpus_manifest.json` + `queries.json`)
  under `fixtures/<name>/` with provenance (author models, prompt hashes, human sign-off); never regenerate.
- Make GT resolution deterministic: prefer tier-1 substring; make/keep tier-2 embedding deterministic or
  drop it (it's chunk-level + per-ingest by design, so only resolution determinism matters).
- Authorship moves to **orchestrator Sonnet/Opus agents** at freeze time (no API), distinct models per
  role to restore anti-collusion; strengthened anti-leakage Jaccard + human review.
- **Tests:** fixture-load determinism; fixture-hash stability; anti-leakage enforcement.

### Phase 4 — Real-doc holdout (gap 6)
- Sealed `fixtures/holdout-real/`: small real corpus + hand-labeled Q/A; `run --holdout`; reported
  separately; **never pinned/gated/tuned**. Synthetic↔holdout divergence is the reward-hacking alarm.
  🔹 **Needs the user to provide / point at real documents.**

### Phase 5 — Judge calibration gate (harden the single judge, agent-based)
- Committed gold set (extend [`__test__/judge/fixtures/grounding-cases.json`](packages/mcp/bench/__test__/judge/fixtures/grounding-cases.json))
  of human-labeled `(task, expected_verdict)`.
- **`validate-judge`**: orchestrator agents judge the gold set → bench computes **Cohen's κ** vs human
  labels; **fail if κ < 0.7**; precondition for `control`/pin. Replaces the stale opt-in `RUN_LIVE_JUDGE` claim.
- Bias controls: position-swap, verbosity probe; self-preference low (judge=Sonnet, reader=local non-Claude)
  but blind the judge to source. Prompt-hash drift detection (from Phase 0).

### Phase 6 — Metamorphic/property tests + retriever fixes (gaps 9, 10)
- Property/metamorphic tests (`fast-check` or table-driven): RRF determinism + stable tie-break;
  retrieval ≤ k, scores in range; **paraphrase invariance**; **irrelevant-doc invariance**. (All
  judge-independent — pure retrieval, fully in-bench testable.) Use the `writing-tests` skill checklist.
- Fix unstable RRF tie-break in [`src/retriever/rrf.ts`](packages/mcp/bench/src/retriever/rrf.ts)
  (explicit secondary key, mirror [`reranker.ts`](packages/mcp/bench/src/retriever/reranker.ts)); same
  fix in [`ingest/src/retriever/rrf.ts`](packages/mcp/ingest/src/retriever/rrf.ts).
- Per-fact multi-hop recall in [`06-retrieval.ts`](packages/mcp/bench/src/stages/06-retrieval.ts).
- Stopgap↔production parity test ([`stopgap.ts`](packages/mcp/bench/src/retriever/stopgap.ts) vs
  [`ingest/src/retriever/query.ts`](packages/mcp/ingest/src/retriever/query.ts)).

### Phase 7 — Meta-tests, CI, docs
- Hermetic e2e: tiny frozen fixture → ingest → resolve → retrieve → emit tasks → fixture verdicts →
  `score`, asserting invariants. CI runs unit + property + e2e + `validate-judge` (with recorded
  verdicts) on every change; periodic live `control` + holdout off the hot path.
- Docs: README L7 caveat; the **"RSI-readiness contract"** (every guarantee the gauge now makes) +
  the `JUDGE-RUNNER.md` protocol — the spec the future loop builds on.

---

## Critical files
**Edit:** `cli/run.ts` (external judge fork, manifest judge identity); `cli/control.ts` (significance +
retrieval metrics + cross-judge); `cli/bench.ts` (register `score`); `src/stages/08-judge.ts`
(promote `buildJudgeTasks`); `src/stages/09-score.ts` (accept external verdicts); `src/types/results.ts`
(+`awaiting_verdicts`, judge identity); `src/schemas/config.ts` (+`external`); `prompts/judge.md` (harden);
`src/retriever/rrf.ts` + `ingest/src/retriever/rrf.ts` (tie-break); `src/stages/06-retrieval.ts` (per-fact recall).
**Create:** `cli/score.ts`, `cli/measure.ts`, `cli/validate-judge.ts`; `src/types/judge-tasks.ts`;
`fixtures/<name>/` + `fixtures/holdout-real/`; `JUDGE-RUNNER.md`; tests under `__test__/`
(`cli/score`, `cli/control`, `cli/measure`, `judge/calibration`, `retriever/properties`, `stages/05-resolve`, `e2e`).
**Reuse:** `buildRequests`→`buildJudgeTasks`; `runStage9`; `renderChunksById`/`openJuneDatabase`;
`writeJsonAtomic`/`readJson`/`fileExists`/`sha256Hex`; `bootstrap`/`computeBootstrapCi`; `mapConcurrent`;
`isVerdictCorrectForTier`; `renderPrompt` + `prompts/judge.md`; `parseArgv`/`flagString`/`flagBool` (`cli/shared.ts`);
`VerdictRecord`/`JudgeRequest` types; the `cli/bench.ts` switch.

## Verification
- **Unit/property/e2e:** `bun test` green; property tests exercise RRF/invariants; `control-check`
  logic covered (regression, CI-overlap, cross-judge); `score` round-trips fixture verdicts.
- **No-API proof:** a `--mode control --judge external` run completes with **no `ANTHROPIC_API_KEY`/
  `DEEPSEEK_API_KEY` set** (local Qdrant + local gemma only); grep confirms no provider SDK client on
  that path. Bench emits `judge_tasks.json`; **this session's Sonnet agents** judge → `verdicts.json`;
  `score` finalizes `results.json`.
- **Determinism proof:** `measure-noise-floor <frozen-fixture>` twice → identical recall@k/MRR; frozen
  fixture loads bit-stable.
- **Gate proof:** synthetic regressed run → `control-check` exits non-zero with a CI-aware reason;
  in-noise change passes; cross-judge mismatch hard-fails.
- **Judge proof:** `validate-judge` reports κ vs the gold set and blocks control/pin below 0.7.

## Out of scope (next pass)
The optimizer / propose→evaluate→accept loop; a judge **ensemble** (single hardened judge for now);
moving the **reader** off its BYO-AI local path (control reader stays local gemma — the SUT being measured).

## Sources (research dossier)
RSI & gaming: STaR [2203.14465]; FunSearch (DeepMind 2023); ADAS [2408.08435]; MIPRO/DSPy [2406.11695];
Self-Refine [2303.17651]; RLVR/Tulu 3 [2411.15124]; Specification Gaming (DeepMind); Concrete Problems
in AI Safety [1606.06565]; Goodhart's Law in RL (ICLR 2024). Testing & eval: Adding Error Bars to Evals
[2411.00640]; Metamorphic Testing for ML [1907.09427]; property-based testing (Hypothesis); Self-Preference
Bias [2410.21819]; Judging the Judges [2406.07791]; RAGAS [2309.15217]; ARES [2311.09476]; BEIR [2104.08663];
"Can we Evaluate RAGs with Synthetic Data?" [2508.11758]; Google Testing Blog (flaky tests); Cohen's/Fleiss' κ.
