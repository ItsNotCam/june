# Multi-hop benchmark — Phase 4: double every tier to 160 questions

The deep-hop fixture certified at 80 questions (entry 05). This entry doubles
every tier in place — +80 self-authored questions over the **frozen corpus and
ingest**, with no Anthropic call — and re-certifies the whole 160-question
fixture on the gemma4:26b reference reader. The new half lands exactly where the
originals did: **T6's reading-composition gap stays at 0 on twice the questions
(correct% = recall = 58.3%)**, all ten T5 fakes are correctly refused, and T1/T3
stay perfect. The doubled fixture's golden is pinned on its new hash; the orphaned
80-question golden was removed.

**Commits:** `903a031` → `11db99c`   ·   2026-06-17

## What happened (high level)

The user asked to "double the number of test questions per tier." Doubling needs
new question *text*, which is normally written by the Anthropic Sonnet
`query_author` — still out of credits. But the deep-hop fixture's facts (10
entities, 40 relational edges, 80 atomic facts) and its ingest are frozen and
rich, so — exactly as with T7 in entry 05 — the corpus author was never needed.
Only the question text was missing, and that can be authored in-session against
the existing graph and appended, then evaluated with `--skip-ingest`.

So +80 questions were authored to double each tier: T1 5→10, T2 5→10, T3 5→10,
T4 15→30, T5 5→10, T6 30→60, T7 15→30 (160 total). The deterministic chain tiers
(T4/T6/T7) were drafted from the real fact graph in house style — each chain a
genuine `A→…→D` linear path naming only its start entity and hiding every bridge;
the single-fact tiers (T1 direct, T2 entity-paraphrase, T3 conversational
scenario) and the unanswerable T5 (five brand-new fictional entities) were
hand-written. A single committed script,
`scripts/author-double-queries.ts`, carries the authoritative
`(tier, fact_ids, text)` records and re-validates every row before appending:
real fact ids, linear-chain integrity, **only the start entity may be named** (no
leaked bridge or answer entity), T5 names **no** real entity, and no fact-id set
duplicates an existing or sibling row. (The fixture's `queries.json` is gitignored,
so the script — not the fixture — is the durable record, the same pattern as
`author-t7-queries.ts`.)

The result is honest and stable. Recall is reader-invariant, so the flash iterate
pass already gave the retrieval verdict; the gemma control run is the certified
correct%:

| Tier | N | Recall@5 | Correct% (gemma) | vs the 80-set |
|---|---|---|---|---|
| T1 | 10 | 100% | 100% | unchanged |
| T2 | 10 | 100% | 90% | 80% → 90% |
| T3 | 10 | 100% | 100% | unchanged |
| T4 | 30 | 83.3% | 90% | 93.3% → 90% |
| T5 | 10 | 0% | 100% | unchanged (10/10 refused) |
| T6 | 60 | 58.3% | **58.3%** | composition gap still 0 |
| T7 | 30 | 36.7% | 43.3% | retrieval-bound, within CI |

Two things make this a real certification rather than a lucky redraw. First, **T6's
composition gap is exactly 0 on sixty questions** (correct% equals recall to the
decimal) — the strongest evidence yet that 3-hop reading is genuinely solved and
the remaining gap is purely retrieval, not a small-sample artifact. Second, the
T6/T7 dips (63.3→58.3, 46.7→36.7) are recall movements from adding fresh chains
and sit comfortably inside the wider confidence intervals (T7's CI `[20%, 53%]`
contains both), so the new questions are neither cherry-picked-easy nor broken —
just more of the same difficulty.

Mid-run the machine rebooted (a >1-day gap wiped `/tmp`, taking the scratch config
and logs with it and stopping the Qdrant container). Ollama was fine; Qdrant came
back with `docker start` (its collections persist on a volume), and the run was
relaunched against the repo's own `config.yaml` instead of a `/tmp` copy — which
already carries the deepseek-v4-pro judge and the right multi_hop/`reader_eval.k`
settings, so the bench no longer depends on volatile scratch.

Two honesty notes:
- **The new questions are Opus-authored, not Sonnet** like the pipeline originals.
  For doubling an existing tier this is a mild authorship difference (the structure
  and phrasing match); a full Sonnet regenerate supersedes them once credits return.
- **The fixture changed in place, so its hash changed** (`01dd155a` → `bd88421a`).
  The 80-question golden became unreachable (and its `/tmp` backup was wiped), so it
  was removed; the registry now holds the current main fixture + the 160-question
  deep-hop fixture.

## Steps performed

1. **Enumerated the fact graph** (10 entities, 40 edges, 80 atomic facts) and the
   per-tier fact-id sets already used, to guarantee the new questions are real and
   non-duplicate.
2. **Drafted + hand-authored +80 questions**: deterministic chains for T4/T6/T7 in
   house style (start-entity-only, bridges hidden), paraphrase/scenario single-fact
   questions for T2/T3, direct lookups for T1, and five new fictional entities for
   T5.
3. **`scripts/author-double-queries.ts`**: baked the authoritative records, validated
   every row (chain integrity, start-entity-only naming, T5 names no real entity,
   dedup vs existing + batch), computed anti-leakage jaccard, and appended — fixture
   now 160 rows (10/10/10/30/10/60/30), unique ids, zero duplicate fact-sets.
   `tsc --noEmit` clean, 106 pass / 1 skip / 0 fail.
4. **Flash iterate** (directional retrieval verdict) over 160: recall matches the
   originals tier-for-tier; the judge's rationales cite the exact expected chains,
   confirming `expected_fact_ids` are right.
5. **Gemma control certification** (gemma4:26b reader @ concurrency 1, deepseek-v4-pro
   judge), reusing the frozen retrieval. Survived a mid-run reboot (restarted Qdrant;
   switched off the `/tmp` config). Result above.
6. **Re-pinned the golden** (`control-pin`, noise floor 0.05) on the new fixture hash;
   `control-check` PASSES (all Δ 0.0pp); removed the orphaned 80-question entry.
7. **Committed** the script + golden + README (gitleaks clean).

## Action items / next steps

- **T7 retrieval is still the lever** (recall@5 36.7%). The 4-gold-in-5 window has
  zero slack; diagnose with `scripts/triage-multihop.ts` and watch the
  `gold-base-evicted-by-injection` class. Escalate only via a per-tier
  `reader_eval.k` for T6/T7 if that class dominates — never a global k bump (breaks
  T4 parity). One lever per measured run.
- **A full Sonnet regenerate can supersede the in-session questions** once Anthropic
  credits return, removing the Opus-vs-Sonnet authorship difference. Not required
  for correctness.
- **Bench infra is reboot-fragile.** The Qdrant container must be running and the
  `/tmp` scratch config does not survive a reboot — prefer the repo `config.yaml`.
  Worth a `docker compose up -d` note or a startup check if this recurs.
- **The repo's `.claude/` directory is showing as deleted in the working tree**
  (tracked in git, absent on disk — predates this work, likely the reboot). This
  entry recreates only its own file; the broader deletion is unrelated and left for
  the user to reconcile.
