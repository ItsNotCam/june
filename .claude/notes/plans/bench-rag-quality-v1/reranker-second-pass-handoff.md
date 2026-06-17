---
title: "Handoff: second-pass reranker for @june/mcp-bench retrieval"
type: reference
status: draft
tags: [project/june, area/research, tech/retrieval, tech/bench]
project: june
area: research
created: 2026-06-14
summary: Self-contained handoff to build a cross-encoder second-pass reranker; bench is a deterministic A/B control. Design not started.
keywords: [reranker, cross-encoder, second pass, recall@1, mrr, handoff, deterministic control, retrieval]
aliases: [reranker handoff]
---

# Handoff: second-pass reranker for `@june/mcp-bench` retrieval

**Status:** design not started. Measurement control is verified READY (see §2).
**Written:** 2026-06-14. Pick this up in a fresh context — it is self-contained.

---

## 0. TL;DR

Retrieval surfaces the right chunk but ranks it #1 too rarely: **T2 recall@1 = 64%
while recall@5 = recall@10 = 100%; T3 r@1 = 73%, r@5 = 98%.** A cross-encoder
second-pass reranker over the candidate set is the highest-leverage next
capability. The bench is a clean, *deterministic* control for it (two runs match
to the decimal), so we can A/B it without a noise floor. Optimize **recall@1 and
MRR** (pure retrieval), never correct% (reader+judge noise). Build it as the only
retrieval change against a frozen ingest + frozen reader.

Read the gauge-discipline rules in `packages/mcp/bench/CLAUDE.md` before starting —
this whole effort is governed by "build the best RAG pipeline, not the best bench
score." A reranker is endorsed there by name.

---

## 1. Why a reranker (the product justification, not the number)

"Recall is present, ranking is weak" is the textbook reranker case and generalizes
to real docs (it is not fixture overfit). Current per-tier retrieval, identical
across two independent runs:

| tier | n | r@1 | r@3 | r@5 | r@10 | MRR | correct% |
|---|---|---|---|---|---|---|---|
| T1 | 50 | 90 | 96 | 100 | 100 | 0.94 | 100 |
| T2 | 50 | **64** | 88 | 100 | 100 | **0.78** | 90 |
| T3 | 40 | **73** | 90 | 98 | 100 | **0.82** | 98 |
| T4 | 40 | 0 | 13 | 83* | 90* | 0.20* | 78 |

\*T4 numbers are with multi-hop ON (run `Z61RJC6F`). With multi-hop OFF (`2FNP8QQH`)
T4 is r@5=30, r@10=68, MRR=0.13. T1/T2/T3 are **byte-identical** between the two runs.

- **The win lives in T2/T3 r@1.** The answer chunk is already inside top-5/top-10
  every time; it just isn't ranked first. ~36 pts (T2) and ~25 pts (T3) of pure
  ranking headroom. Target: push MRR past ~0.9.
- **T4 r@1 = 0 is structural,** not a ranking bug: the *relational* chunk
  legitimately ranks #1 (most query-similar); the *atomic* answer chunk is the
  recall bottleneck, handled today by multi-hop's anchored bridge injection. A
  reranker may help T4 too but treat it as a separate, later experiment.

### Tier legend (this fixture has NO T5)
T1 = single-fact direct · T2 = anti-leakage paraphrase · T3 = atomic anti-leakage ·
T4 = multi-hop (needs BOTH a relational chunk `f-rel-*` and an atomic chunk
`f-atomic-*`; `expected_fact_ids[0]`=relational, `[1]`=atomic) · T5 = unanswerable
(absent here). Fixture: `RP6PNN3KW7Q2JS2R0GQ3Z00JZG`, 180 queries (50/50/40/40).

---

## 2. The control is READY — and it's deterministic

Retrieval (dense + BM25 + RRF) has **no LLM in the loop**, so on a *frozen ingest*
the recall@k / MRR metrics are deterministic. Evidence: runs `Z61RJC6F` and
`2FNP8QQH` produce identical T1/T2/T3 recall@{1,3,5,10} + MRR. Therefore:

- **No noise floor is needed for the reranker A/B** on T1/T2/T3. Freeze one ingest
  (`--skip-ingest <run_id>`) and the reranker becomes the only moving part.
