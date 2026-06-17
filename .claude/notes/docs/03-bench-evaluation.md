---
title: Bench & Evaluation — @june/mcp-bench
type: reference
status: active
tags: [project/june, area/research, tech/bench, tech/rag]
project: june
area: research
created: 2026-06-17
summary: Synthetic-corpus RAG-quality evaluator that plants facts and measures retrieval + reader recovery; ships june-eval.
keywords: [bench, mcp-bench, june-eval, rag evaluation, synthetic corpus, retrieval, reader, gauge not goal]
aliases: [mcp-bench, june-eval]
---

# Bench & Evaluation — `@june/mcp-bench`

> A synthetic-corpus RAG-quality evaluator. Plants known facts, builds a corpus and
> queries around them, ingests through the real `june` pipeline, then measures how
> well retrieval + a reader model recover the planted truth. Ships the **`june-eval`**
> CLI.

- **Authoritative spec:** [`.claude/plans/BENCH_SPEC.md`](BENCH_SPEC.md)
- **The discipline:** `packages/mcp/bench/CLAUDE.md` + `src/lib/modes.ts`

> ⚠️ **Bench is a gauge, not a goal.** The point is to optimize real RAG
> comprehension, never the bench %. A change that helps the fast `iterate` reader but
> regresses the `control` reader is overfit. See [07 — Dev workflow](./07-authorship-and-workflow.md).

---

## 1. The `june-eval` CLI

Entry: `cli/bench.ts`. Exit codes: `0` ok · `1` user/factory error · `2` lock
contention · `3` integrity violation · `4` operator abort.

| Command | Purpose |
|---|---|
| `generate [--seed <n>] [--domain <name>] [--out <dir>]` | Build a fixture (Stages 1–3): `facts.json`, `corpus/`, `corpus_manifest.json`, `queries.json`. Deterministic: `fixture_id = sha256(seed, domain)`. |
| `run <fixture_dir> [...]` | Drive Stages 4–9. **Must declare reader intent** (see §3). Resume/reuse via `--resume`, `--skip-ingest <run_id>`, or `--from <run_id> --rerun-from <stage>`. Sampling via `--quick`/`--sample`. `--cache`, `--baseline/--no-baseline`, `--progress-ndjson`. |
| `report <run_dir>` | Regenerate `summary.md` from `results.json` (seeded 10-verdict sampler). |
| `compare <run_a> <run_b> [--force]` | Diff two runs. **Refuses** if fixture, mode, reader, roles, or retrieval snapshot differ (use `--force` to override with a loud banner). Writes `compare.md`. |
| `control-pin <run_dir> [--noise-floor <0..1>]` | Pin a `control` run as the golden baseline → `golden.json`. |
| `control-check <run_dir>` | Fail (exit 3) if any tier's `reader_correct_pct` drops more than the golden noise floor. The batch gate. |
| `health` | Probe `june` (via `JUNE_BIN`), Qdrant, Ollama, and every sync role. |

---

## 2. The evaluation pipeline (Stages 1–9)

Stages 1–3 generate a fixture (deterministic, once per fixture). Stages 4–9 evaluate
against it. Every stage reads/writes JSON artifacts atomically and is resumable.

| # | Stage | What it produces |
|---|---|---|
| 1 | **Facts** (`01-facts.ts`) | `facts.json` — atomic `(entity, attribute, value)` + relational `(subject, predicate, object)` facts, each with a `surface_hint`. Validates a connected graph. `fixture_id = sha256(seed, domain)`. |
| 2 | **Corpus** (`02-corpus.ts`) | `corpus/*.md` — an LLM (the *corpus author*) renders fact groups as technical prose with every `surface_hint` embedded **verbatim**. A validator rejects docs missing a hint and reprompts (≤3). |
| 3 | **Queries** (`03-queries.ts`) | `queries.json` — five tiers (see §4). T2/T3/T4 pass an **anti-leakage** check (Jaccard content-word overlap < 0.40) so the query can't just lexically echo the answer. |
| 4 | **Ingest** (`04-ingest.ts`) | Delegates to the **`june` CLI**: validates corpus hashes, builds a scratch config (bench-owned SQLite + Qdrant), runs `june init` + `june ingest`. Writes `ingest_manifest.json`. |
| 5 | **Resolve** (`05-resolve.ts`) | `ground_truth.json` — maps each planted fact to the chunk that carries it: Tier 1 substring match, Tier 2 embedding match (≥0.85). Aborts (exit 3) if too many facts are unresolved (>2%) or needed embeddings (>20%). |
| 6 | **Retrieval** (`06-retrieval.ts`) | Per query: retrieve at `max(k_values)`, compute Recall@{1,3,5,10} + MRR with tier-specific scoring (see §4). |
| 7 | **Reader** (`07-reader.ts`) | Feed top-`k` chunks (default 5) as `<chunk>` blocks to the reader model; collect answers. Temperature locked to 0. Optional no-RAG **baseline** pass with an empty context. |
| 8 | **Judge** (`08-judge.ts`) | An LLM judge grades each answer against expected facts + retrieved context → one of 6 verdicts. Two paths: Anthropic **batch** (submit/poll/retrieve) or DeepSeek **sync** (bounded concurrency). Aborts if >5% `UNJUDGED`. |
| 9 | **Score** (`09-score.ts`) | `results.json` (full audit trail) + `summary.md`. Per-tier aggregates with 95% bootstrap CIs; macro + micro overall. |

