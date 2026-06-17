---
title: System Architecture
type: reference
status: active
tags: [project/june, area/research, tech/architecture, tech/rag]
project: june
area: research
created: 2026-06-17
summary: How the june monorepo, services, data stores, and the disk→graded-answer flow fit together.
keywords: [monorepo, bun workspace, rag, ingestion pipeline, reader model, mcp-bench, self-hosted, knowledge platform]
aliases: [june architecture, system overview]
---

# System Architecture

> How the whole of **june** fits together — the monorepo, the services, the data
> stores, and the flow of a document from disk to a graded answer.

June is a **self-hosted, RAG-focused developer knowledge platform**. The thesis:
an *elite ingestion pipeline* + *dense metadata* + a *small local reader model*
can answer questions about your documentation as well as a frontier model — with
no cloud dependency, no data leaving the machine. The benchmark (`@june/mcp-bench`)
exists to keep that thesis honest.

---

## 1. The monorepo

June is a **Bun workspace**. The root `package.json` declares:

```jsonc
{
  "name": "june",
  "type": "module",
  "private": true,
  "workspaces": ["packages/*", "packages/mcp/*"]
}
```

Two glob patterns produce a nested package layout:

```
june/                          ← Bun workspace root
  packages/
    next/        @june/next         Next.js 16 frontend (Test Dashboard, Ingest UI, Preview)
    shared/      @june/shared       env / config / logger / shared types (the base layer)
    server/      (empty placeholder — reserved, no package.json yet)
    mcp/         (umbrella — no package.json at this level)
      ingest/    @june/mcp-ingest   markdown ingestion pipeline + the `june` CLI
      bench/     @june/mcp-bench    synthetic-corpus RAG eval + the `june-eval` CLI
      server/    @june/mcp-server   MCP JSON-RPC server (scaffold; stdio tools only)
```

Every package is `"type": "module"`, TypeScript **strict**, and runs on the **Bun**
runtime. (Node 18 on this machine is too old for Next.js 16, which needs ≥20.9 —
Bun sidesteps that.)

### Dependency graph

| Package | Depends on |
|---|---|
| `@june/shared` | — (base layer) |
| `@june/mcp-ingest` | `@june/shared` |
| `@june/mcp-bench` | `@june/shared` |
| `@june/mcp-server` | `@june/mcp-ingest`, `@june/shared` |
| `@june/next` | `@june/mcp-ingest` |

`@june/shared` sits at the bottom — everything that needs env/config/logging
extends it. `@june/mcp-ingest` is the core product; both the frontend and the MCP
server wire into it. `@june/mcp-bench` is isolated for evaluation.

See **[06 — Shared layer & project conventions](./06-shared-and-conventions.md)** for the
`createEnv` / `createConfig` / `createLogger` factories that every package consumes.

---

## 2. The runtime services

`docker-compose.yml` defines the local service mesh. All services share `.env` via a
YAML anchor.

| Service | Image / build | Ports | Role |
|---|---|---|---|
| **qdrant** | `qdrant/qdrant:latest` | 6333 (REST), 6334 (gRPC) | Vector DB. Persists to `./qdrant_storage`. |
| **next** | `packages/next/Dockerfile.dev` | 3000 | Frontend. |
| **mcp-ingest** | `packages/mcp/ingest/Dockerfile.dev` | — | Ingestion CLI (TTY). Depends on qdrant. |
| **mcp-server** | `packages/mcp/server/Dockerfile.dev` | — | MCP server scaffold. Depends on qdrant. |
| **ollama** | `ollama/ollama:latest` | 11434 | Commented out by default; GPU stanza present. |

`.env` (root):

```bash
QDRANT_URL=http://localhost:6333
# QDRANT_API_KEY=your_key_here
OLLAMA_URL=https://ollama.your-lan.example   # remote home GPU box
```

Ollama is **not** run in Docker by default — it points at a remote home server
(`ollama.your-lan.example`) that hosts the embedding, summarizer, and reference reader
models. This is the BYO-AI posture: one GPU box, several local models, no hosted LLM
inference required for the core product.

---

## 3. The three data stores

June keeps state in three places, each with a clear ownership boundary:

1. **Qdrant** (`qdrant_storage/`) — the vector index. Two collections, addressed
   through aliases:
   - `internal` → `internal_v1`
   - `external` → `external_v1`

   Each collection holds **1024-dim dense** vectors (cosine) **and** a **BM25 sparse**
   vector (IDF modifier) for hybrid search. HNSW `m=16`, `ef_construct=100`, payload
   on-disk. The `_v1` suffix + alias indirection is what makes a zero-downtime
   embedding-model swap possible (build `_v2`, re-embed, swap alias — see
   [02 — Ingestion pipeline](./02-ingestion-pipeline.md), `re-embed`).

