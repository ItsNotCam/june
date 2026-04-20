# june chunker — PINNED CONSTRAINTS

Re-read this before starting each new section of the spec. This is the anti-drift document.

## The 8 constraints

1. **Audience spread** — Lil Timmy (10yr old, curious, messing around) → Jonny (20yr old, learning) → Enterprise Paul (sensitive data, 150b reader, zero hallucination tolerance). Chunker must serve all three.

2. **Primary optimization target: 14b reader on consumer hardware.** 3b should still be usable; 150b should be excellent. 14b is the north star.

3. **Opus-level quality bar, but ONLY on content within the ingested data.** Not Opus on general knowledge — Opus on proprietary corpus. "Beats Opus at knowing *your* codebase/docs."

4. **Phase 2 production quality from day one.** This is the RAG foundation. Schema must not require re-ingest for phases 3-7. All classifier passes that need a model can be stubbed behind interfaces, but the data shape they produce must be finalized now.

5. **No external services. Ollama is the only foreign dependency.** The pipeline never reaches any cloud API. Ollama itself may be remote (different host on an internal/private network) — that's operationally fine, but nothing beyond Ollama + Qdrant is allowed outbound. User can disconnect from the public internet and continue ingesting + querying as long as Ollama and Qdrant remain reachable on their configured hosts.

6. **Input assumption: authored markdown** (Opus-quality technical docs, like top-tier OSS READMEs). Future lossy conversions (PDF→md) will be handled by upstream preprocessors, not the chunker.

7. **Ingestion time is not a concern.** Graceful handling of outages/crashes is. Must be resumable.

8. **File size range: 10-page runbook to 500-page vendor doc.** Both must work flawlessly.

## Scope: END-TO-END INGESTION PIPELINE

This is not just a chunker. This is the full ingestion system from `raw markdown file on disk` → `enriched, embedded, stored chunks ready for retrieval`. Every stage of the pipeline is in scope.

Stages the spec covers:
1. **File ingest + provenance capture** — hashing, source tracking, resume state
2. **Parsing + normalization** — markdown → canonical AST with structural metadata
3. **Chunking** — heading-aware sectioning + recursive overflow splitting
4. **Metadata derivation** — all Six Pillars populated, including classifier passes
5. **Contextual summarization** — Anthropic-style per-chunk context generation
6. **Relationship extraction** — references[], canonical_for, siblings, continuation
7. **Embedding** — embed-text construction, model call, vector produced
8. **Storage** — Qdrant upserts + SQLite provenance sidecar, idempotent
9. **Resume + outage recovery** — pipeline can crash anywhere and pick up cleanly
10. **CLI + benchmark harness** — operator surface for running and measuring it

All of this is one-shottable by Claude Code from this spec.

## Non-goals for this spec

- Not the retrieval/query side (that's a separate phase-2 task)
- Not the query-time router (v10)
- Not upstream format conversion (PDF→md, DOCX→md — phase 7)
- Not picking the final embedding model — parameterized with strong recommendation
- Not writing unit tests — spec describes behaviors, Claude Code writes tests
- Not benchmark *results* — spec describes the benchmark harness, not numbers

## What the spec MUST produce

Claude Code one-shot input yielding:
- Full pipeline module(s) with clear stage boundaries
- Complete Pillar 1-6 metadata schema with every field defined, typed, and justified
- Classifier interfaces + reference implementations (using local small-model calls via Ollama)
- Contextual summarization implementation
- Relationship/reference extraction
- Embedding wiring
- Qdrant + SQLite storage with idempotency guarantees
- Crash-safe resume
- CLI: ingest a file/folder, status, resume, reindex
- Benchmark harness
- Schema v1 that never needs re-ingest for phases 3-7

## Target stack (from project memory + engineering guardrails)

**Runtime & language:**
- Bun, TypeScript strict (`strict: true`, `noUncheckedIndexedAccess: true`, no `any`)

**Storage:**
- Qdrant (two collections: `internal`, `external`), via `@qdrant/js-client-rest`
- `bun:sqlite` (built-in) as the default/v1 sidecar. Logical schema is dialect-agnostic — PostgreSQL and Microsoft SQL Server are planned future backends behind the same `SidecarStorage` interface.

**Models:**
- Ollama for embeddings + classifier + summarizer passes. Ollama is potentially remote — URL and model names come from env vars, never hardcoded.

**Core libraries:**
- Markdown parsing: `mdast-util-from-markdown` + `micromark-extension-gfm` + `mdast-util-gfm`
- Logging: `winston`
- Runtime validation: `zod`
- Config parsing: `yaml` (Eemeli Aro)

**Explicitly out of scope for this spec:**
- Hono / HTTP surface — ingestion is CLI-driven; any HTTP server (e.g. `june serve`) is a separate future concern
- LangChain, LlamaIndex, chonkie-ts — we do not depend on these
- transformers.js — deferred to the retrieval spec alongside the reranker
- Next.js / React / Tailwind / Zustand / shadcn/ui — frontend concerns, separate spec

## The bar, stated plainly

A 14b model reading chunks from this chunker, running on consumer hardware, should beat a no-RAG Opus on questions about content the user has ingested. This is achievable only because of metadata density, not because of chunking alone — but the chunker is the foundation that makes it possible.

## Additional invariants (from post-audit decisions)

**I1. Versioned ingestion, no partial re-ingest.** Every ingest of a document records a version (resolved order: CLI flag `--version` > YAML frontmatter `version:` > ISO-8601 UTC timestamp of ingest start). When a source file's `content_hash` changes, a new version is ingested in full from scratch — no partial/diff-based re-ingest (that's a category of bug we will not pay for). Prior versions are retained in their entirety; the new version's chunks are marked `is_latest=true` in Qdrant payload and the prior version's flipped to `is_latest=false`. Hard deletion only via explicit `purge` command or reconcile with `--purge` flag. Security over cleverness.

