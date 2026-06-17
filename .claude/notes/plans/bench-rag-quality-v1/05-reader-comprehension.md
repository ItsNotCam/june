---
title: "Action #5: Reader comprehension — the real T1–T3 quality lever"
type: reference
status: active
tags: [project/june, area/research, tech/reader, tech/rag]
project: june
area: research
created: 2026-06-17
summary: Top-priority action plan to improve reader comprehension (prompts/reader.md) — the real T1–T3 lever per diagnostic #1.
keywords: [reader comprehension, T1, T2, T3, top priority, reader prompt, quality lever, action plan]
aliases: [bench action 5]
---

# Action #5: Reader comprehension — the real T1–T3 quality lever

**Status:** ready. **NEW TOP PRIORITY** per Action #1 (memory `bench-reader-is-t2-bottleneck`).
**Independent:** yes — touches the reader only (`prompts/reader.md`). Running it needs the
shared runtime + frozen ingest; no worktree required (reader is config/prompt, not retriever).

---

## Shared context (true for all action plans)

- **Repo:** `/home/cam/june/packages/mcp/bench`. Bun, `june-eval` CLI.
- **Gauge discipline (READ FIRST):** `packages/mcp/bench/CLAUDE.md` + memory `bench-is-gauge-not-goal`.
  Optimize real comprehension; do NOT game refusal/format detection to flip verdicts. **Never
  change two of {summarizer, retrieval, reader} in one measured run** — freeze retrieval here.
- **Fixture:** `state/fixtures/RP6PNN3KW7Q2JS2R0GQ3Z00JZG` (180 q, 50/50/40/40, no T5).
- **Frozen ingest** for `--skip-ingest`: `20260614180533-Z61RJC6F`. Qdrant up at `localhost:6333`.
- **Runs on disk:** baseline `20260615020227-HZ8P069Z` (rerank OFF, mh OFF). Judge = deepseek
  (validated κ=0.894 vs Sonnet; memory `bench-judge-deepseek-mirrors-sonnet`).
- **Consistency notes:** `config.yaml` + `state/` gitignored; Qdrant + Ollama shared, serialize runs.

---

## Why this task (the #1 finding)

Action #1 cross-tab proved **T1/T3 are solved and T2's entire remaining headroom is the
READER, not retrieval**: all 5 T2 failures had the answer chunk in the reader's top-5 window
and the reader still missed it. Retrieval ranking (the reranker) cannot fix these. So the
reader is the binding constraint on T1–T3 quality.

## The concrete failures (already triaged from `20260615020227-HZ8P069Z`)

Two T2 reader failure modes (answer was at rank 1–2 in-window):
1. **Relation-direction errors** — reader reverses the relation in anti-leakage *paraphrase*
   queries:
   - q-0093 "which component has Wexmar **rendered obsolete**?" → reader: "Viznet Exchange
     supersedes Wexmar" (gives what supersedes Wexmar, i.e. the opposite direction).
   - q-0055 "which lower-level component does Snorblath **build upon**?" → wrong component.
   - q-0073 "which existing component does Dargwave **build on top of**?" → wrong component.
2. **Over-refusal / extraction miss** — numbered-port facts present but reader refuses:
   - q-0079 "which **numbered listener** does Froznet v2 dedicate to management signaling?"
   - q-0086 "which **numbered TCP listener** does Glorbulon dedicate to command-plane traffic?"
   - Both REFUSED ("context does not contain…") despite the port chunk at rank 2 — likely
     confused by a *different* protocol's port in a neighboring in-window chunk.

(Also worth pulling: T4 in-window-but-wrong cases — composition failures where both the
relational and atomic chunk are present but the reader doesn't bridge them.)

## Goal

A single-lever reader change (most likely `prompts/reader.md`) that:
- Correctly maps **paraphrased relation direction** (X "builds upon"/"is rendered obsolete by"
  Y vs the inverse) — answer the relation the query actually asks for.
- **Curbs over-refusal** when the asked-for fact (e.g. a numbered port for a named protocol)
  IS present, while still refusing genuinely-absent facts and not getting fooled by a
  neighboring chunk about a *different* protocol's port.

Do this without leaking answers or weakening genuine refusal (gauge rule) — improve
*comprehension*, not refusal-detection gaming.

## Mechanics

1. Read `prompts/reader.md` and the reader stage (`src/stages/07-reader.ts`) to see the exact
   prompt + how context chunks are presented.
2. Triage fully (read-only) from the baseline run: for each in-window-but-wrong query, dump
   the query, the in-window chunk texts, and the reader's answer + judge rationale. Confirm the
   two failure modes and whether neighboring-protocol distractors are the refusal cause.
3. Make ONE reader-prompt change. Freeze retrieval (multi_hop OFF, rerank OFF) so the reader is
   the only moving part.
4. A/B on the frozen ingest:
   ```bash
   cd /home/cam/june/packages/mcp/bench
   bun cli/bench.ts run state/fixtures/RP6PNN3KW7Q2JS2R0GQ3Z00JZG \
     --skip-ingest 20260614180533-Z61RJC6F --cache --yes
   ```
   Compare per-tier `correct%` vs baseline `20260615020227-HZ8P069Z`.
5. **Consistency caveat:** correct% has reader/judge variance — know the noise floor
   (`bench/CLAUDE.md`: run twice reusing one ingest, compare correct%). A change must clear it.

## Reference

- `prompts/reader.md`, `src/stages/07-reader.ts`.
- Prior reader fix pattern: bridge-stating for T4 composition (memory `bench-multihop-regresses-t4`).
- #1 analysis + this triage: memory `bench-reader-is-t2-bottleneck`.

## Success / output

T2's 5 reader-gaps convert to CORRECT (and any T4 composition gaps improve) with **no T1/T3
regression and no weakening of genuine refusals**, clearing the consistency noise floor. This
is the real, generalizable quality win — improving comprehension, not the bench score.
