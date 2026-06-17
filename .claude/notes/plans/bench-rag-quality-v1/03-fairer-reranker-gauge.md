---
title: "Action #3: Make the gauge able to score a reranker fairly"
type: reference
status: archived
tags: [project/june, area/research, tech/bench]
project: june
area: research
created: 2026-06-17
summary: De-prioritized gauge-investment plan — fair reranker scoring; low-leverage on this fixture per #1 (reader is the lever).
keywords: [reranker, fair gauge, scoring, de-prioritized, gauge investment, corpus generation, action plan]
aliases: [bench action 3]
---

# Action #3: Make the gauge able to score a reranker fairly

> **DE-PRIORITIZED by Action #1 (see memory `bench-reader-is-t2-bottleneck`).** #1 showed
> retrieval ranking is low-leverage on this fixture (T1/T3 solved, T2 reader-bound), so a
> fair *reranker* gauge doesn't move current quality. Retain this ONLY if reranking is a
> strategic priority for june's real retrieval — it's a gauge-investment, not a
> near-term quality win. The near-term lever is the reader (#5).

**Status:** ready (largest effort). Independent of #1/#2/#4 code-wise. Good candidate for its own git worktree.
**Independent:** yes — touches corpus *generation*, not retriever/reader. But running it needs the shared runtime + `state/` wired into the worktree.

---

## Shared context (true for all four action plans)

- **Repo:** `/home/cam/june/packages/mcp/bench`. Bun, `june-eval` CLI. Generation lives in `src/domains/` + the early `src/stages/01–0x` (fact → corpus → query generation); the `generate` subcommand is `cli/generate.ts`.
- **Gauge discipline (READ FIRST):** `packages/mcp/bench/CLAUDE.md` + memory `bench-is-gauge-not-goal`. The corpus is *fictional facts in a narrow question style* — a higher score can mean a worse product. Do NOT design the new corpus to make the reranker look good; design it to be a *faithful* test of real-world relevance ranking, then read the gauge.
- **Existing fixture:** `state/fixtures/RP6PNN3KW7Q2JS2R0GQ3Z00JZG` (180 q, 50/50/40/40, no T5). Generator domain in v1 is the "Glorbulon Protocol" synthetic family.
- **Consistency notes:** `config.yaml` + `state/` are **gitignored** → a fresh worktree starts without the fixtures/ingests/config. Symlink `state/` → main checkout's `state/` and provide a `config.yaml` before running. Qdrant + Ollama shared — serialize runs.

---

## Why this task (the core finding it addresses)

Memory `bench-unfair-to-rerankers`: a cross-encoder reranker regresses T2/T3 recall@5 **only because the synthetic corpus clones every fictional protocol into identical section headings** (`### Maximum Packet Size`, `### Compression`, `## Overview`) whose *sole* discriminator is a made-up proper noun (`Wexmar`, `Plirnode`). A model trained on real text gets zero signal from those names, falls back to section-topic matching, and ranks "the right section of the WRONG protocol" first (verified by reproducing per-query cross-encoder scores; `scripts/rerank-repro.ts`).

Consequence: **we currently cannot tell whether a reranker helps real-world RAG**, because the gauge structurally neutralizes a cross-encoder's main advantage. Fix the gauge.

## Goal

Add a corpus/tier where **being the right answer requires real semantic understanding the model can actually bring** — i.e., the discriminator is genuine content/meaning, not a fictional token. Options (pick/justify on merit, not on what flatters the reranker):

1. **Real-entity variant of the domain** — use real (or realistic) named tools/algorithms/standards so entity names carry learned signal, with distractors that are genuinely *less relevant* (not just same-section-different-name).
2. **Semantic-distractor tier** — keep synthetic entities but make distractors differ by *meaning* (the wrong chunk is plausibly on-topic but answers a different question), so a cross-encoder's joint query–passage reading is the thing that separates right from wrong.
3. **Paraphrase-gap tier** — query and answer share concept but not surface form, where a cross-encoder should outperform embeddings/BM25.

The bar: on the new corpus, a competent reranker should be *able* to win if it's genuinely good — and a bad one should lose. Validate by sanity-running the existing cross-encoder on a handful of new queries (à la `scripts/rerank-repro.ts`) and confirming the answer chunk is separable on *meaning*.

## Integration points

- Generator: `src/domains/` (fact/corpus templates) + the generate stages; `cli/generate.ts` to emit a new fixture. Mirror the existing tier structure; tag the new tier distinctly so `06-retrieval.ts` scoring + per-tier reporting pick it up.
- Keep the anti-leakage machinery (don't leak the expected fact into where it shouldn't be) — the goal is a fair *reranker* test, not an easy one.
- Generate a new fixture, ingest it (full run, not `--skip-ingest`), then A/B rerank OFF vs ON on it (protocol from `02`/the reranker handoff) and confirm the gauge now *moves the right way* when reranking actually helps.

## Reference

- Reranker mechanics + decorator: `src/retriever/reranker.ts`, `src/retriever/scorer.ts`, config `retrieval.rerank` in `src/schemas/config.ts`. Diagnostic: `scripts/rerank-repro.ts`.
- The original reranker design/justification + A/B protocol: `.claude/plans/reranker-second-pass-handoff.md`.

## Success / output

A new fixture (or new tier) on which a reranker's quality is *measurable* — verified by showing (a) the answer chunk is separable by meaning, and (b) the gauge rewards a good reranker and penalizes a bad one. Then re-run the reranker A/B on it for a real verdict. **Largest, most open-ended of the four — scope a design before building.**
