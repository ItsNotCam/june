<!-- author: Claude -->
# Fixture authoring protocol (the no-API corpus + query authors)

A bench fixture's two creative inputs — the **corpus** (documents june ingests)
and the **queries** (the exam) — are LLM-authored. To honor the bench's no-API
principle, the bench does **not** call a corpus/query model. Instead it emits a
deterministic **authoring plan** and the **Claude Code orchestrator's own agents**
write the prose: **sonnet authors the corpus, opus authors the queries**. Distinct
models per role is the anti-collusion guarantee (audit gap #7) — a single author
lets queries lexically echo the corpus and inflates recall.

This mirrors the judge seam (`JUDGE-RUNNER.md`): the bench owns the deterministic
skeleton + the validation; the agents own the creativity; nothing calls an API.

```
june-eval scaffold <domain> --seed <n> --out <dir>     # bench, deterministic, NO API
   → facts.json (seeded) + authoring_plan.json

orchestrator (Claude Code)                              # sonnet + opus agents, NO API key
   → sonnet agents author each document  → <corpus-drafts>/<slug>.md
   → opus  agents author each query      → query-drafts.json  { spec_id: text }

june-eval assemble <scaffold_dir> --corpus-drafts <dir> --query-drafts <file>
          --corpus-model <m> --query-model <m> --out <fixture_dir>   # bench, validates
   → facts.json + corpus/ + corpus_manifest.json + queries.json

june-eval freeze <fixture_dir> --name <name> --signoff <who>          # commit + lock
```

## 1. Read `authoring_plan.json`

```jsonc
{
  "fixture_id": "…", "domain": "…", "seed": 31337,
  "documents": [
    { "doc_index": 0, "slug": "glorbulon-protocol", "entity_label": "Glorbulon Protocol",
      "facts": [ { "id": "f-atomic-0001", "surface_hint": "Glorbulon Protocol uses port 7694 for control messages", … } ] }
  ],
  "query_specs": [
    { "spec_id": "T2-1", "tier": "T2", "target_fact_ids": ["f-rel-0022"],
      "facts": [ { "surface_hint": "Querban Layer interoperates with Plirnode Framework", … } ],
      "anti_leakage": true }
  ]
}
```

## 2. Author the corpus (sonnet, one agent per document)

For each `documents[i]`, spawn a **sonnet** agent (model `sonnet`). It writes a
natural, encyclopedic reference document about `entity_label` that **embeds every
listed `surface_hint` VERBATIM** (exact substring — `assemble` rejects the doc
otherwise, because Stage 5 resolves ground truth by substring-matching the hint).
Write its output to `<corpus-drafts>/<slug>.md`.

- Plant each hint as a complete sentence, in a plausible surrounding narrative.
- Do not invent contradictory facts; the planted hints are the source of truth.
- The hints are byte-sensitive — copy them exactly (numbers, units, casing).

## 3. Author the queries (opus, batched per tier)

For each `query_specs[i]`, spawn an **opus** agent (model `opus`) to write ONE
question. Batch per tier for consistency. Tier semantics:

| Tier | The question must… |
|---|---|
| **T1** lexical | ask for the fact using wording close to the hint (lexical overlap is the point; not anti-leakage-gated). |
| **T2** paraphrase | ask for the same fact in DIFFERENT words — **avoid the hint's content words** (Jaccard ≤ threshold, default 0.40). |
| **T3** conceptual | pose a scenario whose answer IS the fact, without naming it; also anti-leakage-gated. |
| **T4** multi-hop | require composing BOTH target facts (e.g. "what does the thing that X connects to compress with?"); gated. |
| **T5** negative | ask a plausible question about the anchor entity whose answer is **NOT** in the corpus — correct behavior is refusal. Never reveal a real fact. |

Collect into `query-drafts.json`: `{ "T1-1": "…", "T2-1": "…", … }`.

## 4. Assemble (the validity gate)

```
june-eval assemble <scaffold_dir> --corpus-drafts <dir> --query-drafts <file> \
   --corpus-model claude-sonnet-4-6 --query-model claude-opus-4-8 --out <fixture_dir>
```

`assemble` enforces the fixture's validity and **fails loudly** so you re-author
the offending item:

- every planted `surface_hint` must normalize-include into its document, else
  `CorpusValidationError` names the missing fact(s) → re-author that doc;
- every gated query's Jaccard overlap with its hint must be ≤ the threshold, else
  it's a leak → re-author that query in fresher words;
- `--corpus-model` and `--query-model` must DIFFER (anti-collusion).

## 5. Freeze

```
june-eval freeze <fixture_dir> --name <name> --signoff "<who reviewed it>"
```

Copies the fixture into the committed `fixtures/<name>/` dir and writes
`fixture.lock.json` (canonical hash + per-file hashes + provenance). `freeze`
refuses a colluded fixture, so the distinct sonnet/opus authorship is what lets it
through with `anti_collusion: true`. From then on the fixture is immutable: `run`
verifies the lock before ingest, and `verify-fixture` re-checks on demand.
