# june — Audit Findings: RESOLVED

**Status.** All findings from the audit pass have been triaged by Cam. This file now records the decisions and where they landed in the plan. Chat 2 should read this to understand the reasoning behind the invariants in CONSTRAINTS.md.

---

## Decisions (all items)

### P0 — Accepted, folded into plan

**G1. Deletion semantics.** Downgraded from P0 during discussion. Handled via the reconciliation approach (I4) — scheduled or on-demand `june reconcile` command walks documents table, soft-deletes vanished files, cleans Qdrant orphans. Covers compliance without building a real-time watcher.

**G2. Partial re-ingest.** REJECTED by design. Full re-ingest on any content_hash change. Security over cleverness — this is potentially government-sensitive data. Diff-based re-ingest is a category of bug we will not pay for. Compute cost acceptable per Constraint 7. Codified as invariant I1.

**G3. Concurrency.** Single-writer, SQLite advisory lock. Second invocation detects lock, exits with clear message ("another ingest is running"). Codified as invariant I2 and reflected in SQLite DDL (ingestion_lock table).

**G4. Encoding handling.** Accepted. Detection via BOM + heuristic, transcode to UTF-8-without-BOM, normalize line endings, strip zero-width characters. Happens in Stage 2. Codified as invariant I3 and reflected in Section 15 of skeleton.

**G5. Degenerate files.** Accepted as specified. Explicit rules for empty, whitespace-only, no-headings, only-code-fences, frontmatter-only. New status values in SQLite schema. Reflected in Section 15.

**G6. Long-document contextual summaries.** Accepted. Two-pass approach for docs exceeding classifier context window: pass 1 builds document-level summary by summarizing windowed chunks, pass 2 uses (doc summary + containing section + chunk) as context. Threshold configurable, default 6000 tokens. Reflected in Section 19.

**G7. Ollama failure modes.** Accepted. Enumerated taxonomy in Section 25: first-call model-load delay (300s), empty response retry, model-not-found fatal, connection refused backoff, malformed JSON fallback. Reflected in expanded Section 25.

**G8. Offline enforcement.** Accepted as architectural, not just documentation. Startup-time network request interceptor blocking non-localhost/non-Ollama/non-Qdrant outbound. `--verify-offline` flag for active verification. Codified as invariant I10, new Section 25.5.

### P1 — Accepted, folded into plan

**G9. Embedding model migration.** Full re-embed on model upgrade — no incremental migration. `june re-embed --model <n>` CLI command (Section 27.6). SQLite chunks table tracks embedding_model_name + embedding_model_version + embedded_at per chunk. Codified as invariant I5.

**G10. Atomic writes across Qdrant + SQLite.** Using my judgment per Cam's direction. Model: Qdrant is primary vector store, SQLite is source of truth for ingestion state. Write Qdrant first (idempotent upsert), only after ack update SQLite status. Reconciliation procedure handles any inconsistency. Reflected in Section 23 and Section 27.5.

**G11. Markdown link extraction.** Accepted. Walk mdast for link nodes during Stage 4. Internal links resolve to target doc_id, populate `references`. External links stored in new `external_links: string[]` field. Anchor links resolve to section_id. Reflected in Section 20 expansion.

**G12. Prompt injection.** Deferred to red-team work post-v1. v1 mitigation: wrap chunk content in tags, instruct model to treat as untrusted data. Not full defense. Codified as invariant I6 and Appendix H (known failure points).

**G13. Graceful shutdown.** Using my judgment: finish-current-chunk-then-exit on SIGTERM/SIGINT. SIGKILL handled by resume path. Codified as invariant I8, reflected in Section 24.

**G14. Logging / progress.** Accepted with emphasis. Winston throughout, standard levels (debug/info/warn/error), non-catastrophic errors do NOT exit. Hard rule: NEVER log raw markdown content. CLI progress bars + ETA to stderr. Codified as invariants I7 and I9, reflected in Section 26.

**G15. Context budget math.** Using my choice. Small Appendix G added with the formula and query-time defaults. Informs chunk-size decisions without dictating retrieval behavior (retrieval is out of scope).

### P2 — Handled per direction

**G16. Beyond-CommonMark content.** Handled as code blocks, pass-through in v1. Noted in Section 15 and Appendix H.

**G17. PII / credential scanning.** Out of scope for v1. Marked for red team in Appendix H. Hard rule: never log content (invariant I7) addresses the most common exposure vector.

**G18. Observability.** Winston + SQLite counts for v1. OpenTelemetry/tracing deferred.

**G19. Export / portability.** Noted only (Appendix I). SQLite sidecar is implicitly portable; formal export is v2.

