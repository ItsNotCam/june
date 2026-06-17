---
title: "RSI-Foundation - bench audit"
type: reference
project: june
feature: rsi-bench-foundation
status: in-progress
created: 2026-06-17
tags: [plan, rsi-bench-foundation, mcp-bench]
summary: "Full eval-harness + corpus/retriever audit; rationale behind each phase."
---

<!-- author: Claude — full bench audit captured during RSI-foundation planning (2026-06-17).
A condensed 10-gap table lives in docs/rsi-foundation-plan.md; this is the full reasoning.
Line references are from the planning-phase code read — spot-verify an exact line before relying on it. -->

# Bench audit findings — is `@june/mcp-bench` trustworthy enough to be an RSI fitness function?

Two parallel audits against that single question. **Part 1** covers the eval harness itself
(scoring, judge, control/golden machinery, statistics, gameability). **Part 2** covers the
inputs (synthetic corpus generation, ground-truth resolution, the retriever, and drift vs the
production ingest retriever). Each ends with a ranked list of weaknesses.

> Note on dates: this audit predates Phase 0/1. Some specifics it flags are now FIXED —
> e.g. the gate ignoring CIs (Phase 1), no judge identity / cross-judge guard (Phase 1), the
> judge being in-process (Phase 0). It is preserved as the rationale for the whole plan; see
> `docs/rsi-foundation-status.md` for what's already done.

---

## Part 1 — Eval-harness validity audit

**Executive summary.** A carefully engineered gauge with real strengths (mode enforcement,
golden-pin gating, tier-dispatched scoring, bootstrap CIs) but multiple blind spots that made
it unsuitable as an RSI fitness function without mitigation: untested judge-agreement
validation, an operator-guessed noise floor, a point-estimate gate that ignored its own CIs,
and several unguarded Goodhart surfaces.

### 1. Scoring pipeline trace
Given a query: **Stage 6 retrieval** → `recall@{1,3,5,10}` + MRR, tier-dispatched (T1/T2 need
1 expected chunk; T3 any; T4/T6/T7 all; T5 has no recall). **Stage 7 reader** → top-5 chunks +
query → answer (chunks rendered `<chunk id="…">raw_content</chunk>`). **Stage 8 judge** →
verdict ∈ CORRECT|PARTIAL|INCORRECT|REFUSED|HALLUCINATED|UNJUDGED, grounded against retrieved
context. **Stage 9 scoring** → per-tier + overall aggregates with 95% bootstrap CI (1000
resamples; deterministic seed from run_id). Tier-dispatched correctness: T5 correct iff
REFUSED, T1–T4 correct iff CORRECT (`isVerdictCorrectForTier`, `src/types/verdict.ts`). Macro
(equal-weight across non-empty tiers) and micro (all queries) reported side by side.

### 2. The judge
Default judge was `deepseek-v4-pro` (sync), fallback Sonnet via Anthropic Batch. **Grounded**
(sees retrieved context, not closed-book) — `prompts/judge.md` says "judge grounding against
the retrieved context, not your own world knowledge." The **κ ≈ 0.894** agreement figure was a
one-time screen, NOT re-validated per run; the golden-set test (`grounding-golden.test.ts`) is
**opt-in only** (`RUN_LIVE_JUDGE=1`), not in CI. Failure modes not explicitly mitigated:
position bias, verbosity bias ("extra grounded detail is FINE" can over-reward length),
self-preference. Refusal detection is a brittle 17-pattern substring list in the prompt.

### 3. Control / golden / regression machinery
`control-pin` stored per-fixture golden keyed by `fixture_hash` (per-tier correct% + an
operator-supplied `noise_floor`, default 0.05). `control-check` compared **raw point-estimate
delta vs −noise_floor per tier** (`cli/control.ts:146-147`) — **the bootstrap CIs were
computed but never consulted by the gate.** No `--measure-noise-floor` automation despite the
docs telling you to "run control twice." **No cross-judge guard:** the golden stored no judge
identity, so a golden pinned with judge A could be checked against judge B silently. Only
`reader_correct_pct` was gated — recall@k/MRR were not.

### 4. Statistical rigor
Bootstrap CI implementation is sound (deterministic seeding, correct for proportions). But:
**no significance testing in the gate** (point estimates only); **no CI-overlap check**; no
multiple-comparison correction across tiers×metrics; bootstrap edge cases at small N untested;
macro CI is a heuristic average of per-tier CIs, not a resample — and is unvalidated. Sample
sizes T1:50 T2:50 T3:40 T4:40 T5:70 (=250). Determinism/consistency measurement is *described*
in CLAUDE.md but has **zero code/automation**.

### 5. Gameability / Goodhart surface
Guards present: `rank_constant` change flags runs incomparable (I-EVAL-3); judge temperature
locked to 0; macro+micro both shown. Unguarded: the refusal-marker substring list (adding a
marker flips INCORRECT→REFUSED with no retrieval/reading change); **no T5 refusal-rate sanity
check**; the judge prompt is prose (a leniency tweak shifts the verdict distribution invisibly
— no prompt hash); the verdict→correct mapping is one line; the anti-leakage threshold and
macro/micro choice are soft. CLAUDE.md is loud about Goodhart but only mode-enforcement and
rank_constant are *code*-enforced.

### 6. Test coverage of the gauge itself
Tested: bootstrap shape/determinism, verdict parsing, judge grounding (context reaches the
prompt), tier-dispatched scoring, recall computation, cost. **Untested:** continuous judge
agreement, noise-floor measurement, `control-check` regression logic, cross-judge rejection,
T5 refusal-rate sanity, macro-CI correctness, bootstrap small-N, judge-prompt stability.

