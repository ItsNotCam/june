<!-- author: Claude -->
# Judge calibration protocol (licensing the no-API judge)

The bench's correctness judge is an LLM run by **Claude Code's own agents** (no API
key) — see `JUDGE-RUNNER.md`. Phase 5 makes that judge *trustworthy*: an LLM judge
may only certify a `control` run once it has been shown to agree with **human
labels** beyond chance. The gate is **Cohen's κ ≥ 0.7** against a committed
human-labeled **gold set**; `control-pin` refuses to bless a golden produced by an
uncalibrated judge.

Why κ and not raw agreement: raw agreement is inflated when one verdict class
dominates (a judge that always says CORRECT looks ~85% "right" on a CORRECT-heavy
set). κ subtracts the agreement expected by chance, so it can't be gamed by guessing
the majority class. κ > 0.75 is excellent; 0.40–0.75 fair-to-good; < 0.40 unreliable.

```
june-eval validate-judge emit  [--gold <path>] [--out tasks.json]   # bench, NO API
   → judge_tasks.json (the gold cases, human labels stripped)

orchestrator (Claude Code)                                          # Sonnet agents, NO API key
   → judge each task per JUDGE-RUNNER.md (blind — must NOT see the gold label)
   → verdicts.json

june-eval validate-judge score <verdicts.json> [--min-kappa 0.7]    # bench, computes κ
   → judge-calibration.json  (record keyed by model + prompt hash; FAILS below threshold)

june-eval validate-judge status [--judge-model <m>]                 # is a judge licensed?
june-eval control-pin <run-dir>                                     # now requires a license
```

## 1. The gold set

`__test__/judge/fixtures/calibration-gold.json` — human-labeled
`(judge task, canonical verdict)` cases. Each case is **self-contained** (carries
its own `retrieved_context`), so it's judged by the exact same agent path as a real
run. Fields: the `JudgeTask` shape (`query_text`, `tier`, `expected_surface_hints`,
`retrieved_context`, `reader_answer`) plus `human_verdict` (the canonical label κ is
measured against) and `acceptable_verdicts` (verdicts a careful human would also
accept — the lenient-agreement diagnostic; genuinely ambiguous cases carry more than
one).

The shipped gold is **balanced** — 8 cases each across CORRECT / PARTIAL / INCORRECT
/ REFUSED / HALLUCINATED — so κ reflects agreement on every class, not just the easy
majority. **Grow it over time** with real, *harder* cases (the borderline ones where
careful humans might split); the current cases are deliberately unambiguous, so a
competent judge scores κ = 1.0. The gold's content is hashed into each calibration
record — **editing the gold invalidates every existing license** (re-validate).

## 2. Judge the gold (agents, BLIND)

`validate-judge emit` writes the tasks with the human labels **stripped**. Judge them
exactly as `JUDGE-RUNNER.md` prescribes — render `prompts/judge.md`, one constrained
Sonnet agent per task (or a small batch), blind to the expected verdict — and collect
`verdicts.json` (the same shape `score` ingests for a real run). Never let the judging
agent see `human_verdict`; that would make the calibration meaningless.

## 3. Score → license

`validate-judge score` pairs each agent verdict with its canonical human label,
computes **Cohen's κ** (plus raw + lenient agreement, per-class support, and a
confusion matrix of the disagreements), and writes a `CalibrationRecord` into
`judge-calibration.json` keyed by `${model}::${prompt_template_hash}`. It **exits
non-zero** when κ < `--min-kappa` (default 0.7) **or** any gold case was left
UNJUDGED — an uncalibrated or incomplete judge is not licensed.

## 4. The gate

`control-pin` calls `assertJudgeCalibrated`: the run's judge identity must have a
**passing** record measured against the **current** gold set, or the pin is refused
with the commands to fix it. This is what licenses the agent judge's verdicts to
define "expected results." (`control-check` inherits it transitively — the
cross-judge guard already forces a candidate to match the golden's calibrated judge.)

## Bias notes (from the dossier)

- **Self-preference:** judge = Claude (Sonnet), reader = local non-Claude (gemma) —
  different models, so the judge isn't grading its own outputs. Keep the judge blind
  to which model wrote the answer.
- **Verbosity / position / format:** the judge prompt explicitly tells the judge to
  ignore length, tone, ordering, and the trailing `Sources:` line. The gold set
  includes terse-correct and verbose-wrong cases so calibration would catch a judge
  that conflated fluency with correctness.
- Re-validate periodically — judges drift as models change, and the prompt hash in
  the key means a hardened judge prompt forces a fresh calibration.
