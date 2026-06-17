<!-- author: Claude -->
# Real-doc holdout protocol (the sealed, never-gated eval)

The synthetic fixture (`AUTHORING.md`) is a *fictional* domain — great for catching
gross regressions, blind to real-doc idioms (L7). Phase 4 adds a **sealed
real-document holdout**: a small slice of REAL docs (Next.js) with hand-labeled
questions, ingested and scored at the **document level**. It is reported
**separately** and is **never pinned, gated, or tuned against**. The whole point:
**synthetic↔holdout divergence is the reward-hacking alarm** — a change that lifts
the toy score but not the real-doc score is overfitting the fictional domain
(Goodhart). This is RSI safeguard #1 (strict train/test separation) and #7 (real
data for held-out evals).

Like the other seams, the bench owns the deterministic skeleton + the validation;
**Claude Code's own agents** do the only creative work (LABELING — the corpus is
real, so nothing authors it); **nothing calls an LLM API.**

```
# one-time, build-time acquisition (NOT at eval time):
curl -sSL https://nextjs.org/docs/llms-full.txt -o state/holdout-src/nextjs-llms-full.txt

june-eval holdout-split <source.txt> --out <dir> \
   --url-prefix /docs/app/getting-started --max-docs 24      # bench, deterministic, NO API
   → corpus/*.md (real docs) + corpus_manifest.json + labeling_plan.json

orchestrator (Claude Code)                                    # agents, NO API key
   → agents read labeling_plan.json + corpus/ and write Q/A → labels.json

june-eval holdout-assemble <split_dir> --labels labels.json \
   --label-model claude-opus-4-8 --out <fixture_dir>          # bench, validates
   → corpus_manifest.json + holdout_queries.json

june-eval freeze-holdout <fixture_dir> --name holdout-real --signoff <who>   # commit + lock

# run it (the user runs the live ingest + local reader):
june-eval run-holdout fixtures/holdout-real --mode control    # doc-level retrieval + reader
   → holdout_judge_tasks.json (run_status awaiting_verdicts)
orchestrator judges with Sonnet agents (see JUDGE-RUNNER.md)   → verdicts.json
june-eval score-holdout <run-dir> --verdicts verdicts.json    → holdout_results.json (SEALED)
```

## 1. Split a coherent subset

`holdout-split` slices the concatenated docs file on its frontmatter boundaries
(`---` followed by `title:` — reliable, because bodies use `---` only as thematic
breaks). Keep a **coherent** subset (`--url-prefix`, e.g. one App Router area)
capped at `--max-docs` (the dossier wants 20–50 docs). It writes the real `.md`
files, an ingest-ready `corpus_manifest.json` (no planted facts), and a
`labeling_plan.json` inventory. The split is deterministic — same input + options →
byte-identical output, and a content-derived `holdout_id`.

## 2. Label the Q/A (agents, grounded in the real docs)

Spawn agents to read `labeling_plan.json` + the docs and write `labels.json`:

```jsonc
{
  "holdout_id": "holdout-…",
  "labels": [
    { "text": "How do I set page metadata that depends on fetched data?",
      "expected_doc_filenames": ["app-getting-started-metadata-and-og-images.md"],
      "gold_answer": "Use the dynamic generateMetadata function…", "unanswerable": false },
    { "text": "How do I configure i18n routing in the App Router?",
      "expected_doc_filenames": [], "gold_answer": "", "unanswerable": true }
  ]
}
```

Rules the agents follow (the labeling discipline):
- **Answerable** — name the MINIMAL set of `expected_doc_filenames` (from the plan)
  that actually contain the answer, and write a concise `gold_answer` **grounded in
  the doc text** (the judge grades against it). Phrase questions naturally — don't
  echo a heading verbatim.
- **Unanswerable** (negatives) — a plausible question whose answer is NOT in this
  subset (verify with `grep -ril <keyword> corpus/`). `expected_doc_filenames: []`,
  empty `gold_answer`. Correct behavior at eval time is **refusal**.
- The corpus is real, so there is no anti-collusion dimension; the labeler is the
  only "author". Distinct-model discipline applies only where it adds value.

## 3. Assemble (the validity gate)

`holdout-assemble` rejects an answerable label that names an unknown/zero doc or
carries no gold answer, and an unanswerable label that names expected docs — fail
loudly so you re-label the item. It emits `corpus_manifest.json` +
`holdout_queries.json`.

## 4. Freeze (immutable, sealed)

`freeze-holdout` copies the holdout into committed `fixtures/<name>/` and writes
`holdout.lock.json` (canonical hash + per-file hashes + provenance, `sealed: true`).
`run-holdout` verifies the lock before ingest; re-check any time with
`verify-holdout`.

## 5. Run + score (the user runs the live pass)

`run-holdout --mode control` (reader = local **gemma4:26b**) ingests the real corpus,
scores **doc-level recall@k/MRR** over the labeled expected docs, runs the local
reader (+ a no-RAG **same-reader** baseline unless `--no-baseline`), and emits
`holdout_judge_tasks.json`. Agents judge it (JUDGE-RUNNER.md); `score-holdout`
finalizes `holdout_results.json`.

## ⚠️ Read the result correctly (the validity trap)

The reader (gemma) and the judge agents were **trained on real Next.js docs** — they
have **parametric knowledge of the answers**. So:

- **Lead with retrieval** (recall@k/MRR over the labeled expected docs). Those are
  doc-level and **immune to parametric memory** — the trustworthy signal.
- Treat **reader-correct% as secondary**. The honest reader signal is the
  **RAG − no-RAG delta** (same reader, empty context) — how much retrieval ADDS over
  what the reader already knows. `run-holdout` runs that baseline by default.
- The holdout is **SEALED**: `holdout_results.json` (`kind: "holdout"`) is NOT a
  `results.json`, so `control-pin`/`control-check` can't read it — and refuse a
  holdout run-dir outright. **Never optimize the holdout. It exists to diverge.**