**G20. Evaluation harness.** Benchmark harness covers throughput. Quality eval deferred to follow-up artifact (needs golden corpus, which is outside spec scope).

### Final question — resolved

**Short-section embedding policy.** Committed to Option A: only chunks are embedded; sections are retrieval-by-ID lookups. Justified by research (LangChain ParentDocumentRetriever, LlamaIndex small-to-big, Dify parent-child all use this pattern). Double-embedding the same content under two granularities creates retrieval noise. RAPTOR embeds summaries not sections, and is out-of-scope. Codified as invariant I11.

---

## Summary of invariants added to CONSTRAINTS.md

I1. Full re-ingest on content_hash change (no partial)
I2. Single-writer concurrency via SQLite advisory lock
I3. Mandatory encoding normalization in Stage 2
I4. Reconciliation command (not real-time deletion tracking)
I5. Full re-embed on embedding model upgrade
I6. Basic prompt-injection hardening; defense-in-depth deferred
I7. Never log markdown contents
I8. Graceful shutdown = finish-current-chunk-then-exit
I9. Winston logging, non-catastrophic errors do not exit
I10. Architectural offline enforcement
I11. Only chunks embedded, never sections

## Summary of new skeleton sections

- Section 15 expanded: encoding + degenerate files
- Section 19 expanded: long-document two-pass summaries
- Section 20 expanded: markdown link extraction
- Section 24 expanded: single-writer lock + graceful shutdown
- Section 25 expanded: Ollama failure taxonomy + outage taxonomy
- Section 25.5 added: offline invariant enforcement
- Section 26 expanded: Winston logging, content-exclusion rule
- Section 27.5 added: reconcile command
- Section 27.6 added: re-embed command
- Appendix G added: context budget math
- Appendix H added: known failure points / red team targets
- Appendix I added: data portability note

## Summary of research brief updates

- SQLite DDL updated with new columns + ingestion_lock table
- Pillar 2 table: added external_links
- Pillar 4 table: added embedding_model_name, embedding_model_version, embedded_at

---

The plan is complete. Chat 2 can now write SPEC.md from these four files with confidence that no known gaps are unaddressed.

---

## Round 2 — post-Chat-2 audit pass (2026-04-18)

Conducted when Chat 2 was instructed to audit before writing. Found additional ripples and new guardrail requirements. All resolutions folded into CONSTRAINTS.md, RESEARCH_BRIEF.md, SKELETON.md. Summary of decisions:

### Structural findings (resolved in docs)

**R1. Pillar count contradiction.** CONSTRAINTS said "Four Pillars" in stage 4 scope; RESEARCH_BRIEF/SKELETON define Six. → Fixed CONSTRAINTS to "Six Pillars" and updated the "MUST produce" checklist to "Pillar 1-6". The greg-era Four-Pillar branding is retired.

**R2. `document_title` resolution hierarchy was undefined.** → Committed to `frontmatter.title > first H1 > filename (de-extensioned and de-kebab/snake-cased)`. Will appear in SPEC §17.

**R3. Stale lock handling was undefined, and pid/hostname-based liveness breaks under containerization.** → I2 rewritten to use heartbeat-based staleness: active run updates `last_heartbeat_at` every 30s; lock acquire breaks locks with heartbeats older than 90s. Reflected in DDL (`ingestion_lock.last_heartbeat_at` column) and SKELETON §24.

**R4. Soft-delete resurrection semantics were undefined.** → If a document with `deleted_at` set is re-ingested, row is updated in place: `deleted_at` cleared, new version row inserted, prior versions' `is_latest` flipped. Documented in RESEARCH_BRIEF §10.6 and SKELETON §23.10e.

**R5. `references[]` vocab ambiguity.** Doc-id vs entity-id domain was mixed. → Scoped v1 `references[]` to resolved internal link doc_ids and section_ids only. No classifier-driven entity extraction in v1. Unresolved internal links go into new `unresolved_links: string[]` field, never retroactively resolved; future `june re-resolve-links` deferred. SKELETON §20 rewritten.

### Versioning — the deeper decision (Round 2 core finding)

**R6. "Keep everything unless specifically deleted."** Full design committed:
- Version resolution: CLI flag `--version` > frontmatter `version:` > ISO-8601 UTC timestamp
- `documents` composite PK `(doc_id, version)`; `is_latest` column (exactly one per doc_id)
- `chunk_id = sha256(doc_id + version + offsets + schema_version)` — version enters the hash
- `sections` composite PK `(section_id, version)` — section boundaries change between versions
- Qdrant payload: `version` and `is_latest` fields, both indexed
- Stage 10 performs bulk filtered payload update to flip prior version's `is_latest=false`
- `schema_version` policy: bumps only on breaking changes; additive Pillar additions do NOT bump

