# Multi-hop benchmark — Phase 2: reader + judge chain composition, T6 gemma-certified

Phase 2 of the deep multi-hop plan: teach the reader and judge to compose an
N-link relationship chain (not just one bridge), then certify 3-hop (T6)
answer-correctness on the reference reader. With retrieval held byte-identical to
the Phase-1 run, the gemma4:26b **control** certification lands T6 correct% at
**63.3%** — and that number exactly equals T6 recall@5 (also 63.3%), over the
*same* 19 of 30 queries. That means every 3-hop chain the retriever actually
delivers, gemma reads correctly: the reading-composition gap is **zero**, and the
only remaining T6 ceiling is retrieval. The certified 2-hop tier (T4) stayed flat
at 93.3% — no regression. A separate deep-hop golden was pinned via a new
per-fixture golden registry, so the current fixture's golden is untouched.

**Commits:** `ecf2ff7` → `5baabaa`   ·   2026-06-15

## What happened (high level)

A 3-hop question hides two bridges ("the max packet size of the layer wrapped by
the protocol that Snorblath authenticates via"). Phase 1 made the *retriever*
walk that chain and put all three documents in front of the reader. But the
reader and judge prompts only knew about a *single* bridge — so even with the
right documents in view, the reader would sometimes collapse the chain (state the
final fact but skip an intermediate relationship) and the judge had no rule for
"got 2 of 3 hops."

The fix is two prompt changes, both written as model-generic comprehension
principles (so they transfer to any reader, not just our fast scratchpad model):

- The **reader** rule for indirectly-referenced subjects now handles a *chain* of
  relationships: resolve it one link at a time starting from the only
  directly-named entity, and state *every* connecting relationship plus the final
  fact — not just the final fact.
- The **judge** rule that said "for T4, one of two hops = PARTIAL" now applies to
  any multi-hop tier (T4 = 2 hops, T6 = 3, T7 = 4).

Then the verdict was taken the disciplined way: iterate on the fast reader
(directional only), certify on the slow reference reader (the bar). The fast read
first showed the new reader prompt had *helped* 3-hop but *cost* one 2-hop query
— the longer prompt had buried the "state the bridge" requirement, so the reader
dropped it on a 2-hop answer. Restoring that imperative to the front of the rule
fixed the 2-hop query while keeping the 3-hop gain. Only then was the reference
reader run.

The headline from the reference reader: **T6 correct% = T6 recall@5 = 63.3%, on
the same queries.** Reading a 3-hop chain is no longer the bottleneck — when the
documents are present, the answer is right. The remaining gap is purely the
retriever not always surfacing all three documents (the two levers Phase 1
already diagnosed), which is follow-on work, not Phase 2.

An honest note on tooling and provider state:
- The project's Anthropic key is **out of credits**, so the Sonnet
  "system-of-record" judge and the no-RAG baseline pass could not run. The
  certification used the **deepseek-v4-pro** judge instead — the currently shipped
  default judge, which mirrors the Sonnet judge closely (screening agreement
  κ ≈ 0.894). The same judge was pinned for both the fast and reference runs, so
  the reader stayed the only variable. This is a validated stand-in, not the
  Sonnet system-of-record; re-certifying on Sonnet is worth doing once credits
  return.
- `prompts/judge.md` also carries a **pre-existing working-tree revision** (grade
  grounding against the retrieved context) that predates this phase and was not
  authored here. It was committed in full because the certification ran against
  it and the pinned golden depends on it; flagged here for provenance.

## Steps performed

1. **Reader prompt** (`prompts/reader.md`): generalized the
   indirectly-referenced-subject rule from a single bridge to a chain of one or
   more links, with a worked nested example, while keeping the single-bridge
   "must state BOTH the relationship and the fact" imperative prominent so the
   2-hop path is undisturbed.
2. **Judge prompt** (`prompts/judge.md`): generalized the PARTIAL rule to any
   multi-hop tier (some-but-not-all hops resolved = PARTIAL).
3. **Per-fixture golden registry** (`cli/control.ts` + `golden.json`): `golden.json`
   became a map keyed by `fixture_hash`. `control-pin` now updates only the run's
   fixture entry (leaving other fixtures' goldens intact); `control-check` resolves
   the golden for the run's own fixture. The existing current-fixture golden was
   migrated into the registry in place. Added `fixture_hash` to `BenchLogFields`
   (`src/lib/logger.ts`) for the pin log line.
4. **Fast directional read** (deepseek-v4-flash reader, retrieval frozen via
   `--from <phase1-run> --rerun-from reader`): old prompts T6 46.7% / T4 93.3% →
   new prompts (first cut) T6 60.0% / T4 86.7%. The T4 dip traced to one query
   where the reader dropped the bridge; the prominence fix restored T4 to 93.3%
   while T6 held 60.0%. All other tiers flat.
5. **Reference certification** (gemma4:26b control, same frozen retrieval, judge
   pinned identical): **T6 correct% 63.3%, T4 93.3%**, T1/T2/T3/T5
   100/80/100/100%. Verified the T6 correct-set is *exactly* the T6 recall-hit set
   (19/30, no misread-after-retrieval, no lucky guesses) — composition gap = 0.
6. **Pinned the deep-hop golden** (`control-pin`, noise floor 0.05): T6 = 0.633
   recorded under the deep-hop fixture hash; the current fixture's golden
   preserved. `control-check` against it passes.
7. **Verify**: `bun run typecheck` clean; `bun test` 104 pass / 1 skip / 0 fail.
   Updated the bench README's golden section to describe the per-fixture registry.

## Action items / next steps

- **Re-certify on the Sonnet system-of-record judge** once the Anthropic key has
  credits again, to confirm the deepseek-v4-pro-judged T6 = 63.3% holds on the
  pinned-of-record judge.
- **The current-fixture no-regression gate is still retrieval-blocked.** Phase 1
  noted the current fixture's frozen ingest lost its Qdrant points; that is
  unchanged. Phase 2 touches only reader/judge prompts (retrieval was reused
  byte-identical), so retrieval parity is not at risk here — but re-ingesting the
  current fixture and running a full gemma control-check against its golden is
  still owed (it would also exercise the committed judge against the
  current-fixture golden, which was pinned earlier).
- **T6's remaining 37% is retrieval, not reading.** The two Phase-1-diagnosed
  levers — base-retrieval-miss (the start entity's relational chunk not ranking
  in the base top-5) and not-in-candidates (a follow-up sub-query not surfacing
  its gold chunk) — are the only path to raise T6 further. One lever per measured
  run.
- **Phase 3 (next):** wire 4-hop (T7). The retriever and the prompts already
  handle N=4; the open work is generation (length-4 chains, `buildT7`,
  `prompts/query-t7.md`) and the tight k=5 window (4 gold + 1), solved via
  injection, not a global window bump.
