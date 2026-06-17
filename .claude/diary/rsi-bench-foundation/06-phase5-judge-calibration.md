<!-- author: Claude -->
# RSI-Foundation · Phase 5 — Judge calibration gate (Cohen's κ)

**Commits:** `f7aa199` → `d4f90f6`  ·  **Branch:** `rsi-phase-5-judge-calibration`

## Summary
Made the bench's LLM correctness judge **trustworthy** by gating it on agreement with HUMAN labels.
A judge identity (model + prompt hash) may now certify a `control` run only when it has a PASSING
**Cohen's κ ≥ 0.7** calibration against a committed human-labeled gold set; `control-pin` enforces
that precondition. The no-API seam mirrors the judge runner: `validate-judge emit` writes the gold
cases as a `judge_tasks.json`, agents judge them blind, and `validate-judge score` computes κ and
writes the licensing record. Shipped a balanced 40-case gold set (8 per verdict class) and the
recorded Sonnet-agent verdicts, which re-score to **κ = 1.000 (n=40)** — `claude-sonnet-4-6` is now
licensed. +23 tests (216 → 239, all green; tsc clean). Closes the audit's "harden the single judge"
item.

## High-level (plain English)
The bench grades reader answers with an LLM judge (run by Claude Code agents, no API key). But an LLM
judge is only believable if it agrees with what a careful human would say — otherwise the whole
"correct%" number is built on sand, and the future self-improvement loop would optimize against a
biased grader. Phase 5 proves the judge agrees with humans before its verdicts are allowed to count.

The metric is **Cohen's κ**, not raw agreement. Raw agreement is misleading: on a gold set that's
mostly CORRECT, a lazy judge that *always* says CORRECT looks ~85% right. κ subtracts the agreement
you'd expect from chance/guessing, so that same lazy judge scores ~0. A judge has to actually
distinguish the verdict classes to score well.

The flow is the same externalized, API-free shape as everything else:
1. **A committed gold set** — `(judge task, canonical human verdict)` cases. Each is self-contained
   (it carries its own retrieved context), so it's judged by the exact same agent path as a real run.
2. **`validate-judge emit`** writes those cases as a `judge_tasks.json` with the human labels
   **stripped** — the judging agents must be blind to the expected answer.
3. **Agents judge** them (per JUDGE-RUNNER.md) → `verdicts.json`.
4. **`validate-judge score`** pairs each agent verdict with its human label, computes κ + raw/lenient
   agreement + a confusion matrix, and writes a record keyed by `model::prompt_hash` into
   `judge-calibration.json`. It **fails** (exit 3) if κ < threshold or any case was left unjudged.
5. **`control-pin`** now calls `assertJudgeCalibrated` — it refuses to pin a golden unless the run's
   judge has a passing record against the *current* gold set. Editing the gold invalidates the
   license (a hash staleness check), so the gate can't go stale silently.

Building the gold set was itself a no-API, agent-driven job. I kept the 8 human-curated "grounding
cases" already in the repo (real glorbulon-domain answers from past runs) and had agents construct 32
more — one batch per verdict class, grounded in the frozen glorbulon-v1 corpus, each built so its
canonical verdict is unambiguous (a wrong-number answer for INCORRECT, a correct answer + a fabricated
RFC number for HALLUCINATED, a two-hop answer that names the intermediate entity but stops for
PARTIAL, a refusal-marker answer for REFUSED). Two independent verifier agents audited all 40 labels
(all agreed). Then four Sonnet judge agents graded the emitted tasks blind — and matched the gold on
every single one, so κ = 1.0. That's expected for a deliberately clear-cut gold; the gold should grow
with *harder*, genuinely-borderline cases over time, where κ < 1 becomes the informative signal.

## Steps performed
- **κ math** (`src/lib/kappa.ts`): `cohensKappa` (multi-class, handles the degenerate single-category
  and empty cases), `observedAgreement`, `confusionMatrix`. Unit-tested against known values
  (perfect → 1, chance → 0, anti-correlated → −1, a hand-computed 0.5238, majority-guessing → ~0).
- **Calibration scoring + gate** (`src/lib/calibration.ts`, `src/types/calibration.ts`):
  `scoreCalibration` (pure: gold + verdicts → record with κ, raw/lenient agreement, per-class support,
  confusion, pass/fail), gold loading + hashing, the registry read/write, and `calibrationStatus`
  (licensed / failed / stale / missing).
- **CLI** (`cli/validate-judge.ts`): `emit` / `score` / `status`, registered in `cli/bench.ts`;
  `JudgeCalibrationError` (exit 3) added to `errors.ts`.
- **The gate** (`cli/control.ts`): `assertJudgeCalibrated` in `control-pin` (paths flag-injectable for
  tests so the real `golden.json` is never touched).
- **The gold set**: kept 8 grounding cases + 32 agent-constructed (5 class-batched authoring agents) →
  `__test__/judge/fixtures/calibration-gold.json` (balanced 8-per-class), audited by 2 verifier
  agents. Emitted tasks, judged by 4 blind Sonnet agents → recorded
  `__test__/judge/fixtures/calibration-verdicts.json`; scored → `judge-calibration.json` (κ = 1.000,
  passed, claude-sonnet-4-6 licensed).
- **Tests (+23)**: κ math; scoring + licensing status (licensed/failed/stale/missing); emit/score
  round-trip with the throw-on-fail; the control-pin gate (rejects uncalibrated, before any golden
  write); and a CI test that re-scores the committed gold + verdicts agent-free. tsc clean, 239 green.
- **Docs**: `VALIDATE-JUDGE.md` (protocol), README (CLI + calibration section), status doc (Phase 5
  ✅, Next → Phase 6), this diary entry.

## Action items / next steps
- **Grow the gold set** with harder, genuinely-ambiguous cases (where careful humans split) so κ < 1
  becomes informative — and add terse-correct / verbose-wrong cases to keep the verbosity-bias guard
  honest. Each addition invalidates the current license → re-run `validate-judge`.
- **Re-validate when the judge prompt changes** — Phase 6 may harden `prompts/judge.md`; the prompt
  hash is part of the license key, so a changed prompt forces a fresh calibration (by design).
- **Phase 6 — property/metamorphic tests + the RRF tie-break fix** (judge-independent, pure
  retrieval). The Phase-2 `measure-noise-floor` determinism assertion is the probe built to expose
  the unstable tie-break.
- Live (user's stack): the first real `control` pin can now proceed — it requires a licensed judge,
  which `claude-sonnet-4-6` now is. The Phase-4 holdout live run is still pending.