- **Optimize recall@1 and MRR** — pure retrieval signals computed in Stage 6
  before the reader/judge run. Do NOT chase correct%: it adds reader+judge variance
  and is partly judge-bounded (and per the gauge rules, judging correctness is the
  reader's problem, not the ranker's).

### Two things that DO inject non-determinism — control for them
1. **multi-hop uses an LLM planner** (`deepseek-v4-flash`), so T4 retrieval is
   non-deterministic. For a clean first experiment, run with **multi_hop DISABLED**
   so the reranker wraps single-pass retrieval directly (isolates the T1-T3 win).
   If you need multi-hop on, pin the planner with `--cache` so its calls are
   reproducible.
2. **"Never change two of {summarizer, retrieval, reader} in one run"**
   (`bench/CLAUDE.md`). The reranker IS the retrieval change → freeze the ingest
   (summarizer) and the reader.

---

## 3. Architecture & exact integration point

### The `Retriever` interface — `src/retriever/types.ts`
```ts
export type Retriever = {
  name: string;
  config_snapshot: Record<string, unknown>;  // recorded in results.json; compare refuses to diff different snapshots (I-EVAL-3)
  retrieve: (queryText: string, k: number) => Promise<RetrievalResult[]>;
};
```
`RetrievalResult` is in `src/types/retrieval.ts` (has `chunk_id`, score, rank-source tags).

### How retrievers are wired today — `cli/run.ts:360-393` (Stage 6 setup)
- `createStopgapRetriever({...})` builds the inner retriever (`src/retriever/stopgap.ts`).
- It's optionally wrapped by `createMultiHopRetriever({ inner, plannerProvider, ...,
  windowK: cfg.reader_eval.k })` when `cfg.retrieval.multi_hop.enabled`.
- The wrap pattern (decorator over `inner.retrieve`) is exactly how a reranker should
  compose — **mirror multi-hop**.

### Inside the stopgap — `src/retriever/stopgap.ts:56-118`
`retrieve(queryText, k)`:
1. `fetchLimit = k * 2` (line 67) — dense + BM25 each fetch `fetchLimit` per collection.
2. Qdrant queries return `with_payload: ["chunk_id"]` only — **no chunk text**.
3. `reciprocalRankFusion({ dense, bm25, ..., k })` (`src/retriever/rrf.ts:18`) fuses
   and **truncates to k**.

### Recall/MRR computation — `src/stages/06-retrieval.ts`
- `runStage6` asks the retriever ONCE at `maxK = max(cfg.retrieval.k_values)` (=10),
  then computes recall at each k from that single ranked list (lines 40-60).
- `computeRecall(tier, expected, retrieved, k)` (line 93): T4 requires ALL expected
  ids in top-k (`.every`); other tiers require ANY (`.some`). `computeMrr` at line 118.
- Note `k_values: [1, 3, 5, 10]` (`config.yaml` / schema). recall@5 is the headline.

### RECOMMENDED reranker design (decorator, no stopgap edits)
Create `src/retriever/reranker.ts` → `createRerankingRetriever({ inner, reranker,
poolK, fetchChunkContent })`, returning a `Retriever`:
```
retrieve(queryText, k):
  pool = await inner.retrieve(queryText, poolK)         // deep candidate pool, poolK >> k (e.g. 30-50)
  texts = pool.map(c => fetchChunkContent(c.chunk_id))  // SQLite raw_content (see below)
  scored = await reranker.score(queryText, texts)       // cross-encoder (query, chunk) relevance
  return pool.reordered_by(scored).slice(0, k)          // top-k after rerank, preserving RetrievalResult shape