**R7. `schema_version` bump policy was implicit.** → Made explicit in I1 and SKELETON §11: additive schema changes do not trigger a version bump, only breaking changes do. Prevents accidental world re-ingest on feature extension.

**R8. Logger content-exclusion was pattern-based (fragile).** → I7 rewritten for type-level enforcement: logger interface does not accept a raw-content field; prevented by construction, not by runtime pattern matching.

### Engineering guardrails added (new invariants)

Cam's non-negotiables codified mid-audit, applied globally:

- **I12** — Bun + TypeScript strict only; `strict: true`, `noUncheckedIndexedAccess: true`, no `any`
- **I13** — Secrets/endpoints in env vars (`OLLAMA_URL`, `QDRANT_URL`, `OLLAMA_EMBED_MODEL`, `OLLAMA_CLASSIFIER_MODEL`, `OLLAMA_SUMMARIZER_MODEL`), hard-fail on startup if unset; operational tunables in `config.yaml`
- **I14** — Package hard-gate: active maintenance (last 12mo), no outstanding high/critical CVEs, no telemetry/phone-home of any kind. Opt-out telemetry is rejected. Structured outputs validated with `zod`

### CLI refinements

- Drop `dry-run` (covered by `reindex` on a test doc)
- Add `init` (containerized deployment needs explicit first-run setup for Qdrant collections + SQLite DDL)
- Add `health` (Ollama + Qdrant + SQLite reachability for container readiness probes)
- Rename mental model: `reindex <doc_id>` = full pipeline re-run for one doc; `re-embed --model <n>` = Stage 9+10 rerun for all chunks

### Offline enforcement (I10) corrected

Previously whitelisted `localhost, 127.0.0.1, ::1` by default. Ollama is remote — those defaults don't apply. → Whitelist computed from env vars at startup: `{resolved OLLAMA_URL host, resolved QDRANT_URL host}`, nothing else. If those happen to resolve to localhost, fine; if they resolve to an internal service mesh, fine. No implicit localhost bypass.

### Package decisions pinned

- `bun:sqlite` over `better-sqlite3` (no native addon, no install complexity, zero external deps)
- `yaml` (Eemeli Aro) over `js-yaml` (better spec compliance, actively maintained)
- `zod` for all runtime validation of structured outputs
- `winston` with type-constrained interface per I7
- `@qdrant/js-client-rest` — official, fetch-based, no telemetry
- Hono REMOVED from ingest spec scope (ingestion is CLI-driven; any `june serve` surface is a separate future concern)
- `transformers.js` REMOVED from ingest spec scope (reranker is retrieval-side, deferred)

### Datastore decision

Cam briefly considered Mongo; rejected on license grounds (SSPL is a federal procurement risk and the workload is single-writer relational, not Mongo's strength). PostgreSQL framed as the natural upgrade path when HA becomes required; SQLite + Litestream as the lighter HA path. For v1: `bun:sqlite`. Logical schema is dialect-agnostic; RESEARCH_BRIEF §10.7 documents multi-backend goal. Sidecar HA deferred to v1.1, noted in Appendix H.

### New schema tables

- `ingestion_errors` — append-only error audit trail, replaces `last_error` JSON-blob approach
- `reconcile_events` — append-only reconciliation audit trail, separate from errors for compliance queryability

### What's still open for Chat 3

Nothing blocking. The four files are ready to write SPEC.md against. The mandatory checkpoint (after Part II) remains as specified in CONTINUATION_PLAN.md.

---

## Summary of invariants NOW (post Round 2)

- I1 — Versioned ingestion, no partial re-ingest (rewritten)
- I2 — Single-writer concurrency via heartbeat lock (rewritten for container-safety)
- I3 — Encoding normalization mandatory
- I4 — Reconciliation command (now writes reconcile_events)
- I5 — Full re-embed on model upgrade
- I6 — Prompt injection deferred
- I7 — Never log markdown, enforced at type level (rewritten for architectural enforcement)
- I8 — Graceful shutdown = finish current chunk
- I9 — Winston logging throughout, errors go to ingestion_errors table
- I10 — Offline enforcement, whitelist computed from env at startup (rewritten, no localhost default)
- I11 — Only chunks embedded, never sections
- **I12 — Bun + TypeScript strict only (NEW)**
- **I13 — Env vars for secrets/endpoints, config.yaml for tunables (NEW)**
- **I14 — Package selection hard-gate: no telemetry, maintained, CVE-clean (NEW)**

Fourteen written-out invariants now. CONSTRAINTS.md is authoritative.
