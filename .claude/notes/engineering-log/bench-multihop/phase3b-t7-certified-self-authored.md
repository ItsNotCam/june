---
title: "Multi-hop benchmark — Phase 3b: T7 certified via in-session query authoring"
type: engineering-log
feature: bench-multihop
sequence: 5
project: june
status: complete
tags: [eng-log, bench-multihop, area/research, tech/rag]
created: 2026-06-15
prev_commit: 5f2fc3c
new_commit: 29bfd3e
summary: Certified T7 by authoring the 15 four-hop questions in-session (no re-ingest, no Anthropic call) — T7 recall@5 46.7%, correct% 60.0%.
keywords: [multi-hop, T7, 4-hop, certification, in-session authoring, golden-pinned, recall@5, phase 3b]
---

# Multi-hop benchmark — Phase 3b: T7 certified via in-session query authoring

Entry 04 wired the 4-hop tier (T7) but left it *uncertified* because producing
T7 questions normally runs the Anthropic Sonnet query author, whose credits are
exhausted. This entry closes that gap a different way: since the 4-hop chains
only reference facts already present in the deep-hop fixture's corpus and ingest,
the **only** missing piece was the question text — so the 15 four-hop questions
were authored in-session and spliced into the fixture, then certified against the
existing ingest with no re-ingest and no Anthropic call. On the gemma4:26b
reference reader, **T7 lands at recall@5 46.7% and correct% 60.0%**, with T6
reproducing exactly (63.3%) and T4 flat (93.3%). T7 is now a real, certified,
golden-pinned tier.

**Commits:** `5f2fc3c` → `29bfd3e`   ·   2026-06-15

## What happened (high level)

A 4-hop question hides three bridges ("the maximum packet size of the system
tunneled through by the transport that the exchange Kreznak Signal tunnels
through authenticates via"). Entry 04 proved the machinery handles four hops, but
there were still zero 4-hop questions anywhere, because writing them is the
Sonnet author's job and that account is out of credits.

The unlock was realizing the corpus author was never needed. A 4-hop chain is
just three relationships plus one fact — all of which already live in the deep-hop
fixture's documents (it is the same 10-entity graph T6 uses). So nothing new had
to be written into the corpus or re-embedded; only the *question text* was
missing, and that could be authored here directly:

- The fact graph was enumerated for 4-hop paths (a pure, deterministic count —
  3448 of them exist), and 15 diverse chains were selected (varied start entities
  and distinct answers).
- Each chain got one hand-written question that names only the start entity and
  refers to all three hidden entities purely by their relationships — the same
  model-generic phrasing rule the reader and judge prompts already expect.
- Every question was checked to leak no hidden entity name (0 of 15 do), and the
  rows were spliced into the fixture's query list with honestly-computed
  anti-leakage scores.
- The run reused the existing ingest, so retrieval, reading, and judging all ran
  with no Anthropic dependency. Reader = gemma4:26b (the reference). Judge =
  deepseek-v4-pro (the standing certification judge).

The result is honest and clean. Of the 15 four-hop questions, retrieval put all
four needed documents in front of the reader for 7; gemma answered **all 7
correctly**. It also got 2 more right where retrieval delivered 3 of the 4
documents — real partial-context competence, not guessing (no question with
fewer than three documents was marked correct, and there were zero cases of "had
all four documents but answered wrong"). So T7's 60% reading score sits just
above its 46.7% retrieval score, and — exactly as predicted for four hops — the
ceiling is retrieval, not reading: more hops mean more chances for a sub-query to
miss, against a tighter five-slot window.

Two honesty notes:
- **The questions are Opus-authored, not Sonnet-authored** like T1–T6. For a
  brand-new tier with no prior baseline this is acceptable (there is nothing to
  be inconsistent *with*), and the questions meet the same structural bar. When
  Anthropic credits return, a full Sonnet regenerate can supersede them; the
  authored set is committed as a script so it is reproducible until then.
- **The deep-hop fixture changed**, so its hash changed. The Phase-2 T6-only
  golden became orphaned and was removed; the new golden is pinned on the
  combined T1–T7 run (T6 reproduced at 63.3%, confirming the splice disturbed
  nothing).

## Steps performed

1. **Authored + spliced T7** (`scripts/author-t7-queries.ts`): 15 four-hop
   `(fact_ids, question)` pairs, each verified to be a real A→B→C→D path ending at
   its atomic fact and to name only the start entity; appended to the fixture's
   `queries.json` with `jaccardOverlap`-computed anti-leakage scores. Verified 0
   of 15 leak a hidden entity name.
2. **Flash directional run** (deepseek-v4-flash, existing ingest reused): T7
   recall@5 46.7%, correct% 53.3%; T1–T6 reproduced exactly — the splice left
   prior tiers untouched.
3. **Gemma certification** (gemma4:26b control, retrieval frozen from the flash
   run, deepseek-v4-pro judge). First attempt died on a transient 504 from the
   home Ollama gateway at reader concurrency 3; re-ran at concurrency 1 (each
   request starts immediately, no proxy queue timeout) and it completed:
   **T7 recall@5 46.7%, correct% 60.0%**, T6 63.3%, T4 93.3%, others healthy.
4. **Verified the result honestly**: T7 correct set = the 7 full-recall queries
   (all correct) + 2 three-of-four near-misses; zero full-recall-but-wrong, zero
   sub-3/4 guesses marked correct.
5. **Re-pinned the golden** (`control-pin` on the combined run) and removed the
   orphaned Phase-2 T6-only entry; `control-check` passes for the new T1–T7
   golden. Typecheck clean, 107 tests pass.

## Action items / next steps

- **A full Sonnet regenerate can supersede the in-session T7 questions** once
  Anthropic credits return (re-author with the pipeline's query author, re-ingest
  if desired, re-pin). Not required for correctness — it only removes the mild
  Opus-vs-Sonnet authorship difference.
- **T7's lever is retrieval** (recall@5 46.7%). Diagnose with
  `scripts/triage-multihop.ts` and watch the `gold-base-evicted-by-injection`
  class specifically: the 4-gold-in-5 window has zero slack, so if the start
  entity's chunk ranks low in base, injection can evict it. If that class
  dominates, escalate via a per-tier `reader_eval.k` for T6/T7 only — never a
  global k bump (it breaks T4 parity). One lever per measured run.
- **The current-fixture no-regression re-ingest is still owed** (Phase 1/2 note),
  blocked on the same fixture's cleaned Qdrant points — independent of T7.