```
- **Chunk text fetcher already exists as a pattern**: multi-hop builds one from
  SQLite at `cli/run.ts:383-388`:
  `SELECT raw_content FROM chunks WHERE chunk_id = ?`. Reuse it.
- **Deep pool**: `inner.retrieve(query, poolK)` makes stopgap fetch `poolK*2` per
  modality, then RRF returns `poolK`. For T2/T3 the answer is already in top-10 so
  even poolK=10 captures the full r@1 win; go deeper (30-50) to also help the
  ~10% beyond top-10 and T4.
- **Ordering vs multi-hop:** for Phase 1 run multi_hop OFF (reranker wraps stopgap
  directly — no interaction). Decide reranker↔multi-hop nesting in Phase 2 (reranking
  the anchor ranking could change bridge-entity extraction, which reads base top-3;
  reranking the final set could demote multi-hop's injected atomic chunk). Keep them
  separate until each is independently validated.
- Set `config_snapshot` to include the reranker model + poolK so `compare` flags
  cross-config diffs (I-EVAL-3).

### Config schema — `src/schemas/config.ts:94-126` (`retrieval` block)
Add a `rerank` sub-object mirroring how `multi_hop` is modeled (optional, with an
`enabled` flag + provider/model/poolK). Update `config.example.yaml` and the live
`config.yaml` (gitignored — local only). Parity rule: schema + example + type
together.

---

## 4. The one big design fork to decide first

**Which reranker?** This shapes everything (provider plumbing, cost, latency, where
it can run):

- **A. Local cross-encoder** (e.g. a bge-reranker / MiniLM cross-encoder via Ollama
  or ONNX). Deterministic, free, fast, no API. Best fit for a deterministic control
  and for "belongs in june" (june is local-first). Plumbing: a new scorer akin to
  `embedViaOllama` (`src/retriever/stopgap.ts` imports it) — check if Ollama serves a
  reranker model, else ONNX runtime.
- **B. Hosted rerank API** (Cohere/Voyage/Jina rerank). Strong quality, but adds a
  paid dependency + network; less aligned with local-first june.
- **C. LLM listwise rerank** (deepseek/Claude scores or reorders the pool). Reuses
  existing providers (`src/providers/`), but non-deterministic unless temp 0 +
  `--cache`, and pricier per query.

Recommendation to evaluate first: **A (local cross-encoder)** — keeps the control
deterministic and the capability where it belongs (june). Confirm with the user
before building; this is the decision to make at the top of the new context.

### Where it ultimately belongs (gauge rule, `bench/CLAUDE.md`)
Reranking is "retrieval logic that matters" → belongs in **june**. june has no
retrieval API yet (that's why `src/retriever/stopgap.ts` exists — it's a STOPGAP,
not june's real retriever). So build it in `bench/src/retriever/` for now,
**architected to move to june** when `june-api.ts` lands. Do not treat the stopgap
as the system of record.

---

## 5. A/B control protocol (how to measure)

Fixture: `state/fixtures/RP6PNN3KW7Q2JS2R0GQ3Z00JZG`
Frozen ingest source: run `20260614180533-Z61RJC6F` (its Stage-4 scratch + Qdrant
collections still exist; `--skip-ingest` validates them). Qdrant must be up at
`http://localhost:6333` (`docker compose up -d qdrant` if not).

```bash
cd packages/mcp/bench

# BASELINE (reranker OFF, multi_hop OFF) — frozen ingest, retrieval-only signal:
bun cli/bench.ts run state/fixtures/RP6PNN3KW7Q2JS2R0GQ3Z00JZG \
  --skip-ingest 20260614180533-Z61RJC6F --cache --yes
# (or reuse 2FNP8QQH's numbers as the multi_hop-OFF baseline: T2 r@1=64, T3 r@1=73)

# CANDIDATE (reranker ON) — same ingest, same reader:
bun cli/bench.ts run state/fixtures/RP6PNN3KW7Q2JS2R0GQ3Z00JZG \
  --skip-ingest 20260614180533-Z61RJC6F --cache --yes   # with rerank.enabled: true in config

# READ THE SIGNAL — recall@1 / r@3 / MRR per tier from results.json:
bun cli/bench.ts compare state/runs/<baseline>/ state/runs/<candidate>/
```
Pull per-tier metrics directly: `results.json → per_tier.{T1..T4}.{recall_at_1,
recall_at_3, recall_at_5, mrr}.point`. **Success = T2/T3 r@1 and MRR rise with no
T1 regression.** Retrieval-only metrics don't need the reader/judge to move, so a
`--rerun-from retrieve` style loop is fast and cheap.

To check determinism of the candidate path itself (reranker reproducibility): run
the candidate twice on the same frozen ingest; recall@1/MRR must be identical (a
local cross-encoder at temp 0 will be; an LLM reranker needs `--cache`).

---

## 6. Gauge-discipline guardrails (do not skip)

