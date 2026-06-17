<!-- author: Claude -->
# RSI-Foundation — status & handoff (START HERE)

**Branch:** `rsi-bench-foundation`  ·  **Base:** `664da18`  ·  **Tip:** `4ac80ea`

## TL;DR
We are hardening **`@june/mcp-bench`** into a trustworthy *fitness function* **before**
building any RSI (self-improvement) loop — because in every RSI framework the evaluator
*is* the optimization pressure, and a flawed evaluator gets reliably gamed (Goodhart /
specification gaming). Scope is **foundation only** (make the gauge trustworthy; do NOT
build the optimizer). A hard constraint: **the bench makes no LLM API calls** — it emits
judge *tasks*, a Claude Code orchestrator's **Sonnet agents** judge out-of-process, and the
bench scores the returned verdicts.

**Full context lives in this `docs/` folder — read these to make the right Phase 2–7 calls:**
- [`rsi-foundation-plan.md`](./rsi-foundation-plan.md) — the approved plan (8-phase roadmap,
  critical files, verification, decisions).
- [`rsi-research-dossier.md`](./rsi-research-dossier.md) — **the deep research that backs every
  design choice**: RSI best practices (the evaluator IS the optimization pressure; Goodhart /
  specification gaming), automated-testing methodology (golden/metamorphic/property tests,
  statistical testing of non-deterministic systems), LLM-as-judge reliability (bias, Cohen's κ,
  calibration), RAG-eval metrics (recall@k/MRR/nDCG, faithfulness, RAGAS/ARES/BEIR), and a
  **Top-15 cross-cutting recommendations** list — all with cited sources/URLs.
- [`bench-audit-findings.md`](./bench-audit-findings.md) — the full audit (eval-harness validity
  + corpus/retriever), the reasoning behind each phase.
- [`../JUDGE-RUNNER.md`](../JUDGE-RUNNER.md) — the orchestrator judging protocol.
- [`../CLAUDE.md`](../CLAUDE.md) — reader-by-purpose discipline + Goodhart warnings.

Per-phase history with commit hashes:
[`.claude/diary/rsi-bench-foundation/`](../../../.claude/diary/rsi-bench-foundation/).

## Status

| Phase | What | State | Commit |
|---|---|---|---|
| 0 | Externalize the judge (no-API seam) | ✅ done, tested | `664da18`→`a02eb9f` |
| 1 | Statistically-sound gate | ✅ done, tested | `a02eb9f`→`4ac80ea` |
| 2 | Measured noise floor | ⬜ **NEXT** | |
| 3 | Freeze fixtures | ⬜ | |
| 4 | Real-doc holdout (**needs your docs**) | ⬜ | |
| 5 | Judge calibration gate (Cohen's κ) | ⬜ | |
| 6 | Property/metamorphic tests + retriever fixes | ⬜ | |
| 7 | Meta-tests, CI, docs | ⬜ | |

**Health:** `tsc --noEmit` clean; **122 tests, 0 fail** (1 pre-existing live-judge skip).

## What's landed

**Phase 0 — externalized judge (no API).** `run` (default `--judge external`) does
ingest → resolve → retrieval scoring (deterministic recall@k/MRR, no LLM) → reader, then
emits a self-contained `judge_tasks.json` and halts at `run_status: "awaiting_verdicts"`.
The orchestrator's Sonnet agents judge each task (context pre-rendered, so no DB access
needed) → `verdicts.json`; **`june-eval score <run-dir> --verdicts <file>`** overlays them
and finalizes `results.json` + `summary.md`. Hardened `prompts/judge.md`; judge identity
(model + prompt hash) recorded in the manifest; in-bench judge kept selectable via
`--judge-provider`. Proven (test) numerically identical to the old in-bench scoring path.

**Phase 1 — statistical gate.** `control-check` now consults the bootstrap CIs the bench
already computes: a metric regresses only when its point drops **past the noise floor AND**
its 95% CI doesn't overlap the golden's. Gates **recall@1/@5 + MRR** (the deterministic
retrieval signal) alongside `reader_correct_pct`. Added the **cross-judge guard** (refuses a
candidate judged by a different model/prompt) and a `completed`-status guard. Golden bumped
to schema v2 (legacy v1 entries skipped with a warning → re-pin). First unit tests for the
gate logic (`detectRegressions` / `judgeMismatch` / `perTierMetrics`).

