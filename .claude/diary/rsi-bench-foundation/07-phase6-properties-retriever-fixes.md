<!-- author: Claude -->
# RSI-Foundation · Phase 6 — Property/metamorphic tests + retriever fixes

**Commits:** `cf4bc63` → `18f5aaf`  ·  **Branch:** `rsi-phase-6-properties`

## Summary
Fixed the bench's first real **retriever determinism bug** (audit gap #9): reciprocal rank fusion
sorted by score with no tie-break, so two chunks with equal fused scores came out in whatever order
the vector store happened to return them — non-reproducible run-to-run. Added an explicit total order
`(score desc, chunk_id asc)` to **both** copies of the fusion (the bench's `src/retriever/rrf.ts` and
the production `ingest/src/retriever/rrf.ts`). Backed it with judge-independent **property/metamorphic
tests** on the pure fusion, a **cross-package parity test** that runs both copies and asserts
byte-identical output (so they can never drift — gap #10), and a **per-fact hop-recall** diagnostic in
Stage 6. +10 bench tests (239 → 249, all green); ingest stays 150 green; tsc clean across the
workspace.

## High-level (plain English)
This is the first phase that touched the *retriever* itself rather than the eval harness around it —
and it's a textbook example of why the bench exists. Reciprocal rank fusion blends the dense
(embedding) and sparse (BM25) result lists into one ranking by `score = Σ weight/(rank_constant +
rank)`. The blended scores are then sorted. The bug: the sort had no tie-break, so when two chunks
ended up with the *same* fused score (common when the dense and BM25 weights are equal), their order
was decided by which one happened to be inserted into the working map first — which in turn depends on
the order Qdrant returned them. Qdrant doesn't promise a stable order for equal-scoring hits, so the
same query could rank those two chunks differently on different runs. That's exactly the kind of
phantom "change" that would fool a self-improvement loop into thinking it moved the needle when nothing
real happened.

The fix is the standard one (and the one the reranker already used): give the sort an **explicit
secondary key**. Ties now break by `chunk_id` — an arbitrary but *stable, content-addressable* order —
so the ranking is a pure function of the inputs, independent of arrival order. It's a determinism fix,
not a quality tune: it doesn't try to make any score go up (the tied chunks are equally relevant by
construction); it makes the gauge *reliable*. This is precisely the nondeterminism the Phase-2
`measure-noise-floor` determinism assertion was built to catch — that command should now read ~0 drift.

The same fusion logic is duplicated in june's production retriever (`ingest/src/retriever/rrf.ts`,
"ported from the bench's"), so I applied the identical fix there and added a **parity test** that
actually executes both implementations on the same inputs and asserts they produce byte-for-byte the
same ranking. That guards the core honesty premise — the bench only measures the real system if its
stand-in retriever ranks the way production does — and it would fail loudly if the fix landed in one
file but not the other.

I also added **per-fact hop recall** as a diagnostic. The gated multi-hop recall is all-or-nothing: a
T4 (two-hop) query scores 1 only if *both* expected chunks are retrieved, else 0. That hides whether a
failure was "got 1 of 2 hops" or "got neither." `perFactRecall` reports the fraction (0.5 vs 0.0),
surfaced in `retrieval_results.json` — it diagnoses *where* compositional retrieval broke without
touching the gated score.

The two metamorphic RETRIEVAL invariances the plan also lists — paraphrase invariance and
irrelevant-doc invariance — need real embeddings and a live Qdrant, so they're live-run properties
rather than committed unit tests. The committed property tests cover the pure fusion logic (which is
what the determinism fix lives in); the live invariances are noted for the user's stack.

## Steps performed
- **The fix**: added `|| a.chunk_id.localeCompare(b.chunk_id)` to the final sort in
  `src/retriever/rrf.ts` and `ingest/src/retriever/rrf.ts`, with a comment tying it to the Phase-2
  determinism probe and the reranker's existing explicit tie-break.
- **Property/metamorphic tests** (`__test__/retriever/rrf-properties.test.ts`): the explicit
  total-order invariant over 200 seeded-random inputs (the fix), determinism (same input → identical
  output), k-cap + input-subset + no-duplicate, the **modality-swap metamorphic** test (swapping which
  modality surfaced a chunk must not change the tie order — fails pre-fix), and the fused-score
  formula.
- **Parity test** (`__test__/retriever/rrf-parity.test.ts`): imports both `reciprocalRankFusion`
  copies, runs them on 200 shared random inputs, asserts `toEqual`; plus a direct tie-break parity
  case. (The cross-package import works because the ingest file's `#internal` imports are type-only,
  erased at runtime.)
- **Per-fact recall** (`src/stages/06-retrieval.ts`, `src/types/retrieval.ts`): pure `perFactRecall`
  helper + optional `per_fact_recall_at_k` on the retrieval record; unit-tested in the Stage-6 suite
  (1-of-2 hops → 0.5 where binary recall is 0; single-fact tiers equal the binary; T5 → 0).
- Verified: workspace `tsc` clean; bench `bun test` 249 pass / 1 skip / 0 fail; ingest 150 pass.
- Docs: status (Phase 6 ✅ → Next Phase 7), the ingest README retrieval note, this diary entry.

## Action items / next steps
- **Phase 7 — meta-tests, CI, the RSI-readiness contract**: a hermetic end-to-end test (tiny frozen
  fixture → ingest → resolve → retrieve → emit tasks → fixture verdicts → score, asserting invariants),
  CI wiring (unit + property + e2e + `validate-judge` on the committed recorded verdicts), and the
  written contract of every guarantee the gauge now makes.
- **Live (user's stack)**: run `measure-noise-floor` on two control runs sharing one ingest — it should
  now assert ~0 retrieval drift (the tie-break fix is what makes that true). Also the paraphrase- and
  irrelevant-doc-invariance metamorphic checks (need Qdrant + the embedder).
- The Phase-4 holdout live run and the first real `control` golden pin remain pending (the pin is
  unblocked — it requires a licensed judge, which sonnet now is).