2. **SQLite sidecar** (`june.db`) — the **system of record** for document/chunk
   *metadata, lifecycle state, provenance, and the single-writer lock*. Qdrant holds
   vectors + payload; SQLite holds raw chunk content (for re-embed) and the full
   audit trail. Schema and lifecycle in [02 — Ingestion pipeline](./02-ingestion-pipeline.md).

3. **Bench scratch** (`packages/mcp/bench/state/`, gitignored) — per-run eval
   artifacts, an LLM response cache, and a scratch SQLite/Qdrant namespace. Never the
   system of record for anything user-facing.

---

## 4. Two pipelines, end to end

June has **two** stage-numbered pipelines. Don't confuse them — both use
`NN-name.ts` files but they live in different packages and do different things.

### The ingestion pipeline (`@june/mcp-ingest`)

Markdown file → embedded chunks in Qdrant + metadata in SQLite.

```
01 discover → 02 parse → 03 chunk → 06 summarize → 08 embed-text → 09 embed → 10 store
```

Driven by the **`june`** CLI (`init`, `ingest`, `status`, `resume`, `reindex`, `purge`,
`reconcile`, `re-embed`, `health`, `bench`). Full detail:
**[02 — Ingestion pipeline](./02-ingestion-pipeline.md)**.

### The evaluation pipeline (`@june/mcp-bench`)

Synthetic facts → corpus → queries → ingest → retrieve → read → judge → score.

```
01 facts → 02 corpus → 03 queries     (fixture generation, deterministic)
04 ingest → 05 resolve → 06 retrieval → 07 reader → 08 judge → 09 score   (evaluation)
```

Driven by the **`june-eval`** CLI (`generate`, `run`, `report`, `compare`,
`control-pin`, `control-check`, `health`). It *delegates* Stage 4 to the `june` CLI —
the two pipelines meet here. Full detail:
**[03 — Bench & evaluation](./03-bench-evaluation.md)**.

---

## 5. How a request flows through the system

**Ingesting documents (via the web UI):**

```
Browser (/ingest)
  → POST /api/ingest  (Next.js Node route, multipart upload)
  → stages bytes to disk, spawns the @june/mcp-ingest "web bridge" child process
  → bridge runs the ingestion pipeline, emits NDJSON progress events
  → events stream back to the browser; chunks land in Qdrant + SQLite
```

**Running an evaluation (via the web UI):**

```
Browser (/test)
  → POST /test/api  (Next.js Node route)
  → run-manager spawns the june-eval CLI child process with --progress-ndjson
  → bench pipeline runs (delegating ingest to the june CLI), emits NDJSON
  → server folds events into a RunSnapshot, broadcasts over SSE
  → browser renders live stage progress; results.json + summary.md land on disk
```

Both flows share a pattern: **the Next.js server never does heavy work in-process**.
It spawns a child CLI and relays a stream. See
**[04 — Frontend](./04-frontend.md)** for the bridge/SSE plumbing.

---

## 6. Cross-cutting conventions

These hold across every package and are enforced by `.claude/rules/` + tooling:

- **Boundaries are Zod-validated.** Env, config, HTTP bodies, external API responses,
  file/DB reads, and MCP tool results all parse through a schema. Types are
  *inferred* from schemas, never hand-duplicated.
- **No `process.env` outside `lib/env.ts`; no config access outside `getConfig()`.**
- **Winston logging only** (`logger.info("event.name", { structuredFields })`) — no
  `console.*` in production code.
- **`type` over `interface`, named exports, `const` by default, no `any`.**
- **Concurrency is exploited** — independent async work runs through `Promise.all`
  / `allSettled` or a bounded `mapConcurrent`; a serial `for await` over independent
  inputs is treated as a bug.

Full rules: [.claude/rules/code-style.md](../rules/code-style.md),
[.claude/rules/ui-style.md](../rules/ui-style.md), and
[06 — Shared layer & conventions](./06-shared-and-conventions.md).

The repo also runs an **authorship-tracking** system (a hook records Claude's
per-file line contributions; commits are attributed accordingly) and a
**reader-by-purpose** discipline for the bench. Both are documented in
**[07 — Authorship & dev workflow](./07-authorship-and-workflow.md)**.
