---
title: Scope — 3-hop & 4-hop multi-hop questions (tiers T6 / T7)
type: reference
status: done
tags: [project/june, area/research, tech/rag, tech/bench]
project: june
area: research
created: 2026-06-17
summary: Audited scope/paper-trail for adding 3-hop (T6) and 4-hop (T7) tiers; implemented across the bench-multihop engineering log.
keywords: [3-hop, 4-hop, T6, T7, multi-hop scope, relational chain, atomic fact, audited, paper trail]
aliases: [deep multi-hop scope]
---

# Scope — 3-hop & 4-hop multi-hop questions (tiers T6 / T7)

> Paper-trail doc (sibling of `01`–`05`). Action #4 (T4 bridge-lookup fix) is DONE +
> gemma-certified; golden.json is pinned to the current fixture. This plan was audited twice
> (Opus agent + PreToolUse hook) before approval.

## Context

Today the only multi-hop tier is **T4 = exactly 2 hops** (1 relational `f-rel-*` + 1 atomic
`f-atomic-*`; the question names the start entity, hides the bridge). We want to measure
**3-hop (T6)** and **4-hop (T7)** — chains `A --rel--> B --rel--> C [--rel--> D]` then an
atomic fact about the last entity. This is the compositional capability that matters most on
real docs and is unmeasured past one bridge.

**Verified realities that make this tractable:**
1. **Scoring generalizes but the dispatch is hardcoded.** `computeRecall`/`computeMrr`
   (`src/stages/06-retrieval.ts:99-108,123-136`) use `.every()` (all gold in top-k) / latest-rank
   MRR — correct for any N — but branch on `tier === "T4"` (T5 special-cased). T6/T7 must be
   **added to both branches** or they fall through to single-hop `.some()`/earliest-rank.
2. **Chain assembly is deterministic code; the join condition is confirmed.** `buildFactChains`
   (`03-queries.ts:285-295`) joins `relational.object == atomic.entity`. So an N-hop chain is
   `R1(A→B), R2(B→C), …, atomic(entity = last)` with `R(i).object == R(i+1).subject`. The LLM
   only writes the question text from the pre-built chain (`QueryAuthorT4OutputSchema` is a
   2-tuple, `schemas/queries.ts:36`).
3. **The fact model supports chains; Stage 1 just doesn't guarantee them.** `validateFacts`
   (`01-facts.ts:95-113`) checks each relational endpoint is an atomic entity but not that
   *paths* exist; it does NOT forbid an entity being both subject and object (chains are safe).

**Decisions locked:** new tiers **T6 (3-hop) / T7 (4-hop)**; a **new dedicated deep-hop
fixture** (current fixture + pinned golden + frozen ingest stay stable); **3-hop first**.

## The hardest constraint — window pressure (design the retriever around this)

An N-hop question has **N gold chunks** that must ALL be in the reader's top-`k` (=5):
`(N-1)` relational + 1 atomic. The base (original-query) retrieval surfaces the **first**
relational chunk (the only named entity); the intermediate relational chunks live in the
*later* entities' docs (Stage 2 groups facts by subject) with **no base-query hook**, so they
won't appear in base — they must be injected. Today `injectAtomic` injects exactly **1** chunk
(the atomic, `INJECT_SLOTS=1`, `multi-hop.ts:58,205,241-265`); intermediate relational chunks
are only *read by the extractor*, never placed in-window.

| Hops | Gold chunks | In base | Must inject | Fits k=5? |
|---|---|---|---|---|
| 2 (T4, today) | 2 | rel1 | atomic (1) | yes |
| 3 (T6) | 3 | rel1 | rel2 + atomic (2) | yes (3 gold + 2 free) |
| 4 (T7) | 4 | rel1 | rel2 + rel3 + atomic (3) | tight: 4 gold + **1** free |

**Core retriever change:** during sequential resolution, capture the chunk that establishes
each *sub-query-resolved* hop and inject those + the atomic. `injectAtomic` (1 slot) →
`injectChunks(reserve[])`, keeping the non-demoting protected-head property.

**⚠ N=2 PARITY INVARIANT (load-bearing — protects the pinned T4 golden):** the reserve must
**EXCLUDE the first relational chunk** (rel1), which the base query already surfaces and which
today is never injected. Only chunks resolved from *sub-queries* (rel2…rel(N-1) + atomic) go in
the reserve. At N=2 the reserve = {atomic} → byte-identical to today's `injectAtomic`. Any
design that injects rel1 changes 2-hop behavior and moves the golden — forbidden.

**Solve 4-hop WITHIN k=5** (4 gold + 1 free fits). **Do NOT bump `reader_eval.k`** — it is a
single global int (`config.ts:173-175`); raising it moves T4 and breaks N=2 parity. A larger
window is a last resort that first requires making `reader_eval.k` **per-tier** (a separate
config change), not a global bump.

## Phased design (3-hop first; each phase = one measurable milestone)

