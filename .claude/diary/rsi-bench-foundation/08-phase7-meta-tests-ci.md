# Phase 7 — meta-tests, CI, the RSI-readiness contract (FOUNDATION COMPLETE)

**Commits:** `6bda6d8` → `c673b68` (feat) → `<docs>` (docs)   ·   2026-06-17

The final phase. The gauge now defends itself on every change, and every guarantee it makes
is written down. This closes the RSI-foundation initiative (Phases 0–7): the bench is a
trustworthy fitness function, ready for a future optimizer to stand on.

## What landed

### Hermetic end-to-end test
`__test__/e2e/pipeline.e2e.test.ts` + committed `__test__/e2e/fixtures/` (`e2e-mini-v1`:
facts / queries / ground-truth / chunks / retriever-output / reader / verdicts). It wires the
**whole no-API pipeline** exactly as `run --judge external` + `score` wire it —
`runStage6` (retrieval scoring) → `buildJudgeTasks` (emit self-contained judge_tasks.json) →
`runStage9` (partial, awaiting_verdicts) → the real `runScore` CLI overlaying the committed
`verdicts.json` → finalized `results.json` — but with the two live deps replaced by hermetic
stand-ins: a **deterministic fake `Retriever`** (pure lookup, no Qdrant) and a tiny **seeded
`june.db`** for the judge-task context renderer. Canned reader answers stand in for the live
gemma SUT (the e2e grades the *scaffold*, not the reader).

Five assertions cover the end-to-end invariants: Stage-6 retrieval scored correctly per tier;
`judge_tasks.json` self-contained (context pre-rendered, prompt hash stamped, no DB needed
downstream); the partial run honest (retrieval final, correctness pending, unjudged 100%); the
verdict overlay materializes correctness without perturbing retrieval and records the
cross-judge identity; and **two independent runs yield a byte-identical metric tree**
(determinism). The whole chain runs with no API key and touches zero provider code — the
**no-API guarantee proven by construction**, not merely asserted.

### API-free CI hot path
`.github/workflows/bench-ci.yml` runs on every push/PR touching bench/ingest/shared:
typecheck (shared + ingest + bench) → bench `bun test` (unit + RRF property/parity + the
hermetic e2e + the **agent-free κ calibration gate**: `calibration-gold.test.ts` re-scores the
committed Sonnet verdicts to a PASSING κ with no agent) → ingest `bun test`. No
ANTHROPIC/DEEPSEEK key, no OLLAMA_URL — if a test reached for a provider SDK or the network it
would fail, which is the point. Live `control` + holdout (which need the BYO gemma + Qdrant
stack) are kept off the hot path, run periodically by the user.

### The RSI-readiness contract
`docs/rsi-readiness-contract.md` — the capstone. Enumerates all eight guarantees (G1 no-API
eval · G2 deterministic ingest/retrieval incl. the RRF tie-break · G3 frozen, hash-locked,
anti-collusion fixtures · G4 statistical regression gate · G5 sealed real-doc holdout · G6
κ-licensed judge · G7 BYO-local reader · G8 hermetic CI), the concrete seam each rests on, and
how CI verifies it. Then the honest limits (L7 synthetic≠real comprehension — the load-bearing
caveat; single judge / no ensemble; two live-only metamorphic invariances; floor not yet pinned
from a real control run) and the **contract the future optimizer operates within** (may not edit
the gauge to move the number; proposes product changes the gauge certifies; reader stays the
SUT and judging stays API-free; every guarantee has a CI test). README L7 caveat surfaced + a
new RSI-readiness section linking the contract and CI.

## Steps performed
1. Read the status doc + plan Phase 7 + the reuse surface (`cli/run.ts` external fork,
   `cli/score.ts`, `src/retriever/types.ts`, `__test__/helpers.ts`, the 08/09 stage tests) to
   mirror production wiring exactly rather than re-implement it.
2. Authored the committed `e2e-mini-v1` fixture (3 fictional facts/chunks, T1/T3/T5 queries, a
   deterministic retriever ranking, canned reader answers, recorded agent verdicts).
3. Added the gitignore un-ignore for `__test__/e2e/fixtures/` (the broad `fixtures/` rule
   swallows it, same as the Phase-5 judge fixtures).
4. Wrote the e2e test driving the real stage functions + `runScore` over the fake retriever.
5. Wrote `.github/workflows/bench-ci.yml`; verified `bun.lock` exists and the `--filter`
   typecheck invocations resolve.
6. Wrote `docs/rsi-readiness-contract.md`; added the README RSI-readiness + L7 section.
7. Verified: workspace `tsc` clean; bench `bun test` = **253 pass / 1 skip / 0 fail** (e2e 5/5);
   ingest 150 pass. Committed feat (`c673b68`), then docs.
8. Updated the status doc (Phase 7 ✅, foundation complete), wrote this diary entry + the
   Obsidian eng-log (sequence 8).

## Action items / next steps
- **Live-only (user's gemma + Qdrant stack):** the Phase-4 holdout run (`run-holdout
  fixtures/holdout-real --mode control` → agents judge → `score-holdout`); the **first real
  `control` golden pin** (now fully unblocked — needs a licensed judge, which Sonnet is); a
  post-tie-break `measure-noise-floor` pass (should read ≈0 drift); the paraphrase +
  irrelevant-doc metamorphic invariances.
- **Future:** the RSI optimizer itself (out of scope for the foundation) — built within the
  contract's invariants.
