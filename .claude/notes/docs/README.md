---
title: june — System Documentation
type: reference
status: active
tags: [project/june, area/research, meta/index]
project: june
area: research
created: 2026-06-17
summary: Documentation map for the entire june system — start here, then dive into a subsystem.
keywords: [documentation, index, table of contents, overview, june, system map]
aliases: [docs home, documentation map]
---

# june — System Documentation

> **june** is a self-hosted, RAG-focused developer knowledge platform: an elite
> markdown-ingestion pipeline + dense metadata + a small **local** reader model that
> answers questions about your docs as well as a frontier model — with nothing leaving
> the machine. A synthetic-corpus benchmark keeps that claim honest.

This is the documentation map for the **entire system** — not just the RAG pipeline.
Start with the architecture overview, then dive into whichever subsystem you need.

---

## Table of contents

| # | Doc | What it covers |
|---|---|---|
| 01 | **[System Architecture](./01-architecture.md)** | The monorepo, the Docker services, the three data stores (Qdrant / SQLite / bench scratch), the two stage-numbered pipelines, and how an ingest/eval request flows end to end. **Read this first.** |
| 02 | **[Ingestion Pipeline](./02-ingestion-pipeline.md)** — `@june/mcp-ingest` | The core product. The `june` CLI, the 7-stage pipeline (discover → parse → chunk → summarize → embed-text → embed → store), the SQLite sidecar + Qdrant data model, embedding/BM25, summarizer backends, config & errors. |
| 03 | **[Bench & Evaluation](./03-bench-evaluation.md)** — `@june/mcp-bench` | The `june-eval` CLI, the 9-stage eval pipeline, the **reader-by-purpose** (iterate vs control) discipline, the query tiers (T1–T5) & metrics, the LLM judge, providers, and the retriever (incl. the stopgap/multi-hop/reranker pieces). |
| 04 | **[Frontend](./04-frontend.md)** — `@june/next` | The Next.js 16 app: the **Test Dashboard** (live bench runs over SSE), the **Ingest UI** (upload → index via the NDJSON web bridge), the **Preview** showcase, the theme system, and the spawn-a-child-and-stream backend pattern. |
| 05 | **[MCP Server](./05-mcp-server.md)** — `@june/mcp-server` | The MCP scaffold: working stdio tools (`hello-world`, `embed`), and the designed-but-unwired pipeline integration + HTTP transport. |
| 06 | **[Shared Layer & Conventions](./06-shared-and-conventions.md)** — `@june/shared` | The `createEnv` / `createConfig` / `createLogger` factories every package extends, plus the repo-wide coding standards (Zod boundaries, no-`any`, concurrency rules, the parity rule). |
| 07 | **[Dev Workflow](./07-dev-workflow.md)** | The conventional-commit workflow, the README-after-commit rule, and the bench reader-mode discipline. |
| 08 | **[Planning, Research & Results](./08-planning-artifacts.md)** | An index of the specs, research briefs, diagnostic findings, and benchmark results under `.claude/` and the repo root — the *why* behind the code. |

---

## The 30-second model

```
                ┌───────────────────────────── @june/next (frontend) ─────────────────────────────┐
                │   /ingest  (Ingest UI)              /test  (Test Dashboard)                       │
                └──────┬───────────────────────────────────────┬───────────────────────────────────┘
                       │ spawn + NDJSON                         │ spawn + NDJSON/SSE
                       ▼                                        ▼
           ┌────────────────────────┐                ┌────────────────────────┐
           │   @june/mcp-ingest     │   Stage 4      │    @june/mcp-bench      │
           │   `june` CLI           │◄───delegates───│    `june-eval` CLI      │
           │   7-stage pipeline     │                │    9-stage eval         │
           └─────────┬──────────────┘                └────────────┬───────────┘
                     │ embeds + stores                            │ retrieves / reads / judges / scores
                     ▼                                            ▼
       ┌─────────────────────────────┐                ┌─────────────────────────┐
       │ Qdrant (internal/external)  │                │ bench scratch (state/)  │
       │ SQLite sidecar (june.db)    │                │ LLM response cache      │
       └─────────────────────────────┘                └─────────────────────────┘
                     ▲
                     │ embeddings + summaries + reader
           ┌─────────────────────┐
           │ Ollama (home GPU box)│  embed · summarize · gemma4:26b reference reader
           └─────────────────────┘

   @june/mcp-server (scaffold) will expose the ingest pipeline as MCP tools.
   @june/shared underlies ingest, bench, and server (env / config / logger).
```

- **`@june/mcp-ingest`** is the product. **`@june/mcp-bench`** is the gauge — it
  *delegates ingestion to the `june` CLI* at Stage 4, so the two pipelines share one
  meeting point.
- **The frontend never does heavy work in-process** — it spawns the CLIs and relays
  their streams.
- **Everything is self-hosted**: Qdrant for vectors, SQLite for metadata, Ollama for
  all core inference. No hosted LLM is required for the product (the bench uses hosted
  models only as an iteration scratchpad and as the judge).

---

## For contributors

- Conventions and the `lib/env.ts` / `lib/config.ts` / `lib/logger.ts` patterns live in
  [06 — Shared Layer & Conventions](./06-shared-and-conventions.md); the enforcing
  rules are in [`.claude/rules/`](../rules/).
- Commit conventions and the README-after-commit rule are in
  [07 — Dev Workflow](./07-dev-workflow.md).
- Running the bench? Declare your intent (`--mode iterate` vs `--mode control`) — see
  [03 §3](./03-bench-evaluation.md#3-reader-by-purpose-the-iterate--control-discipline).
  **Bench is a gauge, not a goal.**
