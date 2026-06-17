<!-- author: Claude -->
# RSI-Foundation · Phase 1 — Statistically-sound regression gate

**Commits:** `a02eb9f` → `4ac80ea`  ·  **Branch:** `rsi-bench-foundation`

## Summary
Reworked `control-pin` / `control-check` so the regression gate consults the bootstrap
confidence intervals the bench already computes instead of comparing raw point estimates,
gates the deterministic retrieval metrics (recall@1/@5, MRR) alongside `reader_correct_pct`,
and refuses to compare verdicts produced by a different judge (the cross-judge guard). These
are the changes that make the gauge safe to drive an automated loop: noise can no longer be
banked as a "win," and the loop is steered by the retrieval signal it actually optimizes.

## High-level (plain English)
The old gate failed a run if a tier's correct% dropped more than a hand-typed noise floor —
a raw subtraction that ignored the CIs sitting right next to it, so random run-to-run wobble
could trip it or mask a real regression. The new gate flags a metric only when **both** the
point estimate drops past the floor **and** the candidate's 95% CI is entirely below the
golden's (a statistically confident drop). It now watches recall@1, recall@5, and MRR (which
are deterministic — no LLM in retrieval) in addition to correct%, because an RSI loop targets
retrieval, not the noisier reader+judge proxy. The golden baseline now records *which judge*
produced its verdicts (model + judge-prompt hash); if a later run was judged differently,
`control-check` aborts rather than compare apples to oranges. It also refuses runs that aren't
`completed` (e.g. an `awaiting_verdicts` partial). The golden file format moved to v2; old v1
entries are skipped with a warning so you simply re-pin.

## Steps performed
- Rewrote `cli/control.ts`:
  - Golden schema v2: per-tier `{reader_correct_pct, recall_at_1, recall_at_5, mrr}` each with
    `{point, ci_low, ci_high}`, plus a `judge` identity block and `noise_floor`.
  - `detectRegressions(golden, candidate)` (pure, exported): regress iff `delta < -floor` AND
    `candidate.ci_high < golden.ci_low`; retrieval metrics skipped on T5 (no recall on negatives).
  - `judgeMismatch(...)` (pure, exported): cross-judge guard on model + prompt hash.
  - `perTierMetrics(...)` (pure, exported): snapshot extraction (tiers with queries only).
  - `assertCompleted(...)`: refuse non-`completed` runs.
  - Tolerant `loadRegistry` (safeParse per entry; legacy v1 skipped with a warning).
- Added `__test__/cli/control.test.ts` — first unit tests for the gate (CI-overlap behavior,
  floor behavior, retrieval-metric gating, T5 correctness-only, cross-judge guard, snapshot
  extraction).
- Verified: `bun run typecheck` clean; full suite green (122 tests, 0 fail).

## Action items / next steps
- **Phase 2 (next):** `cli/measure.ts` (`measure-noise-floor` / `measure-consistency`) and
  have `control-pin` consume a measured `noise-floor.json` instead of the typed flag. The
  single `noise_floor` is applied to all metrics for now; per-metric measured floors land in
  Phase 2 (retrieval metrics should get a near-zero floor since they're deterministic).
- A real golden must be (re-)pinned from a `--mode control` run once the live stack is
  available; the v2 schema means any pre-existing golden needs a re-pin.
