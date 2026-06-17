<!-- author: Claude -->
# @june/mcp-bench — working principles

This package is two things at once: it **houses the retrieval pipeline**
(`src/retriever/` — RRF fusion, multi-hop) and it is **the eval that grades it**
(`src/stages/`, the synthetic-corpus RAG-quality benchmark). Read the section
below before changing either half.

## Reader-by-purpose — flash iterates, gemma4:26b is the bar (FOREGONE CONCLUSION)

june is BYO-AI with a **24GB-VRAM floor**; **`gemma4:26b` (local Ollama) is the
reference reader that defines "expected results."** It's slow, so day-to-day iteration
uses hosted **`deepseek-v4-flash`** as a fast scratchpad. These never blur. Every
`june-eval run` **must declare intent** (enforced — a run with no intent hard-errors):

- **`--mode iterate`** → reader = `deepseek-v4-flash`. The scratchpad. **Directional
  signal ONLY — flash numbers are NEVER "expected results."** Use this for fast loops.
- **`--mode control`** → reader = `gemma4:26b` (Ollama @ `OLLAMA_URL`, the home host
  `https://ollama.your-lan.example:443`). **The bar.** The only runs that certify quality.
- explicit `--reader-provider/--reader-model` → `freeform` (e.g. a model bake-off).
  Never a baseline, never a control. (Mutually exclusive with `--mode`.)

**You do not ask which to use — you know:** *iterating → `--mode iterate`; benchmarking /
certifying / "is this actually good?" → `--mode control`.* The contract is committed in
`src/lib/modes.ts` (mode FORCES the reader; you cannot run `control` on the wrong model).
A PreToolUse hook also blocks any `june-eval run` missing intent.

**Logical (not literal) model differences — the discipline that makes this work:** flash
and gemma fail on *different* queries, so:
- A flash delta is a **hypothesis**; the gemma `control` run is the **verdict**. Never
  assume they're equal. A change that helps flash but regresses gemma is **overfit → reject**.
- Track progress by **failure class** (`relation-direction`, `over-refusal`,
  `multi-hop-composition`, `retrieval-miss`, `paraphrase-miss`), not raw query IDs or raw %.
- Reader/prompt changes must be **model-generic comprehension principles**, never
  flash-specific tells — that's what makes them transfer (and keeps BYO honest).
- Cadence is **batched at milestones**: iterate freely on flash, then gate a batch on
  gemma with `june-eval control-check <run_dir>` (fails if any tier regresses past the
  golden noise floor). Pin/raise the bar with `control-pin`. Golden = `golden.json`.
  Log flash-predicted vs gemma-actual per-class deltas in `transfer-log.md`.

The judge is **pinned identical across modes** — `--mode` swaps ONLY the reader, so the
reader is the sole variable.

**Certification judge of record: `deepseek-v4-pro`** (the sync `deepseek` provider). It
mirrors the older Sonnet batch judge closely (screening agreement κ ≈ 0.894) and is now the
committed default in `config.yaml` — certify with it from now on. The `anthropic-batch`
(Sonnet) judge remains selectable via `--judge-provider` but is no longer the bar, and it
requires Anthropic credits the Sonnet path currently lacks. Whatever judge a golden was
pinned with, gate that fixture's later control runs with the **same** judge — never
control-check across judges.

## `src/retriever/stopgap.ts` is a STOPGAP — not the real retriever

`stopgap.ts` talks to Qdrant directly **only because june does not yet expose a
retrieval API**. It is a bench-local stand-in, NOT june's production retrieval
path. Do not invest retrieval semantics here as if it were the system of record:

- When june ships a retrieval API, `stopgap.ts` is **replaced by `june-api.ts`
  and deleted**. The bench must then exercise *june's own* retriever.
- Retrieval logic that matters (filtering, fusion, ranking, reranking) belongs in
  **june**. Mirror it in the stopgap only as long as the stopgap exists, and only
  to keep the gauge honest — never to "fix retrieval" here instead of in june.
- The stopgap's `ingested_by` run-scoping is a **bench-test-rig workaround**, not
  product behavior: the bench shares one Qdrant collection across runs, so each
  run must filter to its own `ingested_by` points or it searches every prior
  run's accumulated stale chunks. Production june scopes by `is_latest=true`
  instead — the stopgap can't, because the sidecar-driven `is_latest` flip is
  inoperative in the multi-run/shared-collection bench setup.
- If you find yourself improving retrieval quality, ask: *does this belong in
  june, or in the stopgap?* The answer is almost always june.

## The bench is a gauge, not the goal

**We are building the best possible RAG pipeline — genuine comprehension and
retrieval on real, unseen documents. We are NOT trying to get the best bench
score.** The eval is an instrument we read to detect regressions and confirm
direction. It is never the objective.

The moment a change is made *because it moves the number*, the number stops
measuring anything (Goodhart's law). The fixture is fictional facts in a narrow
question style — a higher score on it can easily mean a worse product.

### Don't do (studying to pass the test)

- **Tuning to this corpus.** Hand-fitting RRF `dense_weight` / `bm25_weight` /
  `rank_constant`, chunk sizes, or thresholds until *this* fixture peaks. The
  code already flags this: changing `rank_constant` marks runs incomparable
  (I-EVAL-3). Overfit to fictional protocol names does not generalize.
- **Gaming the scorer.** Tweaking refusal detection or answer formatting to flip
  `REFUSED`/`INCORRECT` → `CORRECT` without retrieval or reading actually
  improving.
- **Answer-shortcut wins.** Anything that leaks the expected fact into where it
  shouldn't be, or exploits that the corpus is synthetic.
- **Picking components by leaderboard.** Choosing a summarizer/reader/embedder
  because it tops *this* corpus rather than because it produces genuinely better
  situating context / answers / vectors.
- **Selling a metric.** Framing a recommendation as "free N-point win." Justify
  the product change; let the gauge confirm it.

### Do (comprehension, not regurgitation)

- Justify every change on RAG/product merit **first** — does it generalize to
  real docs? what are the latency / cost / quality tradeoffs? — **then** read the
  bench to confirm no regression and check direction. Never the reverse.
- Prefer real capabilities that help on any corpus: a reranker (recall is
  present but ranking is weak — recall@1 ≪ recall@10), multi-hop retrieval
  (currently the compositional tier scores ~0), deterministic/pinned ingest (a
  reliable pipeline is better even if the % never moves).
- Treat green numbers as "no regression detected," never "done." A synthetic
  pass ≠ real-doc quality (see the bench's own L7 caveat in `summary.md`).

### Measuring honestly

Because the pipeline is inherently non-deterministic (LLM summaries, hosted-model
variance), know the **noise floor** before trusting any delta:

- **Determinism** — run the *same* config twice with fresh ingest both times;
  compare `recall@5/@1/MRR`. These are pure retrieval metrics (no reader/judge),
  and the embedder is deterministic, so any drift traces to the summarizer.
- **Consistency** — run twice reusing one ingest (`--skip-ingest <run-id>`) with
  the same reader; compare `correct%`. That isolates reader/judge variance.
- A change must clear the noise floor by a comfortable margin to count as real.
- **Never change two of {summarizer, retrieval, reader} in one run** — the result
  is uninterpretable. To compare readers, freeze the ingest; to compare
  summarizers, freeze the reader and read recall (not correct%).