### 7. Ranked validity gaps (pre-Phase-0/1)
- **CRITICAL 1.1** — no continuous judge-agreement validation (κ stale, opt-in). *(Phase 5)*
- **CRITICAL 1.2** — no cross-judge guard in `control-check`. *(FIXED — Phase 1)*
- **CRITICAL 1.3** — noise floor is an operator guess, not measured. *(Phase 2)*
- **CRITICAL 1.4** — T5 refusal calibration unchecked (gameable). *(Phase 5/6)*
- **HIGH 2.1** — macro CI not validated. **HIGH 2.2** — bootstrap edge cases untested.
  **HIGH 2.3** — no CI-overlap in regression detection *(FIXED — Phase 1)*. **HIGH 2.4** — no
  determinism/consistency automation *(Phase 2)*.
- **MEDIUM** — brittle refusal markers; judge prompt unversioned *(prompt hash added Phase 0)*;
  macro aggregation untested.

---

## Part 2 — Corpus generation, ground truth & retriever audit

### 1. Corpus generation trace
`generate` runs Stages 1–3 → fixture dir (`facts.json`, `corpus/`, `corpus_manifest.json`,
`queries.json`). **Stage 1 facts** are deterministic templates (no LLM). **Stage 2 corpus** is
**LLM-authored** (temperature 0, but NOT byte-deterministic) — validated by substring-matching
surface hints, retry ≤3. **Stage 3 queries** are **LLM-authored** per tier with an anti-leakage
Jaccard check (threshold 0.40, retry ≤3). Ground truth is **not** in the fixture — it's
resolved per-run at Stage 5 (facts→chunk_ids, chunk-level, depends on the ingest's chunking).

### 2. Query / difficulty taxonomy
Tiers: T1 lexical, T2 paraphrase, T3 conceptual, T4 2-hop, T5 negative (refusal), T6 3-hop,
T7 4-hop. Multi-hop ground truth = set of fact IDs; scoring is **per-chain binary** (all in
top-K = pass) with **no per-fact recall** — a failed T4 can't be attributed to the relational
vs atomic leg. T5 is overrepresented (~28%).

### 3. Realism & generalization (the L7 caveat)
100% fictional ("glorbulon-protocol": 10 protocols × 8 attributes, ports 7000–8000, relation
predicates). The "synthetic ≠ real-doc quality" caveat lives in CLAUDE.md, **not** prominently
in the README. Generalization gaps: tiny entity density (10 vs 100s–1000s real), LLM-generated
prose (no code/tables/markdown edge cases), narrow query vocabulary. **No real-document
holdout** — entirely synthetic. *(Phase 4 adds the holdout.)*

### 4. Determinism audit
RNG (Mulberry32, FNV-1a seeds, SHA-256 fixture IDs) is deterministic. **Non-determinism
leaks:** (a) corpus author LLM — same seed → different corpus on regeneration → ground truth
can diverge silently; (b) query author LLM — same; (c) **tier-2 embedding resolution is
unseeded** (Stage 5); (d) summarizer (ingest) LLM. The bench does not measure its own noise
floor. **Conclusion:** the LLM-authored inputs are not reproducible across regenerations — so
**freeze fixtures** (generate once, commit, never regenerate). *(Phase 3.)*

### 5. Retriever correctness
RRF fusion is 1-indexed and weight-symmetric (correct), but the **tie-break is unstable** — no
explicit secondary key (`reranker.ts` shows the right pattern; mirror it in both bench
`rrf.ts` and ingest `rrf.ts`). *(Phase 6.)* Multi-hop "anchored bridge injection" has a
parity invariant (2-hop == old injectAtomic) but the cited-chunk fallback and the
`windowK`-vs-reader-window assumption are untested. BM25 FNV-1a constants are load-bearing and
must match production byte-for-byte (pinned in a test).

### 6. Stopgap vs production drift
`stopgap.ts` talks to Qdrant directly because june exposes no retrieval API yet; `june-api.ts`
is a stub. **Divergences:** stopgap fetches `k*2`, filters by `ingested_by` (a bench multi-run
workaround); production filters by `is_latest=true` with `k*fetch_multiplier`. When june ships
an API, the bench must match production's `is_latest` semantics or metrics won't transfer.
*(Phase 6 adds a parity test.)*

### 7. Test coverage gaps
None for: corpus generation, query generation, ground-truth resolution, integrated
determinism/noise-floor, multi-hop fallback paths. Good for: fact gen, RRF tagging, recall
dispatch, RNG, BM25.

### 8. Ranked input-validity weaknesses
- **P0** — corpus non-determinism breaks ground-truth reproducibility. *(Phase 3 freeze.)*
- **P1** — tier-2 (embedding) ground truth non-deterministic. *(Phase 3: prefer substring / make deterministic.)*
- **P2** — query generation non-deterministic. *(Phase 3 freeze.)*
- **P3** — no per-fact multi-hop resolution. *(Phase 6.)*
- **P4** — stopgap `ingested_by` ≠ production `is_latest`. *(Phase 6 parity test.)*
- **P5** — RRF/reranker unstable tie-break. *(Phase 6.)*
- **P6** — multi-hop `windowK` unvalidated vs reader window.
- **P7** — no automated noise-floor/determinism test. *(Phase 2.)*
- **P8** — L7 caveat not prominent in README. *(Phase 7.)*
- **P9** — query-tier imbalance (28% negatives).
- **P10** — no holistic E2E integration test. *(Phase 7.)*

### Extra finding surfaced during planning (config drift)
`config.yaml` had `corpus_author` and `query_author` BOTH set to `anthropic/claude-sonnet-4-6`
— the config's own comment warns this erodes the L1 lexical-collusion defense (the roles are
meant to be different providers). Restore distinct author models at fixture-freeze time
(Phase 3).
