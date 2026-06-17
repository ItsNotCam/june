<!-- author: Claude -->
# The RSI-readiness contract

**What this is.** The RSI-foundation work (Phases 0–7) hardened `@june/mcp-bench` from a
useful-but-soft eval into a **trustworthy fitness function** — a gauge an automated
self-improvement loop can optimize *against* without the loop quietly gaming the gauge
instead of improving the product. This document is the **contract**: every guarantee the
gauge now makes, the concrete seam each rests on, and where it is enforced and verified. It
is the spec the future RSI optimizer builds on — and the list of invariants that optimizer
must never be allowed to dissolve.

**Why a contract at all.** In every RSI framework the evaluator *is* the optimization
pressure. A flawed evaluator does not merely mismeasure — it gets reliably *gamed*
(Goodhart's law / specification gaming): the loop finds the cheapest edit that moves the
number, and if the cheapest edit is "exploit a measurement weakness" rather than "retrieve
and comprehend better," that is what it will do. So before any optimizer exists, the gauge
must be able to state precisely what it guarantees and what it does not. That is this file.

**Scope.** Foundation only. Nothing here builds the propose→evaluate→accept loop; it
specifies the surface that loop will stand on.

---

## The guarantees

Each guarantee lists the **seam** it rests on (the code that makes it true), **where it is
enforced**, and **how CI verifies it** (the hot-path check that fails if the guarantee
breaks).

### G1 — The eval path makes no LLM API calls
The bench never calls a hosted model to grade itself. Retrieval scoring is pure arithmetic;
judging is **externalized** — `run --judge external` emits a self-contained
`judge_tasks.json` (every task carries pre-rendered context, so the judge needs no DB) and
halts at `awaiting_verdicts`; Claude Code's own agents grade out of process and write
`verdicts.json`; `june-eval score` overlays them. Fixture authoring, holdout labeling, and
judge calibration mirror the same emit→agents→ingest seam.
- **Seam:** `src/stages/08-judge.ts` (`buildJudgeTasks`), `cli/score.ts`, `JUDGE-RUNNER.md`.
- **Enforced:** `config.yaml` default `judge: external` (schema default in `src/schemas/config.ts`).
- **Verified:** the hermetic e2e (`__test__/e2e/pipeline.e2e.test.ts`) runs the entire
  chain with no API key and no provider client on the path — if any stage reached for a
  provider SDK or the network, CI would fail. No-API is *proven by construction*, not asserted.

### G2 — Ingest and retrieval are deterministic
The same inputs produce the same ranking, bit-for-bit. The one known nondeterminism — RRF
resolving equal-score chunks by Map/Qdrant arrival order — was fixed in Phase 6 with an
explicit total order `(score desc, chunk_id asc)` in **both** the bench's and june's RRF.
- **Seam:** `src/retriever/rrf.ts` + `packages/mcp/ingest/src/retriever/rrf.ts` (identical tie-break).
- **Verified:** the RRF property tests (total-order invariant over random inputs,
  determinism, k-cap/subset/no-dup, modality-swap) and a **cross-package parity test** that
  executes both RRF copies on shared inputs and asserts byte-equal output, so they can never
  drift; the e2e asserts the full metric tree is identical across two independent runs.
- **Live probe (off the hot path):** `measure-noise-floor` over two same-config runs must
  read ≈0 retrieval drift — the command built to expose exactly the tie-break bug G2 fixes.

### G3 — Fixtures are frozen, hash-locked, and authored without collusion
A fixture is an immutable, content-addressed artifact. `fixture.lock.json` records a
canonical hash + per-file SHA-256 + authoring provenance; a run refuses to start on a
tampered fixture. Fixtures are authored with **no API**, by agents, with **distinct models
per role** (sonnet corpus / opus queries) so the corpus and the questions cannot collude;
`freeze` refuses a same-author fixture unless explicitly overridden.
- **Seam:** `src/lib/fixture-lock.ts` (`assertFrozenFixtureIntact`), `src/lib/authoring.ts`,
  `cli/author.ts`, `AUTHORING.md`. Canonical fixture: `fixtures/glorbulon-v1/`.
- **Verified:** fixture-lock + authoring unit tests; `verify-fixture` re-checks on demand.

### G4 — Regression is decided by statistics, not a single number
A metric counts as regressed only when its point estimate drops **past a measured noise
floor AND** its 95% bootstrap CI does not overlap the golden's. The gate covers the
deterministic retrieval signal (recall@1/@5 + MRR) alongside reader correctness. A
**cross-judge guard** refuses to compare a candidate graded by a different judge
model/prompt, and the noise floor is **measured** (`measure-noise-floor` /
`measure-consistency`), not guessed — `control-pin` requires a measured floor or a deliberate
`--accept-floor`.
- **Seam:** `cli/control.ts` (`detectRegressions`, `judgeMismatch`, `perTierMetrics`),
  `src/lib/variance.ts`, `golden.json` (per-fixture, schema v2).
- **Verified:** the gate's unit tests (regression, CI-overlap, cross-judge mismatch, status guards).

### G5 — A sealed real-doc holdout flags reward-hacking the synthetic corpus
A small slice of **real** docs (committed `fixtures/holdout-real/` — 19 Next.js App Router
docs, 40 hand-labeled Q/A) is scored at the **document** level and is **structurally
incapable of becoming a golden**: a holdout run writes `holdout_results.json`
(`kind: "holdout"`), never `results.json`, and `control-pin`/`control-check` refuse a holdout
run-dir outright. Its job is to expose **synthetic↔holdout divergence** — a change that lifts
the fictional fixture but not real docs is overfit to the toy domain.
- **Seam:** `src/lib/holdout-{build,lock,score}.ts`, `cli/holdout.ts` (`assertNotHoldout`), `HOLDOUT.md`.
- **Verified:** holdout split/assemble/score/lock unit tests + the `assertNotHoldout` guard test.
- **Validity caveat (load-bearing):** the reader (gemma) and judge agents *know* real Next.js
  docs, so reader-correct% can leak from parametric memory. **Lead with retrieval metrics**
  (immune) and read the RAG−noRAG delta as the honest reader signal. The holdout is reported,
  never gated/tuned.

### G6 — The judge is licensed by Cohen's κ before it may certify
An agent judge may finalize a certifying `control` run only when its identity
(model + prompt hash) has a **passing κ ≥ 0.7** against a committed human-labeled gold set. κ
subtracts chance agreement, so a judge that always guesses the majority verdict scores ~0. A
changed gold set or judge prompt invalidates the license (staleness check).
- **Seam:** `src/lib/calibration.ts` + `src/lib/kappa.ts`, `cli/validate-judge.ts`,
  `control-pin`'s `assertJudgeCalibrated`, registry `judge-calibration.json`, `VALIDATE-JUDGE.md`.
- **Verified:** the calibration gate runs **agent-free in CI** — `__test__/judge/calibration-gold.test.ts`
  re-scores the committed Sonnet verdicts (`__test__/judge/fixtures/calibration-verdicts.json`)
  against the gold set (`calibration-gold.json`) and asserts a PASSING κ. `claude-sonnet-4-6`
  is currently licensed (κ = 1.000, n = 40).

### G7 — The reader (system under test) stays local / BYO
The thing being measured — the reader — is never silently swapped onto a hosted Claude model.
`control` forces `gemma4:26b` (local Ollama, the 24GB-VRAM BYO reference); only the *judge*
and *labeling/validation* roles use Claude Code agents. Moving the reader off its local path
requires explicit human confirmation.
- **Seam:** `src/lib/modes.ts` (mode forces the reader), `CLAUDE.md` reader-by-purpose, a
  PreToolUse hook blocking any `run` missing intent.

### G8 — Every change is gated by a hermetic, API-free CI hot path
Unit + property + the hermetic e2e + the agent-free κ gate run on every change to the bench,
ingest, or shared packages. The hot path needs no Qdrant, no Ollama, no june subprocess, and
no API key. Live `control` + holdout passes (which need the BYO gemma + Qdrant stack) are kept
**off** the hot path and run periodically by the user's stack.
- **Seam:** `.github/workflows/bench-ci.yml`; the e2e + calibration tests above.

---

## What the gauge does NOT yet guarantee (honest limits)

These are the open edges. The future RSI loop must treat them as known blind spots, not
silently rely on them.

- **L7 — synthetic ≠ real comprehension.** A green synthetic fixture is "no regression
  detected," never "the product is good." The fixture is fictional facts in a narrow question
  style; a higher score on it can mean a *worse* product (Goodhart). G5's holdout is the alarm,
  but it is small and (G5's caveat) parametric-memory-contaminated. **This is the load-bearing
  caveat:** never read a synthetic number as a real-doc quality claim.
- **Single judge, no ensemble.** One hardened, κ-licensed judge — not a panel. Self-preference
  and shared-blind-spot bias are mitigated (calibration + cross-judge guard) but not eliminated.
- **Two metamorphic retrieval invariances are still live-only.** Paraphrase-invariance and
  irrelevant-doc-invariance need real embeddings + Qdrant, so they are live-run checks, not
  committed unit tests. The committed property tests cover the pure fusion logic only.
- **The noise floor is measured but not yet pinned from a real `control` run.** The first real
  `control` golden pin (now unblocked — it requires a licensed judge, which Sonnet is) and a
  post-tie-break `measure-noise-floor` pass are pending on the user's stack.

---

## The contract for the future RSI loop

When the optimizer is built, it operates **within** these invariants:

1. **It may not edit the gauge to move the number.** Fixtures are frozen (G3), the holdout is
   sealed (G5), `rank_constant` changes mark runs incomparable, and tuning knobs to peak *this*
   corpus is the prototypical specification-gaming failure (`CLAUDE.md`, "studying to pass").
2. **It proposes product changes; the gauge certifies them.** Acceptance is a `control` run
   that clears the statistical gate (G4), graded by a licensed judge (G6), on a frozen fixture
   (G3) with a deterministic retriever (G2) — and cross-checked against the sealed holdout (G5)
   for synthetic↔real divergence.
3. **The reader stays the SUT (G7)** and judging stays API-free (G1). The loop may change
   retrieval/ingest/reader-prompt; it may not change *who grades* or *what it's graded on*
   without a human in the loop.
4. **Every guarantee above has a CI test (G8).** A change that weakens an invariant should fail
   the hot path before it can be accepted — that is the gauge defending itself.

If a future change cannot state which guarantee it preserves or why a relaxation is safe, it
does not belong on this surface.
