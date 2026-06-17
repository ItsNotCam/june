---
title: Planning, Research & Results Artifacts
type: reference
status: active
tags: [project/june, area/research, meta/index]
project: june
area: research
created: 2026-06-17
summary: Index of the specs, research briefs, audit findings, and benchmark results under .claude/ — the rationale behind the code.
keywords: [planning, artifacts, specs, research brief, audit, results, index, rationale]
aliases: [planning artifacts, artifact index]
---

# Planning, Research & Results Artifacts

> An index of the design specs, research briefs, diagnostic findings, and benchmark
> results that live under `.claude/` and the repo root. These are the *why* behind the
> code — read them when you need the rationale, not just the behavior.

---

## 1. Authoritative specs (`.claude/plans/`)

| File                                                                | What it is                                                                                                                                                                                      |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`INGESTION_PIPELINE_SPEC.md`](INGESTION_PIPELINE_SPEC.md) | The 10-stage ingestion design (~265 KB): data model, constraints, stage contracts, CLI. The source of truth behind [02 — Ingestion pipeline](./02-ingestion-pipeline.md).                       |
| [`BENCH_SPEC.md`](BENCH_SPEC.md)                           | The synthetic-corpus eval design (~120 KB): fact/corpus/query generation, retrieval+reader eval, LLM judging, bootstrap-CI scoring. Behind [03 — Bench & evaluation](./03-bench-evaluation.md). |

### Ingestion design dossier (`.claude/plans/ingestion-pipeline-v1/`)

- `CONSTRAINTS.md` — the 8 core constraints (audience, 14B reader as north star,
  Opus-quality on ingested data, no external services, markdown input, graceful
  degradation, 10–500 page range).
- `RESEARCH_BRIEF.md` — chunking literature, embedding/contextual-retrieval practice,
  BM25/hybrid ranking, Qdrant + SQLite design, failure modes, cost.
- `SKELETON.md` — the spec outline / authoring checklist.
- `AUDIT_FINDINGS.md` / `AUDIT_REPORT.md` — resolved design decisions (G1–G20):
  full re-ingest on content-hash change, single-writer lock, two-pass summarization,
  offline enforcement, …
- `TEST_BRIEF.md` — the per-stage testing philosophy.
- `CONTINUATION_PLAN.md`, `HANDOFF_CHAT3.md` — authoring handoffs.

### Bench design dossier (`.claude/plans/ingestion-pipeline-benchmark-v1/`)

- `HANDOFF_BENCH_SPEC.md` — the brief that seeded `BENCH_SPEC.md` (three use cases,
  proposed TOC, provenance).

---

## 2. Active improvement plans (`.claude/plans/`)

Lightweight, independent-by-design task briefs that A/B against a frozen ingest. Ranked
by the diagnosis in #01.

| Plan | Thrust | Status |
|---|---|---|
| `01-diagnose-reader-vs-retrieval.md` | Cross-tab retrieval-hit × reader-correct per tier to isolate the bottleneck. | **Done — drove the others.** Found T1/T3 solved, T2 reader-bound, T4 retrieval-bound. |
| `05-reader-comprehension.md` | Fix T2 reader gaps (relation-direction errors, over-refusal) via `prompts/reader.md`. | **Top priority** per #01. |
| `04-t4-retrieval-frontier.md` | Improve multi-hop T4 recall + reader composition. | Independent. |
| `02-reader-window-sweep.md` | Does ranking precision matter as the reader window shrinks k=5→1? | De-prioritized (depends on #01). |
| `03-fairer-reranker-gauge.md` | Redesign the corpus so a cross-encoder reranker can fairly win. | De-prioritized; largest effort. |
| `reranker-second-pass-handoff.md` | Reranker implementation handoff (decorator over the retriever). | Design not started. |

The bottleneck diagnosis is corroborated by memory *[Reader is the T2 bottleneck]*.

---

## 3. Diagnostic findings (`.claude/findings/`)

- [`judge-grounding-fix.md`](../findings/judge-grounding-fix.md) — the judge was scoring
  true, grounded details as `HALLUCINATED` because it only saw the short
  `surface_hint`, never the retrieved chunk. Hydrating the judge with full chunk text
  collapsed false-negatives 25→0 across T1–T3 and shifted the bottleneck to retrieval.

---

## 4. Results & overview (repo root)

- [`results.md`](../../results.md) — the 2026-04-26 deep-dive: T1 recall@5 went
  0.38 → 1.00 after fixing three compounding bugs (parent/child chunk duplication;
  missing `query:` prefix on the asymmetric embedder; polluted contextual summaries
  echoing the prompt). The retrieval-quality turning point.
- [`README.md`](../../README.md) — project overview + AI-usage disclosure.
- `.claude/synopsis.md` — full project synopsis (problem, solution, architecture, query
  modes, roadmap).

---

## 5. Rules (`.claude/rules/`)

- [`code-style.md`](../rules/code-style.md) — the TypeScript standard (summarized in
  [06 — Shared layer & conventions](./06-shared-and-conventions.md)).
- [`ui-style.md`](../rules/ui-style.md) — shadcn + Tailwind semantic-token rule for
  `packages/next/**`.