## Next: Phase 2 — measured noise floor
- New `cli/measure.ts` → `june-eval measure-noise-floor` + `measure-consistency`.
  - *Determinism:* re-run retrieval/scoring N times against one frozen fixture + one ingest;
    report per-tier/per-metric variance for recall@k/MRR. These are now LLM-free, so variance
    should be ≈0 — assert it.
  - *Consistency:* re-judge N times via agents; report verdict/correct% variance.
  - Fan out with `mapConcurrent` (`src/lib/concurrency.ts`); emit `noise-floor.json`.
- `control-pin` should consume a measured `noise-floor.json` instead of the typed
  `--noise-floor` flag (or require `--accept-floor` to override).
- **The command + variance math + unit tests are buildable now**; the real N-run *execution*
  (to produce an actual floor) needs the live stack (Qdrant + Ollama gemma + `june ingest`).

## Decisions locked (from the user)
1. **Foundation only** — design the loop's seams, don't build the optimizer.
2. **Freeze fixtures** — commit corpus + queries as versioned immutable artifacts (Phase 3).
3. **Real-doc holdout: yes, small** — sealed, never gated/tuned (Phase 4; needs real docs).
4. **Externalized judge, Sonnet agents, no API** — keep a single hardened judge; cross-judge
   guard + κ calibration gate (Phase 5).

## Environment / how to run (terminal Claude Code in WSL)
- You are now **in WSL natively** — run bash normally. (Any "run via a script file to dodge
  PowerShell/wsl quoting" notes from the prior session were a *Windows-desktop-app* artifact;
  ignore them here.)
- **bun**: if `bun` isn't found, `export PATH="$HOME/.bun/bin:$PATH"` (it lives at
  `/home/cam/.bun/bin/bun`; the login shell doesn't always source it).
- Typecheck + tests:
  ```bash
  cd packages/mcp/bench && bun run typecheck && bun test
  ```
- **`config.yaml` is gitignored** — the judge default (`external`) is enforced in
  `src/schemas/config.ts` (schema default), not the committed config.
- Commit per phase on this branch with a conventional prefix, e.g. `(feat) …`. No
  `Co-authored-by` trailers (per `CLAUDE.md`). The repo mandates a diary entry under
  `.claude/diary/<feature>/NN-slug.md` after each verified+committed phase.

## Key files touched (Phases 0–1)
- **New:** `cli/score.ts`, `cli/control.ts` (rewritten), `src/types/judge-tasks.ts`,
  `JUDGE-RUNNER.md`, `__test__/stages/08-judge-tasks.test.ts`,
  `__test__/stages/09-rescore.test.ts`, `__test__/cli/control.test.ts`.
- **Changed:** `cli/run.ts` (external fork + judge identity in manifest),
  `src/stages/08-judge.ts` (`buildJudgeTasks`), `src/stages/09-score.ts`
  (`rescoreWithVerdicts`), `prompts/judge.md` (hardened), `src/schemas/config.ts` (+`external`),
  `src/schemas/verdict.ts` (`VerdictsFileSchema`), `src/types/results.ts` (+`awaiting_verdicts`,
  judge identity), `src/lib/prompts.ts` (`promptTemplateHash`), `src/lib/cost.ts`,
  `src/lib/logger.ts`, `cli/bench.ts` (register `score`), `config.yaml`, `README.md`.

## Open assumptions / watch-outs
- **Reader-exception:** the reader (system-under-test) stays **local/BYO**; only judge +
  validation use Sonnet. Flagged in the plan, never overridden — confirm if you want the
  reader on Sonnet too.
- The big `a02eb9f` commit also **snapshotted prior unrelated WIP** (the working tree wasn't
  clean at session start).
- Phase 5's `validate-judge` (κ vs a human-labeled gold set) is what licenses agent verdicts
  to certify a run; until then, agent judging is usable but uncalibrated.
