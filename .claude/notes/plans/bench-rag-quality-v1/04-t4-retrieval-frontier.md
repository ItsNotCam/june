---
title: "Action #4: T4 — the actual retrieval frontier"
type: reference
status: done
tags: [project/june, area/research, tech/retrieval, tech/rag]
project: june
area: research
created: 2026-06-17
summary: Action plan for the T4 multi-hop retrieval frontier (bridge-lookup) — implemented and gemma-certified in the bench-multihop work.
keywords: [T4, multi-hop, retrieval frontier, bridge lookup, reader composition, worktree, action plan]
aliases: [bench action 4]
---

# Action #4: T4 — the actual retrieval frontier

**Status:** ready. Independent of #1/#2/#3 code-wise. Good candidate for its own git worktree.
**Independent:** yes — touches retriever (multi-hop) and/or reader composition. Running it needs the shared runtime + `state/` wired in.

---

## Shared context (true for all four action plans)

- **Repo:** `/home/cam/june/packages/mcp/bench`. Bun, `june-eval` CLI.
- **Gauge discipline (READ FIRST):** `packages/mcp/bench/CLAUDE.md` + memory `bench-is-gauge-not-goal`. Justify on RAG merit first; read the gauge to confirm direction + no regression. Never change two of {summarizer, retrieval, reader} in one measured run.
- **Fixture:** `state/fixtures/RP6PNN3KW7Q2JS2R0GQ3Z00JZG` (180 q, 50/50/40/40, no T5). **T4 = multi-hop:** needs BOTH a relational chunk (`f-rel-*`, `expected_fact_ids[0]`) and an atomic chunk (`f-atomic-*`, `expected_fact_ids[1]`) in the reader window. T4 recall rule = **all** expected ids in top-k (`computeRecall`, `src/stages/06-retrieval.ts:93`).
- **Frozen ingest** for `--skip-ingest`: `20260614180533-Z61RJC6F`. Qdrant up at `localhost:6333`.
- **Consistency notes:** `config.yaml` + `state/` are **gitignored** (not in fresh worktrees — symlink `state/` and supply `config.yaml`). Qdrant + Ollama shared; serialize runs.

---

## Why this task

T1–T3 retrieval is essentially solved (recall@5 ≈ 100%). **T4 is where retrieval genuinely fails.** Current state (memory `bench-multihop-regresses-t4`):
- multi_hop **OFF**: T4 recall@5 ≈ 30% — single-pass dense+BM25 can't surface the atomic chunk because the bridge entity isn't in the query text.
- multi_hop **ON** ("anchored bridge injection", `src/retriever/multi-hop.ts`): T4 recall@5 ≈ 82.5%, and reader composition was fixed (T4 correct% 0→77.5% via reader.md bridge-stating) with no T1–T3 regression.

So there are two remaining frontiers on T4:
1. **Retrieval:** push recall@5 past ~82% — the atomic chunk still isn't injected ~18% of the time (bridge-entity extraction or atomic sub-query retrieval failing).
2. **Reader:** T4 correct% (~77.5%) trails retrieval — even with both chunks in-window the reader sometimes fails to compose the bridge.

## Goal

Improve T4 end-to-end (recall@5 and/or correct%) **without regressing T1–T3**, choosing ONE lever per measured run (gauge rule):
- Retrieval lever: diagnose the ~18% of T4 queries where multi_hop ON still misses the atomic chunk (bridge extraction failure? atomic sub-query miss? injection slot collision?). The planner is `deepseek-v4-flash`; failure paths degrade to single-hop. `scripts/triage-failures.ts` (already in tree) may help; `scripts/rerank-repro.ts` is a model for per-query inspection.
- Reader lever: of T4 queries with both chunks in-window but wrong answer, characterize the composition failure and refine the reader prompt (`prompts/reader.md`) — mirroring the prior bridge-stating fix.

## Mechanics

- A/B on the frozen ingest with multi_hop **ON** (this is the realistic T4 config), changing only the one lever under test:
  ```bash
  cd /home/cam/june/packages/mcp/bench
  bun cli/bench.ts run state/fixtures/RP6PNN3KW7Q2JS2R0GQ3Z00JZG \
    --skip-ingest 20260614180533-Z61RJC6F --cache --yes --config <your-config>
  ```
- **Determinism caveat:** multi_hop uses an LLM planner (`deepseek-v4-flash`), so T4 retrieval is *non-deterministic*. Pin it with `--cache` so planner calls are reproducible before trusting a T4 delta (see reranker handoff §2).
- Read `per_tier.T4.{recall_at_5, mrr}` + T4 correct% from `results.json` / `summary.md`. Confirm T1–T3 unchanged.

## Reference

- `src/retriever/multi-hop.ts` (`createMultiHopRetriever`; constants `HOP_FETCH_K=5`, `BRIDGE_LOOKUP_TOP=3`, `INJECT_SLOTS=1`).
- `src/stages/06-retrieval.ts` (recall/MRR; T4 = `.every`).
- `prompts/reader.md` (bridge-stating composition).
- Memory `bench-multihop-regresses-t4` for the prior fix history.

## Success / output

A measured T4 improvement (recall@5 and/or correct%) on the frozen ingest with no T1–T3 regression, attributable to a single lever. Document which failure mode was fixed. **Interacts with the reranker only in Phase-2 nesting (out of scope here — keep multi_hop the only retrieval change).**