### Phase 0 — deep-hop fixture foundation (generation + scoring plumbing for T6)
Makes T6 exist and be measurable before the retriever can do 3 hops (baseline will be low,
like T4 at multi_hop-OFF — the honest start).
- **Stage 1 chain planting** (`src/stages/01-facts.ts` + domain `src/domains/glorbulon-protocol.ts`):
  add `buildChainedRelationalFacts(depth, count)` that plants **guaranteed** `A→B→C(→D)` edges —
  for DETERMINISM/stable coverage (length-3 paths occur incidentally at ~40 edges/10 nodes, but
  aren't guaranteed or controlled). The bottleneck is **out-degree** (4 edges/entity), not the
  10-entity pool; planting may raise out-degree and/or entities. Respect existing invariants:
  unique ids, **no duplicate `surface_hint`** (`01-facts.ts:78-83`), `usedPairs` dedup. Extend
  `validateFacts` to assert planted chains form actual paths.
- **Stages 2 & 5 are in scope.** Stage 2 (`src/stages/02-corpus.ts`) plants chain facts into their
  subject docs; its validator (`CorpusValidationError`, ~`02-corpus.ts:178`) checks each planted
  `surface_hint` is present. Stage 5 (`src/stages/05-resolve.ts`) resolves every fact to a chunk —
  `buildFactToDocMap` (`05-resolve.ts:167-185`) throws `GroundTruthResolutionError` on unplanted
  facts. No structural change expected for either; confirm both pass for chain facts.
- **Tier enum** (`src/types/query.ts`): add `T6` (+ `T7` now) to `QueryTier` + `QUERY_TIERS` +
  docs. TS forces every `Record<QueryTier,…>` to gain keys — catches `cli/run.ts` per-tier init
  **AND `writeStubResults` (~`run.ts:1122-1128`, hardcoded T1..T5)** and `src/types/results.ts`.
- **Config counts — NON-BREAKING** (`src/schemas/config.ts:87-93`): add `T6`/`T7` as
  **`.default(0)`** so existing configs still validate. Update `config.example.yaml` + live
  `config.yaml` in lockstep.
- **Generation** (`src/stages/03-queries.ts` + `src/schemas/queries.ts`): `buildFactChains3`;
  `QueryAuthorT6OutputSchema` (3-tuple); `buildT6` mirroring `buildT4`'s anti-leakage loop
  (jaccard over ALL N surface_hints — **revisit the 0.40 threshold**, dilution as N grows). New
  prompt **`prompts/query-t6.md`** teaching nested phrasing that names ONLY the start entity.
- **Scoring dispatch** (`src/stages/06-retrieval.ts`): add `T6`/`T7` to the two branches. **Macro
  caveat** (`09-score.ts:264`): confirm `macroOverall` skips zero-query tiers (so the current
  fixture's 5-tier headline is unmoved). `scripts/judge-screen.ts:143` hardcodes `[T1..T4]` (low).
- **Build the fixture:** `june-eval generate` a new deep-hop fixture (own id), ingest it (own
  frozen ingest). Record the **T6 baseline** recall@5 (expected low until Phase 1).

### Phase 1 — retriever: sequential N-bridge resolution + chain injection (the real work)
- **`src/retriever/multi-hop.ts`:** replace single-bridge `hops.find(depends_on)` + one
  `extractBridge` + one `{0}` (`:170-192`) with a **sequential walk** by `depends_on`: resolve B1
  from base window; sub-query naming B1 → retrieve → extract B2 from THAT retrieval (not base),
  keep its top relational chunk; repeat to atomic. `injectAtomic` → `injectChunks(reserve[])`
  honoring the **N=2 parity invariant** (reserve excludes rel1).
- **Planner prompts:** `prompts/decompose-query.md` teach 3+ hops + `{0}`,`{1}`… chain; **bump
  `DecomposeOutputSchema` max 3→4**. `prompts/extract-bridge.md` already generic.
- Measure **T6 recall@5** on flash; iterate injection until the chain lands in k=5.

### Phase 2 — reader + judge chain composition (T6 correct%)
- `prompts/reader.md`: extend "indirectly-referenced subjects" to state a *chain* of
  relationships + final fact. `prompts/judge.md`: generalize "for T4, one of two hops = PARTIAL"
  to "some-but-not-all of the N hops = PARTIAL." Certify **T6 correct%** on gemma control.

### Phase 3 — 4-hop (T7)
- Add `buildFactChains4`, `QueryAuthorT7OutputSchema` (4-tuple), `buildT7`, `prompts/query-t7.md`;
  plant length-4 chains. Phase-1 retriever already handles N=4; the pressure is the **k=5 window
  (4 gold + 1)** — solve via injection, not a k bump. Certify on gemma.

## Verification & measurement discipline (`bench/CLAUDE.md`)
- **New fixture, its own golden.** Iterate on flash (`--mode iterate`); certify on gemma
  (`--mode control`); `control-pin` a SEPARATE golden for the deep-hop fixture.
- **Shared-retriever no-regression gate (critical).** After Phase 1/3, run the **current**
  fixture on its frozen ingest and `control-check` against the **pinned current golden** — the
  N=2 path must stay flat.
- **One lever per measured run**; track by failure sub-class; generalize `scripts/triage-t4.ts`
  to N gold chunks. Log flash-predicted vs gemma-actual per phase in `transfer-log.md`.

## Open risks
- Out-degree (not entity count) funds distinct deep chains; anti-leakage dilution as N grows
  (per-tier threshold?); keep k=5 (per-tier k is the only safe enlargement); nested phrasing must
  hide ALL bridges and read naturally.
