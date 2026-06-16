# Multi-hop benchmark — Phase 3: 4-hop (T7) tier wired

Phase 3 of the deep multi-hop plan: wire the 4-hop tier (T7 — three relational
links plus one atomic fact). Because Phase 0 already generalized the chain
builder to any depth and Phase 1's retriever already walks an N-link chain,
adding T7 came down to a one-block generation call, a new authoring prompt, and a
window-pressure unit test — no new scoring, schema, or retriever code. The
feared bottleneck (too few 4-hop paths in the fact graph) did **not**
materialize: the existing fixture already contains 3448 depth-4 chains. T7 is
wired, typechecks, and is unit-validated for the tight reader window. It is **not
yet certified**: producing real T7 questions needs a fixture regeneration, and
the corpus/query authors are Anthropic Sonnet, whose credits are currently
exhausted — so the gemma certification and golden re-pin are owed once generation
credits return.

**Commits:** `0d26465` → `6a82059`   ·   2026-06-15

## What happened (high level)

A 4-hop question hides three bridges ("the heartbeat interval of the system that
the layer wrapped by the protocol that A authenticates via depends on"). Two
earlier phases had already done the hard parts:

- Phase 0 built a *depth-generic* generator — one function enumerates chains of
  any length, one tier-builder authors questions for them, one schema validates
  the author's output. T6 (3-hop) just calls it with depth 3.
- Phase 1 made the retriever walk a chain of *any* number of links and inject
  every intermediate document into the reader's view.

So Phase 3 only had to point that machinery at depth 4: add the generation call,
write the 4-hop authoring prompt, and prove the documents still fit. The reader
window holds 5 documents; a 4-hop question needs 4 of them (three relationship
documents plus the answer document) with 1 to spare. A unit test now proves the
retriever lands all three injected documents alongside the base document inside
that 5-slot window — the tightest packing the design has to handle.

Two risks the plan called out, checked and cleared:
- **"Are there enough 4-hop chains?"** Measured directly on the existing
  fixture's facts (a pure, no-LLM count): 3448 distinct depth-4 chains exist over
  40 relationships and 10 entities. Far more than any tier needs, so no
  guaranteed-chain planting is required.
- **"Does 4-gold-in-5 fit?"** The new N=4 retriever test confirms it does, and
  that a chain which fails to resolve a middle bridge falls back cleanly to the
  unmodified ranking (the floor), exactly like the 2- and 3-hop paths.

The honest gap: there are still **no T7 questions in any fixture** — the count is
zero everywhere until a deep-hop fixture is regenerated with T7 turned on. That
regeneration runs the corpus and query authors, both of which are Anthropic
Sonnet, and the Anthropic key is out of credits (the same blocker that stopped
the Sonnet judge and the no-RAG baseline in Phase 2). So T7 is *capability-
complete* but *unmeasured*. When credits return: bump the deep-hop config's T7
count, regenerate + re-ingest the deep-hop fixture, run a gemma control pass, and
re-pin that fixture's golden (which will then carry T6 and T7 together).

## Steps performed

1. **Generation wiring** (`src/stages/03-queries.ts`): added a `buildDeepTier`
   call for T7 — depth 4, prompt `query-t7`, count from `queries.counts.T7` — and
   appended its queries. Identical shape to the T6 call; only depth, prompt, and
   count differ.
2. **Authoring prompt** (`prompts/query-t7.md`): mirrors `query-t6.md` for four
   hops — names only the start entity, hides all three bridges, with a worked
   nested example resolving inward-to-outward.
3. **Window-pressure test** (`__test__/retriever/multi-hop.test.ts`): a 4-hop
   case asserting the three injected gold chunks (rel2 + rel3 + atomic) plus the
   base head occupy the top-5 exactly, and a mid-chain-failure case asserting the
   base floor. Suite now 106 pass / 1 skip / 0 fail; `tsc --noEmit` clean.
4. **Depth-4 availability check** (deterministic, no LLM): ran the chain
   enumeration over the existing fixture's `facts.json` — 3448 depth-4 chains vs
   1120 depth-3 — confirming T7 needs no chain planting.
5. **Docs** (`README.md`): noted that T6/T7 default to 0 and only the deep-hop
   fixture sets them > 0. The multi_hop bullet already described T4/T6/T7.

## Action items / next steps

- **Certify T7 once Anthropic generation credits return** (the only blocker):
  - Set the deep-hop config's `queries.counts.T7` > 0 (e.g. 15).
  - Regenerate the deep-hop fixture (`june-eval generate …`) and re-ingest it.
  - Run a gemma `--mode control` pass (judge `deepseek-v4-pro`, the standing
    certification judge) and read T7 correct% + recall@5.
  - Re-pin that fixture's golden (`control-pin`) — it will then hold T6 and T7.
    Note: regeneration changes the fixture hash, so the Phase-2 T6 golden
    (pinned on the current deep-hop fixture) will be superseded by the new
    combined golden; T6 should reproduce ≈ 63.3%.
- **Watch the tighter T7 window in practice.** The 4-gold+1 packing leaves zero
  slack: if the start entity's relational chunk (rel1) ranks low in the base
  top-5, injection can evict it (the `gold-base-evicted-by-injection` class in
  `scripts/triage-multihop.ts`). Measured at zero for T6; re-check for T7 on the
  first real run, and escalate only via a per-tier `reader_eval.k` if it
  dominates — never a global k bump (that breaks T4 parity).
- **Consider whether generation should move off Anthropic.** Repeated credit
  exhaustion blocks fixture work; if BYO-off-Anthropic generation is wanted, that
  is a deliberate, separate decision (it re-authors T1–T6 too, a mixed-authorship
  confound if done piecemeal) — not something to slip in silently.
