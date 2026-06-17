---
title: Ingestion Pipeline — @june/mcp-ingest
type: reference
status: active
tags: [project/june, area/research, tech/ingestion, tech/rag]
project: june
area: research
created: 2026-06-17
summary: The core markdown→embedded-chunks pipeline (Qdrant + SQLite sidecar) shipping the june CLI.
keywords: [ingestion, mcp-ingest, june cli, qdrant, sqlite, chunking, embeddings, provenance, metadata]
aliases: [mcp-ingest, june ingestion]
---

# Ingestion Pipeline — `@june/mcp-ingest`

> Turns a directory of markdown into embedded, richly-described chunks in Qdrant,
> with a full metadata + provenance trail in a SQLite sidecar. Ships the **`june`**
> CLI.

This is the core product. Everything else (the frontend's Ingest UI, the MCP
server, the bench's Stage 4) ultimately drives this pipeline.

- **Authoritative spec:** [`.claude/plans/INGESTION_PIPELINE_SPEC.md`](INGESTION_PIPELINE_SPEC.md) (the 10-stage design, 265 KB)
- **Design constraints:** [`.claude/plans/ingestion-pipeline-v1/CONSTRAINTS.md`](../plans/ingestion-pipeline-v1/CONSTRAINTS.md)

---

## 1. The `june` CLI

Entry point: `cli/june.ts` → `runCli(argv)`. Exit codes: `0` success · `1` fatal/config
· `2` ingest already running (lock held) · `3` health failed · `4` confirmation
required (`--yes` missing) · `64` usage error.

| Command | Purpose |
|---|---|
| `june init` | Idempotent first-run setup. Opens/migrates the SQLite sidecar, ensures Qdrant collections + aliases + payload indexes. Safe to re-run. |
| `june ingest <path> [--version <s>] [--force]` | Main entry. Discovers markdown under `<path>`, runs stages 1–10. `--force` re-ingests even when the content hash is unchanged. |
| `june status [doc_id]` | Read-only. No arg → last run, doc counts by status, 24h error count, lock state. With `doc_id` → version history. |
| `june resume` | Replay every non-terminal document (status in `pending/parsed/chunked/contextualized/embedded`) after a crash. |
| `june reindex <doc_id>` | Hard-delete the latest version's chunks, then re-ingest from the recorded `source_uri`. |
| `june purge <doc_id> [--all-versions] [--yes]` | Destroy a document from Qdrant + SQLite (soft-marks `deleted_at`). `--yes` required. |
| `june reconcile [--dry-run] [--purge]` | Find/clean orphans (in SQLite but not Qdrant, or vice-versa). Records `reconcile_events`. |
| `june re-embed --embedding-model <name> [--collection internal\|external\|all] [--yes]` | Switch embedding model: build a parallel collection, re-embed all chunks, **atomically swap the alias**. |
| `june health` | Probe SQLite + Qdrant + Ollama reachability. Exit 3 if any fails. |
| `june bench <corpus-path> [--out <file>] [--no-store]` | Perf harness — times each stage against a corpus using stubbed embedder/summarizer. |

> **Note:** `june bench` is a *pipeline-timing* harness (in-memory SQLite, stubbed
> models). It is **not** the RAG-quality benchmark — that's `june-eval` in
> [03 — Bench & evaluation](./03-bench-evaluation.md).

---

## 2. The pipeline, stage by stage

Orchestrated by `src/pipeline/ingest.ts` (`ingestPath()` / `processFile()`). Each
stage is `src/pipeline/stages/NN-name.ts`, runs inside a transaction, and advances the
document's lifecycle status. Stages 4/5/7 from the spec are deferred or folded — v1
runs **seven** executable stages.

| # | Stage | In → Out | What it does |
|---|---|---|---|
| 1 | **Discover** | path → Document + raw bytes | Size-gate, read bytes, `content_hash = sha256(bytes)`, `doc_id = sha256(canonical file URI)`, resolve version, look up existing state → classify as *ingest / unchanged / resume / resurrection / too-large*. |
| 2 | **Parse** | bytes → mdast + frontmatter | Encoding detection (BOM → UTF-8 → Windows-1252 fallback), split + parse YAML frontmatter, GFM mdast parse, title resolution (frontmatter → first H1 → filename-cased). Gates empty / metadata-only files. |
| 3 | **Chunk** | mdast → sections + chunks | `sectionize()` walks headings into sections (with `heading_path`); `chunkSection()` recursively splits each section to ~500 tokens, respecting protected regions (code/tables/lists) and preferring paragraph > sentence > hard breaks, with 15% overlap. |
| 6 | **Summarize** | chunks → `contextual_summary` | Two-pass for long docs (>6000 tok): an outline pass, then a per-chunk contextual summary. Bounded concurrency. Deterministic fallback summary on failure. Validates length 50–1200 chars. |
| 8 | **Embed-text** | chunk → `embed_text` | Composes `title \n\n heading_path \n\n summary \n\n content`; truncates by a fixed hierarchy if over `max_input_chars` (never drops title; keeps ≥2 heading segments). |
| 9 | **Embed** | `embed_text` → vectors | Batches through the Ollama embedder for the **dense** vector; computes the **BM25 sparse** vector client-side (FNV-1a token hashing; Qdrant applies IDF server-side). |
| 10 | **Store** | vectors → committed | Upserts points to Qdrant (collection = `external` if `source_type==external` else `internal`), flips `is_latest=false` on the prior version, writes chunk metadata to SQLite, sets document `status='stored'`. |

### Document lifecycle

```
pending → parsed → chunked → contextualized → embedded → stored   (terminal: success)
                                                          ↘ failed (terminal: error)
                          skipped_empty / skipped_metadata_only    (terminal)
                          deleted (soft; can be resurrected)
```

### Deterministic identity

- `doc_id = sha256(canonical_file_uri)` — stable across runs (symlinks resolved).
- `version` = CLI `--version` > frontmatter `version:` > run timestamp.
- `section_id = sha256(doc_id | heading_path | char_start)`.
- `chunk_id = sha256(doc_id | version | char_start | char_end | schema_version)`.
- Qdrant `point_id` = first 128 bits of `chunk_id` as a UUID.

Re-embedding keeps `chunk_id` stable, which is what lets the alias swap be seamless.

---

## 3. The summarizer (Stage 6)

The summarizer is pluggable via `config.summarizer.implementation`:

- **`ollama`** (`src/lib/summarizer/ollama.ts`) — POSTs `/api/generate` with
  `temperature: 0, seed: 42, format: "json"` (deterministic). First call gets a 300s
  timeout (model load grace); later calls 60s. Retries with exponential backoff;
  fails fast on 404 (model not found).
- **`deepseek`** / **`anthropic`** (`src/lib/summarizer/anthropic-compat.ts`) — use the
  Anthropic Messages API (DeepSeek `deepseek-v4-flash`, or Claude `claude-haiku-4-5`).
  No local model load, elastic capacity.
- **`stub`/`mock`** — test doubles.

Shared logic lives in `src/lib/summarizer/core.ts` (`summarizeDocument` for the
outline pass, `summarizeChunk` for per-chunk, plus JSON extraction, validation, and
the deterministic fallback).

---

## 4. The two storage layers

### SQLite sidecar — system of record

Opened with `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`,
`busy_timeout=5000`. Tables:

| Table | Holds |
|---|---|
| `ingestion_runs` | one row per run (counts, trigger, timestamps). |
| `documents` | PK `(doc_id, version)`; status, `is_latest`, `content_hash`, `source_uri`, `deleted_at`. |
| `sections` | structural heading boundaries (`heading_path` JSON, char span). |
| `chunks` | `chunk_id`, `raw_content`, `contextual_summary`, embedding model name/version, status. |
| `ingestion_errors` | append-only audit (stage, error_type, message — **never raw chunk content**). |
| `reconcile_events` | append-only orphan-handling audit. |
| `ingestion_lock` | single-writer lock (`lock_id=1`) with a heartbeat. |

**Single-writer lock (`src/lib/lock.ts`):** acquire on run start, heartbeat every 30s,
release on exit. A lock whose heartbeat is >90s stale is treated as dead and broken.
This is why a second concurrent `june ingest` exits with code 2.

The `SidecarStorage` interface (`src/lib/storage/types.ts`) abstracts the dialect
(`sqlite | postgres | mssql`) so the backend can change later.

### Qdrant — the vector index

`src/lib/storage/qdrant.ts`. Two collections (`internal_v1`, `external_v1`) reached
through `internal` / `external` aliases. Each point carries a **dense** vector
(cosine) and a **bm25** sparse vector. ~27 payload fields (chunk/doc identity,
`is_latest`, source provenance, embedding model, `contextual_summary`, `embed_text`,
`heading_path`, …). **Raw chunk content is NOT in Qdrant** — it lives only in SQLite,
so re-embed can recompute vectors without re-reading source files.

`VectorStorage` interface highlights: `ensureCollections(dim)`, `upsert(points)`,
`flipIsLatest(...)`, `deletePointsByChunkIds/DocId(...)`, `scrollAllChunkIds(...)`
(reconcile), `swapEmbedAlias(...)` (re-embed).

---

## 5. Embedding details

- **Dense** (`src/lib/embedder/ollama.ts`): `createOllamaEmbedder()` probes the
  dimension and model digest on first call, optionally truncates+renormalizes to a
  Matryoshka dim, batches `/api/embed` (batch size 32), retries with jittered
  backoff, fails fast on 404.
- **Sparse** (`src/lib/embedder/bm25.ts`): `bm25Vectorize(text)` lowercases, splits on
  whitespace/punctuation, drops stopwords + out-of-range tokens, hashes each token
  with FNV-1a 32-bit, counts occurrences → `{ indices, values }`. Qdrant applies IDF.

---

## 6. Dependency injection

`src/pipeline/factory.ts` → `buildDeps()` returns
`{ summarizer, embedder, storage }`. Each is built from config or an override
(`buildEmbedder`, `buildSummarizer`, `buildStorage`). This is the seam tests and the
perf harness use to inject stubs.

**For programmatic / MCP use:** prefer `ingestContent(opts)` (string input, no
filesystem I/O — safe for untrusted callers) over `ingestPath(opts)` (trusted file
paths only). Pass a virtual URI like `mcp://session/<id>/<name>.md` so re-sending the
same content is correctly recognized as unchanged. Other entry points: `health()`,
`resumeRun`, `reconcile`, `reembed`, `purge`.

---

## 7. Configuration & environment

**Env** (`src/lib/env.ts`, extends `BaseEnvSchema`): `OLLAMA_URL`, `QDRANT_URL`,
`OLLAMA_EMBED_MODEL`, `OLLAMA_CLASSIFIER_MODEL`, `OLLAMA_SUMMARIZER_MODEL` (required);
`QDRANT_API_KEY`, `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, `CONFIG_PATH` (optional —
a fresh install runs on shipped defaults).

**Config** (`config.example.yaml`, `src/lib/config.ts`): `sidecar.path`, `log.*`,
`chunk.{target,min,max}_tokens` + `overlap_pct`, `ingest.max_file_bytes` (50 MiB),
`embedding.{batch_size, matryoshka_dim, max_input_chars}`, `bm25.stopwords`,
`summarizer.{implementation, long_doc_threshold_tokens, concurrency, ...}`,
`ollama.{timeouts, retry}`, `qdrant.{upsert_batch_size, retry}`, `reconcile.{mode, cron}`,
and `sources.*` (prefix-match overrides for `source_system`/`source_type`/`namespace`).

---

## 8. Errors, tests, and the perf harness

**Typed errors** (`src/lib/errors.ts`): `EncodingDetectionError`, `ParseError`,
`ChunkOverflowError`, `Ollama{Unavailable,Timeout,ModelNotFound}Error`,
`QdrantWriteError`, `SidecarLockHeldError`, `OfflineWhitelistViolation`,
`FileTooLargeError`, `EmbeddingDimensionMismatchError`, `MissingSummarizerApiKeyError`,
… — each maps to a retry/terminal disposition.

**Tests** (`__test__/`): `chunker/` (sectionize, split, protected regions),
`pipeline/` (e2e, resume-mismatch, encoding), `summarizer/` (determinism, fallback,
JSON extraction), `storage/` (CRUD, migrations), `offline/` (offline guard).

**Perf harness** (`benchmark/harness.ts`, run via `june bench`): spawns a separate
process, in-memory SQLite, stubbed embedder (~8 ms/batch) + summarizer (~2 ms/chunk),
walks a corpus and reports per-stage p50/p95/p99 and throughput (docs/sec, chunks/sec).
