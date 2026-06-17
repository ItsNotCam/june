---
title: "Action #1: Diagnose where T1–T3 correct% is lost — reader vs retrieval"
type: reference
status: done
tags: [project/june, area/research, tech/bench, tech/rag]
project: june
area: research
created: 2026-06-17
summary: Read-only diagnostic action plan to attribute T1–T3 correctness loss to reader vs retrieval; gated actions #2/#3.
keywords: [diagnose, T1, T2, T3, reader vs retrieval, action plan, bench, read-only, gating]
aliases: [bench action 1]
---

# Action #1: Diagnose where T1–T3 `correct%` is lost — reader vs retrieval

**Status:** ready. Cheapest + most informative; gates #2/#3. Pure read-only analysis.
**Independent:** yes. No code, no bench runs, no worktree. Reads existing run artifacts.

---

## Shared context (true for all four action plans)

- **Repo:** `/home/cam/june/packages/mcp/bench` (`@june/mcp-bench`, `june-eval` CLI). Bun runtime, TS strict.
- **Gauge discipline (READ FIRST):** `packages/mcp/bench/CLAUDE.md` + memory `bench-is-gauge-not-goal`. We optimize *real RAG comprehension*, never the bench %. Diagnosing *where* failures occur is legitimate analysis; tuning a knob until the fixture peaks is not.
- **Fixture:** `state/fixtures/RP6PNN3KW7Q2JS2R0GQ3Z00JZG` — 180 queries, tiers 50/50/40/40 (T1/T2/T3/T4), **no T5**. T1=single-fact direct · T2=anti-leakage paraphrase · T3=atomic anti-leakage · T4=multi-hop (needs a relational `f-rel-*` AND an atomic `f-atomic-*` chunk).
- **Key runs already on disk** (under `state/runs/`):
  - `20260615020227-HZ8P069Z` — **baseline**: rerank OFF, multi_hop OFF.
  - `20260615020817-6TN8JSC9` — **candidate**: rerank ON (`Xenova/bge-reranker-base`, pool_k=40), multi_hop OFF.
  - Frozen ingest source for `--skip-ingest`: `20260614180533-Z61RJC6F` (its scratch + Qdrant collections still exist).
- **Reranker finding (memory `bench-unfair-to-rerankers`):** a cross-encoder reranker is built, tested, and shipped OFF. It regresses T2/T3 recall@5 here because the fixture's *fictional protocol names* are the only discriminator and the model can't use them — a fixture artifact, not a reranker verdict.
- **Current state (multi_hop OFF baseline):** recall@5 is saturated on T1–T3 (100/100/97.5) but **recall@1 is weak (T2=62, T3=70)**; T4 is the weak tier. Reader window is `reader_eval.k = 5`.
- **Consistency notes:** `config.yaml` and `state/` are **gitignored** (a fresh git worktree won't have them). Qdrant (`localhost:6333`) and Ollama are single shared instances. `--config <path>` overrides the config file; there is **no** `--reader-k` CLI flag (reader k is config-only). Serialize any bench runs.

---

## Why this task

Since recall@5 ≈ 100% on T1–T3, **any wrong answer on those tiers cannot be a retrieval miss** — the answer chunk was in the reader's top-5 window. So a wrong T1–T3 answer is either a **reader failure** (answer in context, reader didn't produce it) or **judge noise**. This task quantifies that split, which decides where the next effort goes:
- If T1–T3 errors are mostly reader-side → invest in the **reader**, not retrieval ranking (#2/#3 are lower priority).
- If retrieval@5 actually misses more than recall numbers suggest → retrieval still matters.

## Goal

Per tier (T1–T4), cross-tabulate every query into a 2×2:

| | reader verdict CORRECT | verdict not CORRECT |
|---|---|---|
| **answer chunk in retrieval top-5** | retrieval+reader both fine | **reader gap** (answer was in context) |
| **answer chunk NOT in top-5** | lucky/parametric answer | **retrieval gap** |

Headline output: for T1/T2/T3, what fraction of non-CORRECT answers are *reader gaps* vs *retrieval gaps*.

## Inputs (all under `state/runs/20260615020227-HZ8P069Z/`)

- `retrieval_results.json` → `results[].{query_id, retrieved[]}` (retrieved = ranked chunk_ids).
- `judge_results.json` → per-query reader verdict. **Inspect its exact shape first** (key for query_id, key for verdict/outcome — likely `CORRECT|PARTIAL|INCORRECT|REFUSED`). Decide whether PARTIAL counts as "correct" (report both ways).
- `ground_truth.json` → `resolutions[].{fact_id, chunk_id}` (maps expected fact → chunk).
- `state/fixtures/RP6PNN3KW7Q2JS2R0GQ3Z00JZG/queries.json` → `queries[].{id, tier, expected_fact_ids}`.

Retrieval@5 hit rule: T1/T2/T3 = **any** expected chunk in top-5; T4 = **all** expected chunks in top-5 (matches `computeRecall` in `src/stages/06-retrieval.ts:93`).

## Steps

1. Inspect `judge_results.json` structure (one `head`/`python -c` to see keys + verdict vocabulary).
2. Write a one-off analysis (python inline is fine — read-only, not production): join queries × ground_truth × retrieval × judge; bucket into the 2×2 per tier.
3. Also do it for the **candidate** run `20260615020817-6TN8JSC9` to see whether rerank's @5 demotions actually cost *correct answers* (reader gaps created), not just recall points.
4. Report a per-tier table + a one-paragraph verdict: "T1–T3 errors are X% reader / Y% retrieval → next effort should go to {reader|retrieval}."

## Success / output

A short written finding (and ideally save it as a memory if non-obvious): the reader-vs-retrieval split per tier, and an explicit recommendation on whether #2/#3 (retrieval ranking) are worth pursuing or whether the bottleneck is the reader. **No code committed; no config changed.**