**I2. Single-writer concurrency via SQLite advisory lock with heartbeat.** Only one ingest run may write at a time. The active run updates `last_heartbeat_at` on the lock row every 30 seconds. Lock acquisition: if the existing lock's heartbeat is older than 90 seconds (3× interval), it's stale — break and acquire. Otherwise the second invocation exits with a clear "another ingest is running" message. Heartbeat-based staleness is required because containerized deployment breaks pid/hostname-based liveness checks. No deadlock, no corruption.

**I3. Encoding normalization is mandatory.** Detect encoding (BOM, heuristic), transcode to UTF-8-without-BOM, normalize line endings to LF, strip zero-width characters. Happens in Stage 2 for every file, no exceptions.

**I4. Reconciliation, not deletion tracking.** June does not track file deletions in real time. A scheduled (or on-demand) `june reconcile` command walks the documents table, detects vanished source_uris, soft-deletes those documents (sets `deleted_at`; chunks retained by default for audit/rollback), and deletes Qdrant orphans (points with no SQLite chunk). Every reconciliation action is recorded in `reconcile_events` for compliance audit trail. `--purge` flag escalates to hard deletion of chunks. Covers compliance without requiring a daemon.

**I5. Full re-embed on model upgrade.** When the embedding model changes, re-embed all chunks from scratch by re-running Stage 9 (Embedding) + Stage 10 (Storage) for every stored chunk, reading inputs from SQLite. SQLite schema records `embedding_model_name` and `embedding_model_version` per chunk so mismatches are detectable. User flag `--embedding-model <name>` on CLI triggers this. New Qdrant collection created with new dimensions; alias atomically swapped on success.

**I6. Prompt injection is out of scope for v1.** Classifier and summarizer prompts wrap chunk content in tags and instruct the model to treat as untrusted data. That's it. Real defense-in-depth is a red-team exercise post-launch. Marked as known failure point.

**I7. Never log markdown contents — enforced at the type level.** The logger interface does NOT accept a raw-content field. Its type signature permits only `{doc_id, chunk_id, run_id, stage, counts, timings, error_type, error_message, field_names}`. Raw markdown cannot reach the logger by construction, not by runtime pattern matching. PII/credential exposure via logs is a common failure mode — we prevent it architecturally. Marked for red team review later.

**I8. Graceful shutdown = finish-current-chunk.** On SIGTERM/SIGINT, finish the current chunk's current stage, persist state, exit cleanly. On SIGKILL or power loss, resume path handles it. Never leave half-written records.

**I9. Winston logging throughout.** Every module uses winston. Standard levels: debug, info, warn, error. Debug traces stage transitions, info logs document-level events, warn for recoverable issues, error for failures. Error does NOT mean exit — only catastrophic failures (disk full, corrupted SQLite, repeated Ollama connection refused) exit. Everything else writes an `ingestion_errors` row and continues.

**I10. Offline enforcement is architectural.** A network-request interceptor installed at startup blocks any outbound connection not in the service whitelist. The whitelist is computed from env vars at startup: `{resolved OLLAMA_URL host, resolved QDRANT_URL host}` — nothing else, no implicit localhost bypass. If those happen to resolve to localhost, fine; if they resolve to a private-network service mesh or a dedicated Ollama host, fine. Any connection to a host outside this set throws. This makes the offline invariant testable under any deployment topology (local dev, containerized, air-gapped). CLI flag `--verify-offline` exercises the enforcement actively at startup.

**I11. Short sections do not get special embedding treatment.** Per research on small-to-big retrieval (LangChain ParentDocumentRetriever, LlamaIndex small-to-big, Dify parent-child), only chunks are embedded. Sections exist as retrieval-by-ID lookups. Never double-embed the same content under two granularities — it creates retrieval noise.

**I12. Bun + TypeScript strict, no exceptions.** `tsconfig` must set `strict: true` and `noUncheckedIndexedAccess: true`. No `any`. Node-specific patterns that don't run on Bun natively (native addons requiring node-gyp, CommonJS-only packages with no ESM build) are rejected. All packages must work on Bun with zero workarounds.

**I13. Secrets and service endpoints in environment variables; operational tunables in config.yaml.** Required env vars (hard-fail on startup if unset, no silent defaults): `OLLAMA_URL`, `QDRANT_URL`, `OLLAMA_EMBED_MODEL`, `OLLAMA_CLASSIFIER_MODEL`, `OLLAMA_SUMMARIZER_MODEL`. Optional env: `QDRANT_API_KEY`. Everything else — chunk sizes, overlap, batch sizes, SQLite path, reconcile mode + schedule, log level, log output destination, long-doc summary threshold, matryoshka dimension, retry/backoff params, classifier fallback defaults — lives in `config.yaml`. Rule of thumb: if leaking it compromises anything, it's env; if tuning it is part of operations, it's yaml.

**I14. Package selection is a hard gate.** Every dependency must meet ALL of: (a) active maintenance within the last 12 months, (b) no outstanding high/critical CVEs at time of adoption, (c) no telemetry, phone-home, or third-party analytics calls of any kind — verified by reading source or reviewing docs before adoption. Opt-out telemetry is rejected; opt-in or none is acceptable. Runtime structured outputs (classifier JSON, summarizer JSON, config.yaml) MUST be validated with `zod` before use. Government-compliance grade — an "oops we shipped telemetry" is a compliance incident, so this is non-negotiable.
