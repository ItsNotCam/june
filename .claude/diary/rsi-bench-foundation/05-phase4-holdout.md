<!-- author: Claude -->
# RSI-Foundation · Phase 4 — Sealed real-doc holdout

**Commits:** `38178aa` → `7f947ab`  ·  **Branch:** `rsi-phase-4-holdout`

## Summary
Added a **sealed real-document holdout** beside the synthetic fixtures: a small slice of REAL
Next.js docs with hand-labeled questions, ingested as-is and scored at the **document level**
(recall@k = "a chunk from a labeled expected document appears in top-k" — no synthetic facts, no
Stage-5 fact→chunk resolution). It is reported **separately** and is structurally incapable of
becoming a golden. The whole point: **synthetic↔holdout divergence is the reward-hacking alarm** —
a change that lifts the fictional-domain score but not the real-doc score is overfitting (Goodhart).
This closes audit gap #6 (100% synthetic / no real-doc holdout) and is RSI safeguards #1 (strict
train/test separation) and #7 (real data for held-out evals). Shipped `fixtures/holdout-real/`: 19
App Router "getting-started" docs, 40 hand-labeled Q/A (34 answerable + 6 verified-absent
unanswerable). +30 tests (186 → 216, all green; tsc clean).

## High-level (plain English)
The synthetic fixture is a *fictional* domain (made-up protocol names). It catches gross
regressions — a broken chunker, a wrong embedder, a ranking failure — but it can't tell you whether
retrieval actually works on REAL documents with real idioms. So the bench needs a second, honest
exam built from real docs that the (future) self-improvement loop **never** optimizes against. If a
change makes the fictional score go up but the real-doc score stays flat, that's the alarm: the
change is gaming the toy, not improving the product.

The catch is that real docs have no planted facts, so the synthetic machinery (plant a fact → embed
its hint → resolve hint→chunk → score that chunk) doesn't apply. The holdout is **doc-native**
instead: the ground truth is simply *which document(s) answer this question*, and a query is
"recalled" when a chunk from one of those documents shows up in the top-k. That sidesteps fact
resolution entirely.

Building it stays **API-free**, like everything else in this initiative. The only creative work is
LABELING (the corpus is real — nothing authors it), and Claude Code's own agents do that:

- **`holdout-split`** slices a big concatenated docs file (Next.js `llms-full.txt`) into
  self-contained real documents on its frontmatter boundaries — a `---` line followed by `title:`,
  which is reliable because doc bodies use `---` only as thematic breaks. It keeps a *coherent*
  subset (a URL-prefix filter, capped at `--max-docs`) and emits the corpus + a labeling plan.
- **Agents label** ~30–60 Q/A grounded in the actual doc text: each answerable question names the
  minimal expected document(s) plus a short gold answer; a handful of unanswerable negatives ask
  plausible questions whose answers are *not* in this subset (correct behavior: refusal).
- **`holdout-assemble`** is the validity gate — it rejects a label that names a non-existent doc, an
  answerable label with no gold answer, or an unanswerable one that names docs.
- **`freeze-holdout`** locks it into `fixtures/holdout-real/` with a `holdout.lock.json` (`sealed:
  true`), immutable and hash-verified like any frozen fixture.

Running it: **`run-holdout --mode control`** ingests the real corpus, scores doc-level recall@k/MRR
(using the plain stopgap retriever — deterministic and API-free, the un-contaminated signal), runs
the LOCAL reader plus a no-RAG **same-reader** baseline, and emits judge tasks; agents judge them and
**`score-holdout`** finalizes. The result is `holdout_results.json` (`kind: "holdout"`), never a
`results.json` — so `control-pin`/`control-check` literally can't read it, and they refuse a holdout
run-dir outright. That's the structural seal: a holdout can never become a golden.

The **validity trap** is flagged loudly everywhere: the reader (gemma) and the judge agents were
trained on real Next.js docs, so reader-correct% can be satisfied from *memory*, not retrieval. The
summary therefore **leads with retrieval metrics** (immune to parametric memory) and reads the
**RAG − no-RAG delta** (same reader, empty context) as the only honest reader signal.