The bench and the ingestion pipeline **meet at Stage 4** — this is the only place
`june-eval` shells out to `june`.

---

## 3. Reader-by-purpose: the iterate ↔ control discipline

The heart of the system (`src/lib/modes.ts`). Every `run` **must** declare intent —
there is no default, and a hook (`scripts/validate-reader-mode.sh`) blocks runs that
don't.

```ts
export const RUN_MODES = {
  iterate: { provider: "deepseek", model: "deepseek-v4-flash" }, // fast scratchpad
  control: { provider: "ollama",   model: "gemma4:26b" },        // the authoritative bar
};
```

- **`--mode iterate`** → `deepseek-v4-flash`. Fast, hosted. **Directional signal
  ONLY — never "expected results."** Flash deltas are hypotheses.
- **`--mode control`** → `gemma4:26b` (local Ollama, the BYO-AI 24 GB reference
  reader). **The verdict.** The only runs that certify quality. The mode *forces* the
  model — a control run cannot accidentally use the wrong reader.
- **explicit `--reader-provider/--reader-model`** → *freeform* (model bake-offs).
  Mutually exclusive with `--mode`; never a baseline, never a control.

**The judge is pinned identical across modes** — `--mode` swaps only the reader.

**Workflow:** iterate freely on flash → gate a batch with `june-eval control-check`
(fails if any tier regresses past the golden noise floor) → raise the bar with
`control-pin`. `golden.json` (per-tier correct% + noise floor, default 5pp) lives in
the repo, established by running control twice and taking the max per-tier drift.

Why `gemma4:26b`: it's the BYO-AI reference reader (24 GB VRAM min spec), chosen over
Qwen for personability. See memory *[Reference reader = Gemma 4 26B]* and
*[Two-reader workflow]*.

---

## 4. Query tiers & metrics

| Tier | Kind | ~Count | Expected | Recall scoring | Leakage check |
|---|---|---|---|---|---|
| **T1** | Lexical | 50 | 1 atomic | single chunk in top-K | skipped (overlap is the point) |
| **T2** | Paraphrase | 50 | 1 atomic | single chunk in top-K | Jaccard < 0.40 |
| **T3** | Conceptual | 40 | 1+ atomic | **any** expected chunk in top-K | Jaccard < 0.40 |
| **T4** | Multi-hop | 40 | 2 chained | **all** expected chunks in top-K | Jaccard < 0.40 |
| **T5** | Negative | 70 | none | n/a — correct behavior is **refusal** | skipped |

**Retrieval metrics:** Recall@{1,3,5,10} (tier-dispatched), MRR, T5 top-1 score
(diagnostic). **Reading metrics:** `reader_correct_pct` (T1–T4: `CORRECT`=correct;
T5: `REFUSED`=correct), `reader_hallucinated_pct`, `reader_refused_pct`, `unjudged_pct`.

**Overall** is reported two ways, deliberately asymmetric so nobody can quietly pick
the flattering one: **macro** (each tier weighted 1:1) and **micro** (each query 1:1;
T5's 70 queries dominate). All point estimates carry **95% bootstrap CIs** (1000
iterations, [2.5, 97.5] percentiles) with a `query_ids` provenance trail.

---

## 5. The LLM judge

`src/judge/`. Interface: `Judge = { name, judge_all(requests) }`. Verdicts:

```
CORRECT · PARTIAL · INCORRECT · REFUSED · HALLUCINATED · UNJUDGED
```

Verdicts are **tier-agnostic**; the scoring layer maps them to correctness per tier.
The judge grades **against the retrieved context**, not its own knowledge — grounded
elaboration is `CORRECT`, ungrounded assertion is `HALLUCINATED`. This grounding fix
collapsed false-negatives 25→0 across T1–T3 (see
[`.claude/findings/judge-grounding-fix.md`](../findings/judge-grounding-fix.md)).

