---
title: "Multi-hop benchmark — Phase 1: sequential N-bridge retriever walk"
type: engineering-log
feature: bench-multihop
sequence: 2
project: june
status: complete
tags: [eng-log, bench-multihop, area/research, tech/retrieval]
created: 2026-06-15
prev_commit: 3663444
new_commit: 257e92f
summary: Retriever now walks the full hidden chain link-by-link, lifting 3-hop recall@5 from 3.3% to 63.3% with a provable 2-hop no-op.
keywords: [multi-hop, chain walk, n-bridge, retriever, 3-hop, recall@5, T4, no-op, phase 1]
---

# Multi-hop benchmark — Phase 1: sequential N-bridge retriever walk

Phase 1 of the deep multi-hop plan: the retriever now walks a whole chain of
hidden steps instead of resolving just one. Previously a 3-step question scored
almost nothing because the search could only uncover the first hidden link; now
it follows the chain link by link, pulls each intermediate document into view,
and hands the reader the full set. On the dedicated 3-hop test set this lifted
retrieval from **3.3% to 63.3%** (recall@5), while the existing 2-hop questions
stayed exactly where they were (86.7%) — the change is provably a no-op for the
2-hop path, which protects the certified 2-hop baseline. The remaining 3-hop gap
is now cleanly diagnosed and is *not* in the new chain-walk machinery.

**Commits:** `3663444` → `257e92f`   ·   2026-06-15

## What happened (high level)

A multi-step question hides the things you must look up ("the max packet size of
the layer wrapped by the protocol that X authenticates via"). The old search
could uncover **one** hidden thing. A 3-step question hides two, so two of its
three needed documents never reached the reader and it scored ~3%.

The fix teaches the search to walk the chain:

- It breaks the question into an ordered list of steps.
- It finds the first hidden entity from the documents the original question
  already surfaced.
- For each next step it asks a fresh search using the entity it just found,
  reads *that* search's results to find the next entity, and **keeps the
  document that revealed it**.
- At the end it places every document it gathered along the chain — plus the one
  holding the final answer — into the reader's view, without bumping out the
  documents the original question already found well.

The single most important property: for a **2-step** question the new code does
exactly what the old code did, byte for byte (the "parity invariant"). That is
proven by a unit test and confirmed on a populated test set where the 2-step
score did not move. This matters because the 2-step path is already certified and
we must not silently disturb it.

Before building, an adversarial reviewer attacked the design and found three
real, blocking flaws — most importantly that the naive way of slotting new
documents in could shove a *needed* document out of view, and that the code
assumed the steps always arrive in a tidy order. Both (and several smaller
issues) were fixed before any code was written. The window-eviction risk the
reviewer flagged was then **measured at zero** on the real test set, so the fix
held up.

An honest note on scope: 3-step retrieval is at 63%, not 100%. The diagnostic
tool shows the rest is two *separate* problems — the very first document
sometimes doesn't rank well enough on the plain question (a base-search-quality
issue shared with 2-step), and some follow-up searches don't surface the right
document at all (a question-rewriting/resolution-quality issue). Neither is a
defect in the chain-walk itself; both are follow-on levers.

## Steps performed

1. **Retriever rewrite** (`src/retriever/multi-hop.ts`): replaced the single
   `depends_on` bridge with a sequential chain walk. Order is derived from the
   `depends_on` links and validated to be a single linear chain (anything
   branching/cyclic/rootless falls back to the original ranking — the floor).
   First hop resolves from the base window (captures nothing — the first
   relational chunk is already there, the parity invariant); each later hop
   retrieves its own sub-query, resolves the next entity from *those* chunks, and
   reserves the chunk the extractor cited. `injectAtomic` became `injectChunks`,
   merging the captured relational chunks + the atomic with all the original
   safety guards kept (empty-reserve early return, `Math.max(0,…)` head count,
   reserve capped to the window).
2. **Audit fixes folded in**: multi-entity `{idx}` substitution with an
   unresolved-placeholder sentinel; `extract-bridge` now returns the source
   `chunk_id` (a far better signal than "sub-query #1") with a top-novel
   fallback; `config_snapshot` tagged with `algo: "sequential-walk"` for honest
   provenance.
3. **Prompts**: `prompts/decompose-query.md` gained a worked 3+ hop linear-chain
   example; `prompts/extract-bridge.md` gained the optional source-chunk field.
   `DecomposeOutputSchema` max hops 3→4 (T7-ready).
4. **Telemetry + diagnostics**: added a `multi_hop.base_window` /
   `multi_hop.hop_candidates` debug log and generalized `scripts/triage-t4.ts`
   into `scripts/triage-multihop.ts` — diagnoses any N-hop tier and adds the
   `gold-base-evicted-by-injection` failure class.
5. **Tests** (`__test__/retriever/multi-hop.test.ts`): an element-identical 2-hop
   parity test (4 cases), 3-hop chain-walk tests (cited-chunk capture + fallback
   + partial-chain floor), and malformed-chain degradation. Full suite **104
   pass / 1 skip / 0 fail**, `tsc --noEmit` clean.
6. **Measurement** (flash, recall is reader-invariant): on deep-hop fixture
   `TBEAJBN93M2NAF1SX31JTE0ED7` over the frozen ingest, **T6 recall@5 3.3% →
   63.3%**, **T4 flat 86.7%**. Triage of the misses: `0`
   gold-base-evicted-by-injection, `0` candidate-not-injected, `7`
   base-retrieval-miss (incl. the two pre-existing T4 misses), `15`
   not-in-candidates — confirming the chain mechanism is clean.

## Action items / next steps

- **No-regression gate is partially blocked.** The current fixture's frozen
  ingest no longer has its vector points in the shared store (every tier,
  including single-hop T1, returned 0 results), so the gemma `control-check`
  could not run against it. Retrieval parity is instead established by the
  element-identical unit test + T4 holding flat on the populated deep-hop
  fixture. Re-establish the gate by re-ingesting the current fixture (with the
  small-summarizer workaround) and re-pinning if we want the gemma correct%
  confirmation — this naturally folds into Phase 2 certification.
- **Phase 2 (next):** extend `prompts/reader.md` to state the chain of
  relationships + final fact, generalize `prompts/judge.md`'s "one of two hops =
  PARTIAL" to N hops, then certify T6 correct% on **gemma control** and pin a
  separate deep-hop golden.
- **Two diagnosed retrieval levers (separate measured runs, one lever each):**
  (a) base-retrieval-miss — the start entity's relational chunk not ranking in
  the base top-5 (shared with T4); (b) not-in-candidates — follow-up sub-queries
  not surfacing the gold chunk (decompose/extract resolution quality, possibly
  HOP_FETCH_K depth). Neither is a chain-walk defect.
- **Phase 3:** wire 4-hop (T7) — the retriever already handles N=4; the open risk
  is the tighter k=5 window (4 gold + 1), to be solved via injection / per-tier
  window, not a global window bump.