From `packages/mcp/bench/CLAUDE.md` + memory `bench-is-gauge-not-goal`:
- Justify the reranker on RAG/product merit FIRST (recall present, ranking weak,
  generalizes), then read the bench to confirm direction + no regression. Never the
  reverse.
- Do NOT hand-tune poolK / weights / a reranker threshold until *this* fixture
  peaks. Do NOT pick a reranker model because it tops this corpus. Do NOT frame it
  as a "free N-point win."
- Treat green numbers as "no regression detected," never "done." Synthetic pass ≠
  real-doc quality.
- The reranker belongs in june; the stopgap is temporary (`bench-stopgap-retriever`).

---

## 7. Current repo state you're inheriting (IMPORTANT)

- **Uncommitted, complete, verified:** deepseek-v4-pro is now a selectable judge AND
  the default, via a new sync judge path. Files: `src/schemas/config.ts` (judge enum
  + `concurrency`), `src/judge/llm-judge.ts` (extracted/exported `renderJudgePrompt`,
  `outcomeFromText`), `src/judge/sync-llm-judge.ts` (new), `src/stages/08-judge.ts`
  (branch), `src/types/judge.ts`, `src/lib/cost.ts`, `src/lib/logger.ts`,
  `cli/run.ts` (`--judge-provider`/`--judge-model`, `judge_stage_label`),
  `config.example.yaml`, README, `__test__/judge/sync-llm-judge.test.ts`. Frontend:
  `packages/next/lib/test/config.ts`, `lib/test/model-catalog.ts`,
  `app/test/_components/ConfigPanel.tsx`. All typecheck clean; `bun test` 82 pass;
  verified end-to-end (run `X23SBNPN`, κ=0.894 vs Sonnet, correct% judge-invariant).
  **This is unrelated to the reranker but is uncommitted** — commit it (run
  `bash scripts/check-authorship.sh` first) or stash awareness before large edits.
- Commit conventions: conventional prefixes `(feat)/(fix)/...`; authorship split via
  `scripts/check-authorship.sh` (Claude-primary >50% → `Co-authored-by: Claude
  <claude@anthropic.com>`). `config.yaml` is gitignored — never commit it.

---

## 8. File reference index

| Path | What |
|---|---|
| `packages/mcp/bench/CLAUDE.md` | Gauge-not-goal rules + stopgap warning — READ FIRST |
| `src/retriever/types.ts` | `Retriever` interface to implement/decorate |
| `src/retriever/stopgap.ts` | Inner retriever; `fetchLimit=k*2` (L67), RRF call (L107) |
| `src/retriever/rrf.ts` | `reciprocalRankFusion` (L18) — fuses + truncates to k |
| `src/retriever/multi-hop.ts` | Decorator pattern to mirror for the reranker (`createMultiHopRetriever` L61) |
| `cli/run.ts:360-393` | Stage 6 retriever wiring (where to insert the rerank wrap) |
| `cli/run.ts:383-388` | SQLite chunk-text fetcher pattern (reuse for reranker) |
| `src/stages/06-retrieval.ts` | recall/MRR computation; `computeRecall` (L93), `computeMrr` (L118), `maxK` (L40) |
| `src/schemas/config.ts:94-126` | `retrieval` config block (add `rerank` like `multi_hop`) |
| `config.example.yaml` (`retrieval:`) | mirror the new config; live `config.yaml` is gitignored |
| `src/types/retrieval.ts` | `RetrievalResult` shape returned by retrievers |
| `src/providers/` | provider plumbing if you go LLM/hosted reranker (option B/C) |
| `state/fixtures/RP6PNN3KW7Q2JS2R0GQ3Z00JZG/` | the 180-query fixture |
| run `20260614180533-Z61RJC6F` | multi_hop-ON baseline + frozen-ingest source for `--skip-ingest` |
| run `20260614055723-2FNP8QQH` | multi_hop-OFF retrieval baseline (T4 r@5=30) |

### First actions in the new context
1. Read `packages/mcp/bench/CLAUDE.md`.
2. Confirm the reranker-model fork (§4) with the user — recommend local cross-encoder.
3. Commit or note the uncommitted deepseek-judge work (§7).
4. Plan the decorator (`src/retriever/reranker.ts`) + config + the Phase-1
   multi_hop-OFF A/B (§5), then build and measure recall@1/MRR.
