<!-- author: Claude -->
# RSI-Foundation · Phase 2 — Measured noise floor

**Commits:** `31cadf0` → `9c0a777`  ·  **Branch:** `rsi-phase-2-noise-floor`

## Summary
Replaced the hand-typed `--noise-floor 0.05` guess (the audit's gap #2) with *measurement*.
Two new no-API commands — `measure-noise-floor` (retrieval determinism) and
`measure-consistency` (judge variance) — turn repeated runs into a measured per-fixture
`noise-floor.json`, and `control-pin` now consumes that file's `recommended_noise_floor`
instead of accepting a bare number. The determinism command **asserts** that retrieval is
bit-stable (≈0 spread) on a shared ingest and fails loudly otherwise, so a hidden
non-determinism bug (e.g. an unstable RRF tie-break — the Phase 6 target) surfaces as a hard
error rather than silently inflating the floor.

## High-level (plain English)
A regression gate is only as trustworthy as the noise floor it compares against. Phase 1 made
the gate statistically honest (CI-aware) but still fed it a number typed by hand. A wrong floor
compounds false accepts/rejects every RSI iteration, so Phase 2 measures it from two distinct
noise sources, kept separate because they have different causes:

- **Determinism** (`measure-noise-floor <run_dir...>`): re-run retrieval across ≥2 runs of one
  fixture — ideally sharing ONE ingest (`--skip-ingest`). recall@k/MRR are pure math now (no
  LLM in retrieval), so the spread across runs on a shared ingest *must* be ≈0. The command
  asserts that and exits 3 on any drift; a non-zero spread is a genuine bug, not noise. This is
  the proof the retrieval metrics can be gated tightly.
- **Consistency** (`measure-consistency <run_dir> <verdicts.json...>`): re-score one run under
  ≥2 *independent* agent re-judges of its tasks and report the `reader_correct_pct` spread. The
  judge (agents, no `temperature=0`) is the only non-deterministic stage left, so this is where
  the real floor comes from.

Both commands write/merge a single `noise-floor.json` (one block each); `recommended_noise_floor`
is the conservative max across whichever blocks are present. `control-pin` reads it
(`--noise-floor-file`, default the package-root file beside `golden.json`), cross-checks that it
was measured on *this* fixture, and requires a measured judge-consistency block (correct% is
gated, so its floor must be measured). The only way to pin without a measured file is a
deliberate `--accept-floor <n>`, which is logged as UNMEASURED. The bench itself never calls an
LLM or spawns an agent here — the live N-run / N-judge execution is the orchestrator's job
(local Qdrant + Ollama gemma + Sonnet agents); these commands are the pure-aggregation half.

## Steps performed
- **`src/lib/variance.ts`** (new): pure `computeVariance` (mean, sample n−1 stddev, min, max,
  `range`) + `maxRange`. `range` (max−min) is the load-bearing output — the conservative floor.
- **`src/types/noise-floor.ts`** (new): zod schema + types for `noise-floor.json` (a
  `determinism` block, a `consistency` block, `recommended_noise_floor`) and `recommendedFloor`.
- **`cli/measure.ts`** (new): `runMeasureNoiseFloor` + `runMeasureConsistency`. Read run-dirs /
  verdicts with `mapConcurrent`; reuse `perTierMetrics` (Phase 1) for snapshot extraction and
  `rescoreWithVerdicts` (Phase 0) to re-score under each re-judge; exported `gatherVariance`
  computes the per-tier/per-metric spread (tier measured only when present in *every* run;
  retrieval metrics skip T5). Determinism asserts ≈0 on a shared ingest (`IntegrityViolationError`,
  exit 3); fresh-ingest repeats are reported, not asserted. Read-modify-write preserves the
  sibling block.
- **`cli/control.ts`**: `control-pin` now resolves its floor via exported `resolveNoiseFloor` —
  `--accept-floor` (typed, flagged UNMEASURED) or a measured `noise-floor.json` matching the
  run's fixture with a consistency block. Replaced `--noise-floor`/`DEFAULT_NOISE_FLOOR` with
  `--noise-floor-file`/`--accept-floor` + `DEFAULT_NOISE_FLOOR_PATH` (shared with measure.ts).
- **`cli/bench.ts`**: registered `measure-noise-floor` / `measure-consistency`.
- **`src/lib/logger.ts`**: added the Phase 2 `BenchLogFields`.
- **`__test__/helpers.ts`**: extracted `writeTestConfig` (returns a config path) so CLI-runner
  tests stay hermetic against the gitignored `./config.yaml`.
- **Tests** (new): `__test__/lib/variance.test.ts` (edge cases) and `__test__/cli/measure.test.ts`
  (gatherVariance purity; the determinism assertion firing on a shared ingest; fresh-ingest
  reporting; fixture/ count guards; consistency spread + cross-judge/attribution guards; block
  merge; `resolveNoiseFloor` accept-floor/measured-file/missing/mismatch/no-consistency).
- Verified: `bun run typecheck` clean; full suite green (**147 pass, 1 pre-existing skip, 0 fail**;
  +26 from Phase 1's 122 → 147).

## Action items / next steps
- **Live execution (user):** with the local stack up, run `--mode control` twice against one
  ingest → `measure-noise-floor`; have the orchestrator's agents judge one run's tasks N times →
  `measure-consistency`; then `control-pin` the real golden off the measured floor. The Phase 1
  v2 golden still needs a (re-)pin from a real control run.
- **Phase 3 (next):** freeze fixtures as versioned immutable artifacts under `fixtures/<name>/`;
  make GT resolution deterministic; restore anti-collusion (distinct author models); fixture-load
  / fixture-hash / anti-leakage tests.
- The gate still applies one scalar floor to all gated metrics. The measured file already carries
  per-metric spreads (retrieval ≈0, judge nonzero); a future pass could gate retrieval metrics on
  their own near-zero floor (golden v3) for a tighter retrieval gate — deferred, not needed yet.
- Watch-out: `measure-noise-floor` on the *real* retriever is the probe that will expose the
  unstable RRF tie-break (audit gap #9 / Phase 6) — expect a determinism failure there until it's
  fixed, which is the command working as intended.