## Steps performed
- **Types** (`src/types/holdout.ts`): `HoldoutQuery` (doc-level expected filenames + gold answer +
  unanswerable flag), `HoldoutQueriesFile`, `HoldoutManifest`, `HoldoutPerQuery`, and
  `HoldoutResultsFile` (`kind: "holdout"`, `sealed: true`, answerable/unanswerable blocks, the
  RAG/no-RAG reader signals).
- **Scoring** (`src/lib/holdout.ts`): `resolveExpectedDocIds` (filename → june `doc_id` via the same
  `juneDocId` Stage 5 uses), `buildChunkDocMap` (chunk→doc projection from SQLite), `computeDocRecall`
  / `computeDocMrr` (any-expected-doc, doc-level), `median`.
- **Build path** (`src/lib/holdout-build.ts`): `splitDocs` (deterministic frontmatter-boundary
  splitter, URL-prefix + max-docs subset, content-derived `holdout_id`), `buildLabelingPlan`,
  `assembleHoldout` (the validity gate).
- **Lock** (`src/lib/holdout-lock.ts`): `buildHoldoutLock` / `verifyHoldoutLock` /
  `assertFrozenHoldoutIntact` — the doc-native sibling of `fixture-lock.ts` (no anti-collusion
  dimension; the corpus is real).
- **Aggregation + report** (`src/lib/holdout-score.ts`): per-query builder, bootstrap-CI aggregation
  into the answerable/unanswerable blocks + RAG/no-RAG correct%, `rescoreHoldoutWithVerdicts`
  (mirrors `rescoreWithVerdicts`), and `renderHoldoutSummary` (retrieval leads; loud parametric
  caveat).
- **CLI** (`cli/holdout.ts`): `holdout-split`, `holdout-assemble`, `freeze-holdout`, `verify-holdout`,
  `run-holdout` (reuses `runStage4` + `createStopgapRetriever` + `runStage7`, emits the external
  judge tasks), `score-holdout`. Registered in `cli/bench.ts`.
- **Seal guard** (`cli/control.ts` + `src/lib/holdout-paths.ts`): `assertNotHoldout` refuses
  `control-pin`/`control-check` on a holdout run-dir with a clear message.
- **The fixture**: `curl`ed `llms-full.txt` (build-time, one-off), split the 19 App Router
  getting-started docs, ran 5 labeling agents (4 answerable + 1 negatives), `grep`-verified all 6
  negatives are genuinely absent, assembled + froze `fixtures/holdout-real/` (holdout_hash
  `e1b4c989…`, verified).
- **Tests** (+30): splitter (frontmatter boundaries, in-body `---` ignored, prefix/max-docs,
  slug-dedupe, content-derived id), scoring (doc recall/MRR, resolve, median, aggregate + rescore),
  assembly validation, lock build/verify/tamper, and the seal guard.
- **Docs**: `HOLDOUT.md` (protocol), README (CLI + sealed-holdout section), status doc (Phase 4 ✅,
  Next → Phase 5). Verified `bun run typecheck` clean + `bun test` 216 pass / 1 skip / 0 fail.

## Action items / next steps
- **User runs the live holdout** (build/run split): `june-eval run-holdout fixtures/holdout-real
  --mode control` (gemma via Ollama + Qdrant) → judge `holdout_judge_tasks.json` with Sonnet agents
  → `june-eval score-holdout <run-dir> --verdicts <file>`. Read `holdout_summary.md` retrieval-first.
- Compare the holdout's doc-level recall to the synthetic fixture's chunk-level recall as a sanity
  check; a large gap is signal about real-doc retrieval quality (and the L7 caveat in action).
- **Phase 5 — judge calibration gate** (`validate-judge`, Cohen's κ ≥ 0.7 vs a human-labeled gold
  set). This is what *licenses* the agent judge to certify any run, synthetic or holdout.
- Later (Phase 6): the holdout would benefit from the RRF tie-break fix landing, so its doc-level
  recall is bit-stable across runs.