Two implementations, sharing a byte-identical prompt (`prompts/judge.md`,
`renderJudgePrompt`):

- **Anthropic batch** (`llm-judge.ts`) — Sonnet via the Batch API; submit once, poll
  with exponential backoff (30s→300s), checkpoint `batch_submission.json` so a resumed
  run re-polls instead of resubmitting. The system-of-record judge.
- **DeepSeek sync** (`sync-llm-judge.ts`) — `deepseek-v4-pro` via bounded concurrent
  calls. **Validated to mirror the Sonnet judge at κ=0.894** and is now the default
  (cheaper, no batch latency). See memory *[deepseek-v4-pro mirrors Sonnet judge]*.

Select with `--judge-provider {anthropic-batch|deepseek}` / `--judge-model`.

If >5% of verdicts are `UNJUDGED`, Stage 8 aborts with `JudgeIntegrityError` and Stage
9 writes a stub `results.json` with `run_status: "aborted_integrity_judge"`.

---

## 6. Providers & the retriever

**Providers** (`src/providers/`): a uniform `LlmProvider = { name, call(req) }` over
`ollama | anthropic | openai | deepseek`, plus a `BatchLlmProvider` (`anthropic-batch`)
with `submit/poll/retrieve`. `buildProviders()` builds the registry;
`wrapRegistryWithCache()` adds an on-disk response cache (hits report `cost_usd: 0`).

**Retriever** (`src/retriever/`): `Retriever = { name, config_snapshot, retrieve(q, k) }`.

- **`stopgap.ts`** — ⚠️ a **temporary stand-in** because `june` doesn't yet expose a
  retrieval API. Embeds the query, runs dense + BM25 against each Qdrant alias,
  **filters by `ingested_by` run_id** (load-bearing — the bench shares one collection
  across runs), and fuses with **RRF** (`rank_constant: 60`). When `june` ships a real
  API this file is replaced by `june-api.ts`. Don't treat it as the system of record
  (memory *[Bench stopgap retriever]*).
- **`multi-hop.ts`** (optional) — an LLM planner detects a bridge entity, retrieves an
  atomic sub-query, and injects the novel chunk without demoting base chunks. Lifted
  T4 recall@5 from ~30%→~82.5%. Memory *[Multi-hop anchored injection]*.
- **`reranker.ts`** (optional) — a cross-encoder rescoring pass over a deep pool. Built
  and tested but **ships OFF**: the fixture's fictional protocol names give the model
  no learned signal, so it regresses T2/T3. Don't tune to beat it. Memory
  *[Bench unfair to rerankers]*.

Changing any retrieval-config value (weights, `rank_constant`) flips the
`retrieval_config_snapshot`, which makes `compare` refuse the diff — runs are only
comparable under identical retrieval config.

---

## 7. Config, results, tests

**Config** (`src/schemas/config.ts`, `config.example.yaml`): four `roles`
(corpus_author, query_author, reader, judge), `corpus`, `queries.counts`,
`anti_leakage`, `resolution` thresholds, `retrieval` (adapter, `k_values`, RRF,
optional multi_hop/rerank), `reader_eval.k`, `judge` (timeouts, `max_unjudged_pct`),
`scoring` (bootstrap), `baseline`, `ingest` (scratch), `cost` (budget cap + estimates),
`caching`, `log`.

**Results** (`src/types/results.ts`): `results.json` is the single source of truth —
`RunManifest` (every provider, the `mode`, the june ingest metadata, the retrieval
snapshot), `per_query[]` (full audit), `per_tier` aggregates, `overall.{macro,micro}`,
an integrity snapshot, and a `cost_usd` breakdown. Every metric is a
`MetricWithCi { point, ci_low, ci_high, query_ids }`.

**Tests** (`__test__/`): stage scoring (`01-facts`, `06-retrieval`, `09-score`), judge
flows + grounding goldens, retriever (`bm25`, `rrf`, `reranker`), and lib (`rng`,
`normalize`, `bootstrap`, `cost`, `tokens`). Determinism is a first-class invariant:
same seed + domain → byte-identical fixture.

---

## 8. Where the numbers live

Per run, under `state/runs/<run_id>/`: the per-stage JSON artifacts, `results.json`
(machine-readable), `summary.md` (human-readable, with 10 sampled verdicts to
eyeball), and — for `compare`/`control-check` — `compare.md`. Historical deep-dives:
[`results.md`](../../results.md) (the T1 0.38→1.00 retrieval-bug fix) and the active
diagnostic plans in [`.claude/plans/`](../plans/) (see
[08 — Planning artifacts](./08-planning-artifacts.md)).
