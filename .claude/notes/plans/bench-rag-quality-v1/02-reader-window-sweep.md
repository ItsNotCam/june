---
title: "Action #2: Reader-window sweep (k = 5 → 3 → 1)"
type: reference
status: archived
tags: [project/june, area/research, tech/retrieval, tech/bench]
project: june
area: research
created: 2026-06-17
summary: De-prioritized action plan — a reranker-orbiting window sweep; #1 showed T2 headroom is the reader, not ranking.
keywords: [reader window, sweep, reranker, de-prioritized, ranking precision, action plan, k sweep]
aliases: [bench action 2]
---

# Action #2: Reader-window sweep (k = 5 → 3 → 1) — does ranking precision matter?

> **DE-PRIORITIZED by Action #1 (see memory `bench-reader-is-t2-bottleneck`).** #1 showed
> T1/T3 are solved and T2's headroom is the *reader*, not retrieval ranking. This sweep
> orbits the reranker, which can't fix reader gaps. Keep only if reranking becomes a
> strategic priority; otherwise the reader (#5) is the lever. One residual value: a
> *tighter* window might reduce reader confusion from distractor chunks — but treat that
> as a reader experiment, not a reranker one.

**Status:** ready. Soft-depends on #1's conclusion (run only if #1 shows retrieval/ranking is worth pursuing; can also run speculatively — it's cheap).
**Independent:** code-wise yes (config only, no source changes). Needs the shared runtime + frozen ingest. No worktree required.

---

## Shared context (true for all four action plans)

- **Repo:** `/home/cam/june/packages/mcp/bench`. Bun runtime, `june-eval` CLI.
- **Gauge discipline (READ FIRST):** `packages/mcp/bench/CLAUDE.md` + memory `bench-is-gauge-not-goal`. Optimize real RAG, never the %. **Never change two of {summarizer, retrieval, reader} in one run.**
- **Fixture:** `state/fixtures/RP6PNN3KW7Q2JS2R0GQ3Z00JZG` — 180 queries, 50/50/40/40 (T1–T4), no T5.
- **Frozen ingest** for `--skip-ingest`: `20260614180533-Z61RJC6F` (scratch + Qdrant collections present). Qdrant must be up at `localhost:6333` (`docker compose up -d qdrant`).
- **Baseline runs on disk:** `20260615020227-HZ8P069Z` (rerank OFF, mh OFF), `20260615020817-6TN8JSC9` (rerank ON, mh OFF). Reranker is built but ships OFF (memory `bench-unfair-to-rerankers`).
- **Current numbers (mh OFF):** recall@5 saturated T1–T3 (100/100/97.5), recall@1 weak (T2=62, T3=70). Reader window `reader_eval.k = 5`.
- **Consistency notes:** `config.yaml` + `state/` are **gitignored** (not in fresh worktrees). Qdrant + Ollama are single shared instances — **serialize runs**. `--config <path>` selects the config file; there is **no `--reader-k` flag**, so reader k is set via config only.

---

## Why this task

The reranker's win is concentrated in recall@1 / MRR, but the reader reads the **top-5**, and recall@5 is already saturated on T1–T3 — so a better #1 ranking has nowhere to land, while a mis-rank can knock the answer *out* of the 5-window. This task tests the core question: **does ranking precision matter if we shrink the window?** A tighter window that holds correct% would mean less context (cheaper, faster, less reader distraction) and would give the reranker a real home.

## Goal

Measure end-to-end on the frozen ingest, varying `reader_eval.k ∈ {5, 3, 1}`, both **rerank OFF** and **rerank ON** (multi_hop OFF throughout, to isolate single-pass ranking). 6 cells. Read recall@k *and* `correct%` per tier.

Hypotheses to resolve:
- If **rerank ON + small k ≥ rerank OFF + k=5** on correct% → ranking precision pays; the reranker has value once the window is tight.
- If correct% collapses as k shrinks regardless of rerank → the reader needs the redundancy; ranking isn't the lever here.

## Mechanics

- Reader k is **config-only** (no CLI flag). To avoid contention on the single gitignored `config.yaml`, make per-cell config files and pass `--config`:
  - Copy the live `config.yaml` to e.g. `/tmp/cfg-k5-rerankoff.yaml`, `/tmp/cfg-k3-rerankon.yaml`, … editing `reader_eval.k` and `retrieval.rerank.enabled` per cell. Keep `multi_hop.enabled: false` in all.
- Run each cell on the frozen ingest (serialize — shared Qdrant/Ollama/CPU):
  ```bash
  cd /home/cam/june/packages/mcp/bench
  bun cli/bench.ts run state/fixtures/RP6PNN3KW7Q2JS2R0GQ3Z00JZG \
    --skip-ingest 20260614180533-Z61RJC6F --cache --yes --config /tmp/cfg-k3-rerankon.yaml
  ```
  (`--cache` reuses reader/judge LLM calls where inputs repeat.)
- Read per-tier `correct%` and recall from each run's `results.json` (`per_tier.{T1..T4}.{recall_at_*,...}.point`; correct% lives in the scoring output — confirm the exact key, it was `-` in the quick per_tier dump used for retrieval-only, so check `summary.md` / scoring section).

## Notes / gotchas

- Reranker A/B already showed rerank-ON regresses T2/T3 recall@5 at k=10 — but the *reader-relevant* question is correct% at each window, not recall.
- Determinism: retrieval is deterministic on a frozen ingest; reader/judge have variance, so use `--cache` and treat small correct% deltas cautiously (consistency noise floor — see `bench/CLAUDE.md`).
- This is 6 serialized full-pipeline runs (~each includes reader + judge). Budget the time; `--cache` cuts repeat cost.

## Success / output

A 6-cell table (k × rerank) of per-tier correct% (+ recall), and a verdict: does a tighter reader window + reranker preserve or improve correct% vs the k=5 baseline? Decide whether reranking earns a place once the window is right. **No source changes; config files are throwaway (`/tmp`).**
