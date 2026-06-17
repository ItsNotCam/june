---
title: Multi-hop benchmark — T4 bridge-lookup fix + deep-hop (3/4-hop) foundation
type: engineering-log
feature: bench-multihop
sequence: 1
project: june
status: complete
tags: [eng-log, bench-multihop, area/research, tech/rag]
created: 2026-06-15
prev_commit: 6955bdf
new_commit: 8a36d89
summary: Certified the T4 2-hop fix (recall@5 92.5%→95%) and laid the 3-hop/4-hop (T6/T7) code foundation with an honest 3.3% baseline.
keywords: [multi-hop, bridge entity, recall@5, T4, T6, T7, 3-hop, 4-hop, retriever, gemma-certified, baseline]
---

# Multi-hop benchmark — T4 bridge-lookup fix + deep-hop (3/4-hop) foundation

This entry covers two related pieces of multi-hop work on the `@june/mcp-bench` RAG
benchmark. First, a certified fix to the existing 2-hop retriever: it now resolves the
bridge entity from the reader's whole top-5 window instead of an arbitrary top-3, lifting
T4 recall@5 from 92.5% to 95% with zero regression (gemma-certified at 95/95). Second, the
complete code foundation for two new question types — **3-hop (T6)** and **4-hop (T7)** —
validated end to end by generating a dedicated deep-hop test fixture. The current system
scores **3.3%** on the new 3-hop questions, which is the honest "before" baseline; making
those questions actually work is the next phase (the retriever still only resolves one
hidden step). Nothing about the deeper retriever logic ships in this commit — this is the
scaffolding and the measured starting line.

**Commits:** `6955bdf` → `8a36d89`   ·   2026-06-15

## What happened (high level)

The benchmark grades how well our search system answers questions, including **multi-step**
questions where the question hides the things you have to look up ("what's the packet size
of the layer that X wraps?"). Until now it only had two-step questions (tier T4).

Two things landed:

- **The two-step fix.** When answering a two-step question, the system first has to identify
  the hidden middle thing. It was only reading the top 3 documents to do that — but the
  document naming that middle thing sometimes ranks 4th, just out of view, so the system
  guessed wrong. Now it reads the top 5 (the same set the answer-writer sees). One question
  flipped from wrong to right; everything else held. The reference model confirmed it.

- **The three/four-step foundation.** I taught the benchmark about 3-hop and 4-hop questions:
  the scoring, config, reports, and a generator that walks a chain of facts and writes a
  natural question naming only the starting point. A nice surprise — I'd planned to also
  rewrite fact generation to guarantee these chains exist, but checked first and found 140
  three-step chains already present, so I dropped that work.

- **The honest baseline.** I built a fresh test set with 30 three-step questions and ran it.
  Score: **1 of 30 (3%)** — exactly as expected, because the search logic still only resolves
  one hidden step. The two-step control questions on the same set still scored 87%, proving
  nothing broke.

One detour worth recording: building the test set kept stalling because the step that writes
little document summaries used a big slow model that timed out. The two hosted alternatives
errored outright. The fix was to point that step at a small fast local model via a throwaway
ingest-config override; it then flew through.

## Steps performed

1. **T4 retriever fix** (`src/retriever/multi-hop.ts`): changed bridge resolution to read
   `base.slice(0, windowK)` instead of a hardcoded top-3. Added `scripts/triage-t4.ts`, a
   two-level diagnostic (which expected chunk is missing → why → which lever fixes it).
   Verified with a flash A/B on a frozen ingest (recall is reader-independent) and a gemma
   control run; logged the flash-vs-gemma result in `transfer-log.md`; pinned `golden.json`.
2. **Tier plumbing**: added `T6`/`T7` to `QueryTier` + `QUERY_TIERS` and a new
   `isMultiHopTier()` helper that drives the recall/MRR dispatch in `src/stages/06-retrieval.ts`
   (so no multi-hop branch can be missed). Config counts added as `.default(0)` (non-breaking
   for existing configs); `macroOverall` in `src/stages/09-score.ts` now skips zero-query tiers;
   `cli/run.ts` stub updated; `config.example.yaml` documents the new counts.
3. **Deep-chain generation** (`src/stages/03-queries.ts`, `src/schemas/queries.ts`): left the
   T4 path untouched and added `buildDeepChains` (graph-walk harvesting distinct `A→B→C[→D]`
   paths), `buildDeepTier` (N-fact query generation with set-matched fact ids and N-hint
   anti-leakage), one reused `QueryAuthorDeepChainOutputSchema`, and `prompts/query-t6.md`.
4. **Probe**: confirmed the existing domain already yields 140 distinct 3-hop and 435 distinct
   4-hop chains — so the planned Stage-1/domain chain-planting was cut.
5. **Tests**: added a `buildDeepChains` unit suite and T6/T7 scoring-dispatch cases. Full
   suite green (96 tests), `tsc --noEmit` clean.
6. **Fixture + baseline**: generated deep-hop fixture `TBEAJBN93M2NAF1SX31JTE0ED7` (seed 70413)
   and ingested it (run `20260615225102-J5S7SPQA`, reusable for the next phase). Recorded T6
   recall@5 = 3.3%, T4 control = 86.7%.

> Note: the deep-hop ingest used a throwaway `--ingest-config` override selecting a small fast
> local summarizer model, because the default summarizer timed out and the two hosted
> summarizer backends in the ingest package errored. That override is not committed (it is a
> local run artifact); the choice is held constant for this fixture so the next phase's
> comparison stays valid.

## Action items / next steps

- **Phase 1 (the real lift):** generalize `multi-hop.ts` from one bridge to a *sequential*
  bridge walk — resolve each next entity from the prior sub-query's retrieval and inject each
  hop's chunk — honoring the **N=2 parity invariant** (the reserve must exclude the first
  relational chunk so 2-hop behavior stays byte-identical and the pinned T4 golden survives).
  Teach `prompts/decompose-query.md` the 3+ hop chain; bump the decompose schema max 3→4.
  Re-measure T6 recall@5 on flash (reuse ingest `20260615225102-J5S7SPQA`).
- **No-regression gate:** after any `multi-hop.ts` change, `control-check` the *current*
  fixture against its pinned golden — the 2-hop path must stay flat.
- **Generalize `scripts/triage-t4.ts`** to N gold chunks so it diagnoses T6/T7, not just T4.
- **Phase 2:** extend `prompts/reader.md` to state a chain of relationships and generalize the
  `prompts/judge.md` "one of two hops" wording; gemma-certify T6 correct% and pin a separate
  deep-hop golden.
- **Phase 3:** add 4-hop (T7) — `buildFactChains4`/`buildT7`/`prompts/query-t7.md`; solve the
  k=5 window pressure via injection (4 gold + 1), not a global window bump.
- **Ingest summarizer:** the hosted (deepseek/anthropic) summarizer backends in the ingest
  package fail immediately — worth a separate investigation so deep-hop ingests don't depend on
  a local-model workaround.
- **Working tree:** ~96 pre-existing modified files (not from this session) remain uncommitted,
  plus a README authorship-stats change a commit hook produced — left untouched here.
