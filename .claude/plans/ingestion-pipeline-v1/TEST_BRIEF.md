# june/mcp — Functional Brief for Test Authors

You are writing tests for `packages/mcp` — june's end-to-end markdown ingestion pipeline. You must write tests **from this brief alone**, without reading the implementation. Your job is to exercise the *intended* behavior; any drift between this brief and the code is a bug to report.

This document is derived from `SPEC.md` (the authoritative 4300-line spec at `.claude/plan/SPEC.md`). Where this brief is more specific than SPEC, this brief wins for test intent. Where SPEC is more specific (e.g. exact SQL column names), SPEC wins.

## Spec-to-code fidelity note (read first)

Known honest deltas between SPEC and current implementation — do not write tests that assume these are different:

1. **`references` field shape.** Fixed this session: `ChunkRelationships.references` is now strictly `Array<{ doc_id } | { section_id }>`. Any `link_text` field is gone.
2. **Stage 5 classifier failure** — SPEC §18.6 says "fall back and advance chunk." Code applies the configured fallback (`config.classifier.fallbacks`) and writes `error_type='classifier_fallback'` to `ingestion_errors` on ANY throw from the `Classifier` impl, including contract violations. Test this as the specified behavior.
3. **Stage 6 summarizer failure** — SPEC §19.5 says "fall back to heading-path blurb." Code produces `"This excerpt is from the section '<path>' of <doc title>, covering <first sentence up to 160 chars>."` and advances the chunk.
4. **Stage 9 embedder failure** — per SPEC §22.2, documents STALL on embedder failure (`chunks.status` stays at `contextualized`, document status stays at `contextualized`). The orchestrator catches and records `errored`; a later `resume` retries. Stage 9 does NOT fall back.
5. **Re-embed command** — SPEC §27.6 specifies "create a new collection `<alias>_vN+1` with new dim, stream chunks, swap alias." In v1 the implementation **upserts into the existing alias/collection** and does not create or swap. The `VectorStorage.swapEmbedAlias` primitive is implemented but the orchestrator does not call it. Treat this as the v1 contract; the result type is still `{ rechunked: number, run_id }`.
6. **Qdrant `flipIsLatest`** returns `0` always (Qdrant `setPayload` does not report affected counts). Assert "was called" — not "affected N rows."
7. **SPEC internal inconsistency**: §6 calls the provenance field `ingestion_run_id` on Chunk; §30 (TypeScript contract) calls it `ingested_by`. Code uses `ingested_by` in TS types; SQLite column is `ingestion_run_id`. Test against `ingested_by` in TS land, `ingestion_run_id` in raw SQL.

Everything else in this brief is current, correct, and tested-intent-aligned.

---

## 1. What the tool does

**`@june/mcp`** is a CLI-driven ingestion pipeline. It takes authored Markdown files on disk and produces, in two persistent stores:

- **Qdrant** — one enriched, embedded chunk per atomic retrievable unit, with a 29-field payload index (dense + BM25 sparse vectors, Six Pillars metadata, `is_latest` versioning flag).
- **SQLite** (the "sidecar") — full provenance: documents, sections, chunks (raw content + contextual summary + embedding metadata), ingestion runs, errors, reconcile events, single-writer lock.

The bar: a 14B local model reading chunks from this pipeline should beat no-RAG Opus on questions about the ingested corpus. This is achieved via dense metadata, not clever chunking alone.

One process per CLI invocation. No daemon. Crash-safe (resume replays from persisted status). Offline-enforced (only `OLLAMA_URL` and `QDRANT_URL` hostnames allowed outbound, enforced architecturally by wrapping `globalThis.fetch`).

---

## 2. Running the tool

### 2.1 Environment variables (required — hard-fail at startup if unset)

| Var | Purpose |
|---|---|
| `OLLAMA_URL` | URL to Ollama server |
| `QDRANT_URL` | URL to Qdrant server |
| `OLLAMA_EMBED_MODEL` | Embedding model name (e.g. `nomic-embed-text`) |
| `OLLAMA_CLASSIFIER_MODEL` | Classifier model name (e.g. `llama3.2:3b`) |
| `OLLAMA_SUMMARIZER_MODEL` | Summarizer model name |

Optional: `QDRANT_API_KEY`, `LOG_LEVEL` (overrides `config.log.level`), `CONFIG_PATH` (overrides discovery).

Access exclusively through `getEnv()` from `@/lib/env`. Never `process.env` direct. First call parses + caches. Subsequent calls return the cached value.

### 2.2 Config file (`config.yaml`)

Discovery order: `--config <path>` > `CONFIG_PATH` env > `./config.yaml` > `~/.config/june/config.yaml` > shipped defaults.

Access through `loadConfig(path?)` then `getConfig()`. `loadConfig` always overwrites the singleton (safe for tests). `getConfig()` throws `ConfigNotInitializedError` before `loadConfig` runs. A fresh install with no `config.yaml` anywhere runs on shipped defaults.

Full config keys (all with defaults):

```yaml
sidecar: { path: ./june.db }
log: { level: info, output: stdout }
chunk: { target_tokens: 500, min_tokens: 100, max_tokens: 1000, overlap_pct: 0.15 }
ingest: { max_file_bytes: 52428800 }
embedding: { batch_size: 32, matryoshka_dim: null, max_input_chars: 30000 }
bm25: { stopwords: [] }
classifier:
  implementation: ollama   # ollama | stub | mock
  tag_extensions: []
  fallbacks:
    category: reference
    section_role: reference
    answer_shape: concept
    audience: [engineering]
    audience_technicality: 3
    sensitivity: internal
    lifecycle_status: published
    stability: stable
    temporal_scope: current
    source_trust_tier: derived
    prerequisites: []
    self_contained: true
    negation_heavy: false
    tags: []
summarizer: { implementation: ollama, long_doc_threshold_tokens: 6000 }
ollama:
  embed_timeout_ms: 60000
  classifier_timeout_ms: 60000
  summarizer_timeout_ms: 60000
  first_call_timeout_ms: 300000
  retry: { base_ms: 1000, max_attempts: 3 }
  embed_retry_max_attempts: 5
  classifier_retry_max_attempts: 3
  summarizer_retry_max_attempts: 3
qdrant: { upsert_batch_size: 128, retry: { base_ms: 1000, max_attempts: 4 } }
reconcile: { mode: manual, cron: "" }  # off | manual | scheduled
sources: {}  # optional path-prefix → { source_system, source_type, namespace, project }
```

### 2.3 CLI commands

| Command | Behavior |
|---|---|
| `init` | Apply SQLite DDL, create Qdrant collections + aliases + payload indexes, probe embedder dim. Idempotent — safe to re-run. |
| `ingest <path> [--version <s>] [--verify-offline]` | File or directory (recursive). `--version` overrides version resolution. |
| `status [<doc_id>]` | Read-only: last run summary + per-status doc counts + 24h error count + lock state; or per-doc version history. |
| `resume` | Replay every document whose status is NOT in `{stored, failed, skipped_empty, skipped_metadata_only, deleted}`. |
| `reindex <doc_id>` | Hard-delete the latest version's chunks, then re-ingest from the recorded `source_uri`. |
| `purge <doc_id> [--all-versions] [--yes]` | Delete Qdrant points + SQLite rows. Without `--yes`, prompts and exits 4. Default purges only latest version. |
| `reconcile [--dry-run] [--purge]` | Forward scan vanished-file soft-delete; reverse scan Qdrant-orphan delete. Dry-run records `dry_run_would_delete` events. |
| `re-embed --embedding-model <name> [--collection internal\|external\|all] [--yes]` | Re-run Stage 9+10 for every chunk with a new model. Requires `--yes`. |
| `health` | Probe SQLite + Qdrant + Ollama. Exit 0 if all 3 reachable, 3 otherwise. Read-only. |
| `bench <corpus-path> [--out <file>]` | Throughput/latency harness (stub-backed models); writes per-stage timings JSON. |

### 2.4 Shared flags

| Flag | Effect |
|---|---|
| `--config <path>` | Override config discovery |
| `--quiet` | Suppress stderr progress (logs still flow) |
| `--json-log` | Silent progress + switch logger to single-line JSON |
| `--verify-offline` | Actively exercise the offline guard at startup |
| `--yes` / `-y` | Skip confirmation (`purge`, `re-embed`) |
| `--help` / `-h` | Help + exit 0 |
| `--version` | Top-level: print june's package version, exit 0. On `ingest`: document version override. |

### 2.5 Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Generic / catastrophic / fatal-config |
| 2 | Another ingest is running (lock held) |
| 3 | Health check failed (only from `health`) |
| 4 | User aborted at confirmation prompt |
| 64 | CLI usage error (unknown command, missing argument) |

### 2.6 Progress output (§27.4)

`ingest` and `resume` default to per-stage lines on **stderr**:

```
[1/23] file:///repo/docs/api/auth.md  parsed
[1/23] file:///repo/docs/api/auth.md  chunked (12 chunks, 4 sections)
[1/23] file:///repo/docs/api/auth.md  contextualized
[1/23] file:///repo/docs/api/auth.md  embedded
[1/23] file:///repo/docs/api/auth.md  stored
[1/23] file:///repo/docs/api/auth.md  done in 3412ms  ETA: 22 docs remaining, est. ~75s
```

ETA kicks in after doc #5. `--quiet` or `--json-log` → silent reporter (no stderr output).

---

## 3. Data model

### 3.1 Branded ID types

Constructors throw `InvalidIdError` on format mismatch. All live in `src/types/ids.ts`, exported from `src/index.ts`.

| Type | Format | Source |
|---|---|---|
| `DocId` | 64-char lowercase hex (sha256) | `deriveDocId(source_uri)` |
| `ChunkId` | 64-char lowercase hex (sha256) | `deriveChunkId(doc_id, version, char_offset_start, char_offset_end, schema_version)` — **excludes embedding model** so re-embed preserves the ID |
| `SectionId` | 64-char lowercase hex (sha256) | `deriveSectionId(doc_id, heading_path, char_offset_start)` — pipe-separated input |
| `RunId` | 26-char Crockford base32 ULID | `ulid()` from `ulid` package |
| `Version` | Free-form string | CLI flag > frontmatter > ISO-8601 ingest-start timestamp |

Qdrant point IDs are UUID-shaped, derived via `chunkIdToQdrantPointId(chunk_id)` — takes the first 128 bits of the chunk_id hex and formats `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`.

### 3.2 Document (SQLite row)

```ts
type Document = {
  doc_id: DocId;
  version: Version;              // composite PK with doc_id
  schema_version: number;
  source_uri: string;            // file:// URL
  source_system: SourceSystem;   // from SOURCE_SYSTEM_VALUES
  source_type: SourceType;       // internal | external
  namespace: string;
  project: string | undefined;
  document_title: string;
  content_hash: string;          // sha256 hex of normalized bytes
  byte_length: number;
  source_modified_at: string | undefined;
  ingested_at: string;
  ingested_by: RunId;
  status: DocumentStatus;
  is_latest: boolean;
  deleted_at: string | undefined;  // set by reconcile / purge
  doc_category: Category | undefined;
  doc_sensitivity: Sensitivity | undefined;
  doc_lifecycle_status: LifecycleStatus | undefined;
  frontmatter: Readonly<Record<string, unknown>>;
};
```

### 3.3 Section (SQLite row)

```ts
type Section = {
  section_id: SectionId;
  doc_id: DocId;
  version: Version;              // composite PK with section_id
  heading_path: ReadonlyArray<string>;  // e.g. ["Doc Title", "Section A", "Subsection"]
  char_offset_start: number;
  char_offset_end: number;
  content: string;
  role: SectionRole | undefined;
};
```

### 3.4 Chunk (Six Pillars)

The canonical in-memory chunk. Stored to SQLite (subset) + Qdrant (payload).

```ts
type Chunk = {
  // Pillar 1 — Identity
  chunk_id: ChunkId;
  doc_id: DocId;
  version: Version;
  section_id: SectionId;
  source_type: SourceType;
  content_type: ContentType;       // "doc" in v1
  schema_version: number;
  chunk_index_in_document: number;
  chunk_index_in_section: number;
  is_latest: boolean;

  // Pillar 2 — Provenance
  source_uri: string;
  source_system: string;
  document_title: string;
  heading_path: ReadonlyArray<string>;
  span: {
    byte_offset_start: number; byte_offset_end: number;
    char_offset_start: number; char_offset_end: number;
    line_start: number; line_end: number;
  };
  content_hash: string;
  source_modified_at: string | undefined;
  ingested_at: string;
  ingested_by: RunId;

  // Pillar 3 — Classification
  classification: {
    namespace: string;
    project: string | undefined;
    category: Category;
    section_role: SectionRole;
    answer_shape: AnswerShape;
    audience: ReadonlyArray<Audience>;    // 1–3 values
    audience_technicality: 1 | 2 | 3 | 4 | 5;
    sensitivity: Sensitivity;
    lifecycle_status: LifecycleStatus;
    stability: Stability;
    temporal_scope: TemporalScope;
    source_trust_tier: SourceTrustTier;
    prerequisites: ReadonlyArray<string>;
    self_contained: boolean;
    negation_heavy: boolean;
    tags: ReadonlyArray<string>;          // filtered against TAGS_DEFAULT ∪ tag_extensions
  };

  // Pillar 4 — Signals
  structural_features: {
    token_count: number;
    char_count: number;
    contains_code: boolean;
    code_languages: ReadonlyArray<string>;
    has_table: boolean;
    has_list: boolean;
    link_density: number;                 // links per 1000 chars or similar
    language: string | undefined;
  };
  runtime_signals: {
    quality_score: number;                // 0–1, default 0.5
    freshness_decay_profile: FreshnessDecay;  // slow | medium | fast | never
    authority_source_score: number;       // 0–1
    authority_author_score: number;       // 0–1
    retrieval_count: number;
    citation_count: number;
    user_marked_wrong_count: number;
    last_validated_at: string | undefined;
    deprecated: boolean;
  };

  // Pillar 5 — Context-Injection
  contextual_summary: string;     // 50–1200 chars
  embed_text: string;             // title → heading_path → summary → content
  is_continuation: boolean;       // true if chunk_index_in_section > 0

  // Pillar 6 — Relationships
  relationships: {
    references: ReadonlyArray<{ doc_id: DocId } | { section_id: SectionId }>;
    external_links: ReadonlyArray<string>;
    unresolved_links: ReadonlyArray<string>;
    canonical_for: ReadonlyArray<string>;
    siblings: ReadonlyArray<ChunkId>;
    previous_chunk_id: ChunkId | undefined;
    next_chunk_id: ChunkId | undefined;
    supersedes: ChunkId | undefined;
    superseded_by: ChunkId | undefined;
  };

  type_specific: { content_type: "doc"; version: string } | /* phase-7 variants */;

  content: string;                 // SQLite-only, payload.content at Qdrant
  embedding_model_name: string;
  embedding_model_version: string;
  embedding_dim: number;
  embedded_at: string;
  status: ChunkStatus;
};
```

### 3.5 Controlled vocabularies (exported arrays)

All arrays are `as const` tuples; Zod enums source from them. Test that each enum exactly matches these sets.

- `CATEGORY_VALUES` — 15: `tutorial, how-to, reference, explanation, policy, spec, release-notes, changelog, incident, runbook, decision-record, api-doc, code-doc, faq, glossary`
- `SECTION_ROLE_VALUES` — 8: `overview, concept, procedure, reference, example, warning, rationale, appendix`
- `ANSWER_SHAPE_VALUES` — 7: `definition, step-by-step, code-example, comparison, decision, concept, lookup`
- `AUDIENCE_VALUES` — 12: `engineering, ops, security, data-science, product, design, sales, support, legal, finance, executive, general`
- `SENSITIVITY_VALUES` — 4: `public, internal, confidential, restricted`
- `LIFECYCLE_VALUES` — 5: `draft, review, published, deprecated, archived`
- `STABILITY_VALUES` — 3: `stable, evolving, experimental`
- `TEMPORAL_VALUES` — 3: `timeless, current, historical`
- `TRUST_TIER_VALUES` — 4: `first-party, derived, third-party, user-generated`
- `FRESHNESS_DECAY_VALUES` — 4: `slow, medium, fast, never`
- `SOURCE_TYPE_VALUES` — 2: `internal, external`
- `CONTENT_TYPE_VALUES` — phase-1: `doc`; reserved: `endpoint, schema, code, conversation`
- `DOCUMENT_STATUS_VALUES` — 10: `pending, parsed, chunked, contextualized, embedded, stored, failed, skipped_empty, skipped_metadata_only, deleted`
- `CHUNK_STATUS_VALUES` — 5: `pending, contextualized, embedded, stored, failed`
- `INGEST_STAGE_VALUES` — 10 stage labels: `"1"` through `"10"`
- `RUN_TRIGGER_VALUES` — 4: `cli, api, reconcile, re-embed` (+ `init` used by harness)
- `RECONCILE_EVENT_TYPE_VALUES` — `soft_delete_document, hard_delete_chunks, qdrant_orphan_deleted, dry_run_would_delete`
- `RECONCILE_REASON_VALUES` — `file_vanished, qdrant_orphan, manual_purge`
- `SOURCE_SYSTEM_VALUES` — `local, github, notion, slack, linear, confluence, gdrive, other`

Seed mappings (must match spec §12):
- `SOURCE_SYSTEM_TO_SOURCE_TYPE` — e.g. `github, local → internal`
- `SOURCE_SYSTEM_TO_AUTHORITY_SCORE` — number per system
- `CATEGORY_TO_FRESHNESS_DECAY` — `release-notes → fast`, `glossary → never`, etc.

### 3.6 Error types (§25.6)

`ERROR_TYPE_VALUES` is a `const` tuple; `ErrorType` is the union. `isErrorType(s: string): s is ErrorType` narrows. `IngestionError.error_type` is typed `ErrorType`. The set includes at least:

`file_too_large, encoding_undetectable, frontmatter_parse_failed, mdast_parse_failed, oversize_protected_region, classifier_*, vocab_unknown_tag, summarizer_*, embed_text_truncated, embedder_*, qdrant_*, sqlite_busy, sqlite_disk_full, ollama_*, shutdown_during_stage, lock_broken_stale, embedding_model_mismatch, catastrophic`.

---

## 4. Pipeline stages

Each stage is a pure function of its typed input. Orchestrator (`ingestPath` in `src/pipeline/ingest.ts`) sequences them, owns transaction boundaries, and handles document-level status transitions.

### Stage 1 — Discover (`runStage1`)

**Input**: absolute path, `runId`, `runVersion`, optional `cliVersion`, `sidecar`, `tx`.

**Behavior**:
1. Read bytes. If size > `config.ingest.max_file_bytes` → `{ kind: 'skipped_too_large' }`, write `ingestion_errors` row with `error_type='file_too_large'`. Return.
2. Resolve `source_uri` as `file://<realpath>`.
3. Compute `doc_id = deriveDocId(source_uri)`, `content_hash = sha256_hex(bytes)`.
4. Check if a prior version exists with the same `content_hash` → `{ kind: 'unchanged' }` (skip).
5. Resolve `version`: CLI flag > frontmatter `version:` > `runVersion` (ISO-8601 start timestamp).
6. Extract source binding: `config.sources[<path-prefix>]` with defaults, yielding `{ source_system, source_type, namespace, project }`.
7. Upsert `Document` row at `status='pending'`, `is_latest=true`. Flip prior latest `is_latest=false` inside the same tx.
8. If the doc existed under the same `doc_id` + same `version` but with `status != 'stored'` → `{ kind: 'resume', document, rawBytes }`.
9. If same `doc_id` + same `version` under `status='deleted'` → `{ kind: 'resurrection', document, rawBytes }` (clears `deleted_at`).
10. Otherwise → `{ kind: 'ingest', document, rawBytes }`.

**Testable assertions**:
- Deterministic `doc_id` from `source_uri`.
- Size check gated by config.
- Frontmatter `version:` beats runVersion.
- CLI `--version` beats frontmatter.

### Stage 2 — Parse (`runStage2`)

**Input**: `{ document, rawBytes, runId, sidecar, tx }`.

**Behavior**:
1. **Normalize** bytes → UTF-8 string: BOM detection (UTF-8 BOM, UTF-16 BE/LE); UTF-8 strict decode, fall back to Windows-1252; normalize line endings to LF (`\r\n` and `\r` → `\n`); strip zero-width chars (`\u200B, \u200C, \u200D, \u2060, \uFEFF`).
2. On encoding-detection failure: `{ kind: 'failed', error_type: 'encoding_undetectable', error_message }`, write error row, set document `status='failed'`.
3. Split frontmatter (`---\n...\n---\n` at start; else empty). Parse YAML; on parse failure, write `frontmatter_parse_failed`, continue with `{}`.
4. Parse body with `mdast-util-from-markdown` + GFM extensions. On throw: `{ kind: 'failed', error_type: 'mdast_parse_failed' }`, set `status='failed'`.
5. **Skipped** outcomes:
   - Empty body after trimming → `{ kind: 'skipped_empty' }`, doc `status='skipped_empty'`.
   - Frontmatter present + body whitespace-only → `{ kind: 'skipped_metadata_only' }`.
6. Resolve `document_title`: frontmatter `title` > first H1 in mdast > de-extensioned, de-kebab/snake-cased filename title-cased (e.g. `oauth-refresh.md` → `"Oauth Refresh"`).
7. Output: `{ kind: 'parsed', parsed: { document, raw_normalized: string, ast, frontmatter } }`. Sets `status='parsed'`.

**Exported helpers** (testable in isolation): `splitFrontmatter(normalized)` → `{ frontmatter, body, bodyOffset }`; `resolveDocumentTitle(frontmatterTitle, ast, source_uri)` → string.

### Stage 3 — Chunk (`runStage3`)

**Input**: `{ parsed, sidecar, tx }`.

**Behavior**:
1. `sectionize` the mdast → `Section[]`. Prelude content before the first H1 becomes a section with `heading_path=[document_title]`. Sections cover the body end-to-end.
2. For each section, `chunkSection(body, ast, start, end, { targetTokens, minTokens, maxTokens, overlapPct }, sectionId)`:
   - Target ~500 tokens (configurable), hard floor/ceiling from config.
   - **Protected regions** — chunk boundaries **never** fall inside code fences, tables, lists, or blockquotes (SPEC §16.2). An oversize protected region that exceeds `max_tokens` emits a chunk over ceiling and writes `oversize_protected_region` error.
   - Consecutive chunks in the same section share an overlap of `overlapPct * target_tokens` characters.
3. Chunk IDs via `deriveChunkId(doc_id, version, char_offset_start, char_offset_end, schema_version)` — deterministic; same inputs → same ID.
4. Persist sections + chunks (at `status='pending'`) in one tx; doc `status='chunked'`.

**Output**: `ChunkedDocument = { document, sections, chunks: UnclassifiedChunk[] }`.

**Testable assertions**:
- No chunk boundary inside a protected region (use `computeProtectedRanges(ast)` + `isInsideProtected(offset, ranges)`).
- Same content → same chunk IDs across runs.
- Different version → different chunk IDs even for identical offsets.
- Section cover is contiguous.

### Stage 4 — Derive (`runStage4` — pure CPU)

**Input**: `ChunkedDocument`.

**Behavior**: Re-parse each chunk's `content` mini-AST. Populate:
- `contains_code` — any code node present.
- `code_languages` — fenced info-strings, lowercased, deduped.
- `has_table`, `has_list`.
- `link_density` — link count relative to text size.

Output: chunks now carry `structural_features`. No SQLite write (fields are computed at Stage 10 payload time).

**Exported helper**: `structuralFeaturesFor(rawContent, source_uri)` → `ChunkStructuralFeatures`.

### Stage 5 — Classify (`runStage5`)

**Input**: `{ chunks, classifier, sidecar, runId, binding: { namespace, project } }`.

**Behavior**: For each chunk,
1. Call `classifier.classify({ chunk_id, chunk_content, document_title, heading_path })`.
2. Merge `namespace` + `project` from the binding (classifier never sets these).
3. `filterTags` drops tags not in `TAGS_DEFAULT ∪ config.classifier.tag_extensions`; dropped tags record `vocab_unknown_tag` with a comma-separated list in `error_message`.
4. **Fallback on any impl throw** (§18.6): apply `config.classifier.fallbacks` values as a full `ChunkClassification`, record `error_type='classifier_fallback'` with the original error message (first 200 chars), advance the chunk normally. No re-throw.

**Output**: chunks with `classification` filled.

### Stage 6 — Summarize (`runStage6`)

**Input**: `{ document, body, sections, chunks, summarizer, sidecar, tx, runId }`.

**Behavior**:
1. If `approximateTokens(body) > config.summarizer.long_doc_threshold_tokens`: call `summarizer.summarizeDocument(document_title, body)` → `DocumentOutline`. On throw: record `summarizer_outline_failed`, continue with `outline=undefined`.
2. For each chunk:
   - Pick `containing_text`: long-doc → parent section's content; short-doc → full body.
   - Call `summarizer.summarizeChunk({ chunk_id, chunk_content, document_title, heading_path, containing_text, outline? })`.
   - **Fallback on throw** (§19.5): deterministic blurb `"This excerpt is from the section '<heading_path.join(' > ')>' of <document_title>, covering <first sentence up to 160 chars>."` Record `summarizer_unreachable`, persist, advance.
3. `sidecar.setChunkSummary(tx, chunk_id, summary)` per chunk.
4. Advance doc `status='contextualized'`.

**Output**: chunks with `contextual_summary`.

### Stage 7 — Link (`runStage7`)

**Input**: `{ chunks, sidecar }`.

**Behavior**: Re-parse each chunk's content. For each link node:
- HTTP(S) → `external_links` (append fragment if present).
- `mailto:`, `tel:`, `javascript:`, `data:` → ignore.
- Absolute path / file URI / relative path → try resolving against the chunk's `source_uri`:
  - Look up `sidecar.getLatestDocumentByUri(resolved)`. If found and not deleted → `references.push({ doc_id })`.
  - If the link has a `#fragment`: lookup the resolved doc's sections, match fragment as GitHub-style slug (lowercase + kebab-case) against the last heading of each section's `heading_path`, with suffix-dedupe (`-1`, `-2`, …) for collisions. Found → `references.push({ section_id })`. Not found → `unresolved_links`.
- Pure `#fragment` (no URL) → `unresolved_links`.

Siblings/prev/next are filled at Stage 10, not Stage 7. Stage 7's output only populates `references, external_links, unresolved_links`.

### Stage 8 — Embed text (`runStage8`)

**Input**: `{ chunks, sidecar, runId }`.

**Behavior**: For each chunk, compose `embed_text` per `composeEmbedText({ document_title, heading_path, contextual_summary, content, maxChars })`. Ordering: `title`, `heading_path.join(" > ")`, `contextual_summary`, then `content`, separated by blank lines.

Truncation hierarchy when total > `maxChars`:
1. Truncate content first.
2. If still over, shorten `contextual_summary`.
3. If still over, drop leading heading-path components but preserve the tail (`"D > E"` retained even if `"A > B > C"` is cut).
4. If still over after all steps: truncate final text to cap. Record `embed_text_truncated` with `size_chars`.

**Output**: chunks with `embed_text`. No document status change.

### Stage 9 — Embed (`runStage9`)

**Input**: `{ document, chunks, embedder, sidecar, tx, runId }`.

**Behavior**:
1. Batch chunks by `config.embedding.batch_size`.
2. `embedder.embed(texts)` → dense vectors per chunk.
3. `bm25Vectorize(chunk.embed_text)` → `{ indices, values }` sparse vector.
4. Persist `embedding_model_name, embedding_model_version, embedded_at` per chunk; `chunks.status='embedded'`.
5. Doc `status='embedded'`.

**Failure**: on `embedder.embed` throw, record `embedder_unreachable`, **re-throw** (doc stalls; resume retries). On undefined per-chunk vector from a successful batch, throw.

**BM25 behavior**:
- Deterministic: same text → same indices + values.
- Tokens < 2 chars dropped.
- Term frequency = count (raw TF).

### Stage 10 — Store (`runStage10`)

**Input**: `{ document, chunks, priorVersion, vector, sidecar, tx, runId }`.

**Behavior**: In one SQLite tx:
1. Compute per-chunk payload: flattened (classification, structural_features, runtime_signals, Pillar 5/6 fields), including `is_latest=true` and full payload index fields.
2. Upsert points into Qdrant (collection = `"internal"` or `"external"` based on `document.source_type`).
3. If `priorVersion` exists: `vector.flipIsLatest(collection, doc_id, priorVersion)` + `sidecar.flipPriorIsLatest(tx, doc_id, new_version)`.
4. Clear `deleted_at` on current version (resurrection path).
5. Each chunk `status='stored'`, doc `status='stored'`.

---

## 5. Storage

### 5.1 `VectorStorage` interface (Qdrant in v1)

```ts
{
  name: "qdrant" | string;
  ensureCollections(dim: number): Promise<void>;   // creates internal_v1, external_v1; payload indexes; aliases
  upsert(points): Promise<void>;
  flipIsLatest(alias, doc_id, prior_version): Promise<number>;   // returns 0 in v1
  deletePointsByChunkIds(alias, chunk_ids): Promise<number>;
  deletePointsByDocId(alias, doc_id): Promise<number>;
  scrollAllChunkIds(alias, batchSize): AsyncIterable<readonly ChunkId[]>;
  swapEmbedAlias(alias, new_collection): Promise<void>;
  probeReachable(): Promise<boolean>;
}
```

Qdrant collections:
- `internal_v1`, `external_v1` — named-vector config: dense (Cosine distance) + `bm25` sparse (IDF modifier).
- Aliases `internal`, `external` point to those.
- 29 payload indexes — all enum/keyword classification fields, `is_latest` (bool), datetime fields, floats, `source_modified_at`, `embedding_model_name`. Verify against `PAYLOAD_INDEXES` in `src/lib/storage/qdrant.ts`.

### 5.2 `SidecarStorage` interface (SQLite in v1)

Key methods (not exhaustive):
- `begin() → Tx`
- **Lock (I2)**: `acquireWriteLock(runId)` throws `SidecarLockHeldError` if a fresh lock is held (heartbeat < 90s old); breaks and acquires if stale. `heartbeat(runId)` updates `last_heartbeat_at`. `releaseWriteLock(runId)` drops the row.
- Runs: `putRun`, `updateRun`.
- Documents: `upsertDocument`, `getLatestDocumentByUri`, `getLatestDocument`, `getDocument`, `setDocumentStatus`, `flipPriorIsLatest`, `clearDeletedAt`, `listLatestDocuments`, `listDocumentsByStatus`, `listVersionsForDoc`.
- Sections: `putSections`, `getSectionsForDoc`.
- Chunks: `putChunks`, `setChunkStatus`, `setChunkSummary`, `setChunkEmbedded`, `getChunksForDoc`, `getChunksByStatus`, `chunkExistsInSidecar`, `countChunksWithDifferentEmbeddingModel(expected_model)`.
- Errors/events: `recordError(Omit<IngestionError, "id">) → Promise<number>`, `recordReconcileEvent`.
- `close()`, `probeReachable()`.

Single-writer lock is one row (`LOCK_ID=1`) — NOT per-document.

### 5.3 SQLite DDL (summary)

Tables: `documents` (PK `(doc_id, version)`), `sections` (PK `(section_id, version)`), `chunks` (PK `chunk_id`), `ingestion_runs` (PK `run_id`), `ingestion_errors` (autoincrement id, append-only), `reconcile_events` (autoincrement id, append-only), `ingestion_lock` (singleton with `LOCK_ID=1`).

Pragmas applied at open: `journal_mode=WAL, synchronous=NORMAL, foreign_keys=ON, busy_timeout=5000`.

`documents` columns (order-insensitive): `content_hash, deleted_at, doc_id, ingested_at, ingestion_run_id, is_latest, schema_version, source_modified_at, source_uri, status, version`.

CHECK constraints: `documents.status` ∈ `DOCUMENT_STATUS_VALUES`, `chunks.status` ∈ `CHUNK_STATUS_VALUES`, `reconcile_events.event_type` ∈ `RECONCILE_EVENT_TYPE_VALUES`, `reconcile_events.reason` ∈ `RECONCILE_REASON_VALUES`.

Schema is idempotent: applying `schema.sql` twice produces the same tables (uses `IF NOT EXISTS`).

---

## 6. Key invariants (I1–I14)

All testable at module or integration level.

1. **I1 — Versioning, no partial re-ingest.** A content change → new version ingested in full. Prior versions retained. `is_latest` flips atomically on both Qdrant (payload) and SQLite (column).
2. **I2 — Single-writer lock.** Two concurrent `acquireWriteLock` calls → second throws `SidecarLockHeldError`. Stale lock (`heartbeat` > 90s ago) is broken.
3. **I3 — Encoding normalization.** Stage 2 always produces valid UTF-8 + LF + no zero-width.
4. **I4 — Reconciliation, not deletion tracking.** No filesystem watcher; `reconcile` is the deletion path.
5. **I5 — Full re-embed on model change.** `re-embed` command re-runs Stages 9+10 for every chunk with the new model.
6. **I6 — No prompt-injection defense in v1.** Classifier/summarizer prompts wrap content in tags but no runtime filtering.
7. **I7 — Logger forbids raw content at type level.** The `Logger` interface rejects `content, text, body, chunk, markdown` fields at compile time. A test with `@ts-expect-error` markers verifies this tripwire (if those lines ever compile clean, the tripwire fires).
8. **I8 — Graceful shutdown.** `isShutdownRequested()` returns true after `requestShutdown(signal)`. Pipeline drains between document boundaries. SIGINT/SIGTERM wired by `installSignalHandlers()`.
9. **I9 — Error does not exit.** All non-catastrophic errors write an `ingestion_errors` row and the pipeline continues.
10. **I10 — Offline guard.** `globalThis.fetch` is wrapped; any hostname not in the whitelist throws `OfflineWhitelistViolation` *synchronously from fetch's return path*. Whitelist is derived from `{OLLAMA_URL, QDRANT_URL}` hostnames only — no implicit `localhost` / `127.0.0.1` fallback.
11. **I11 — Sections are not embedded.** Only chunks get dense vectors. Sections exist in SQLite for retrieval-by-ID lookups.
12. **I12 — Bun + TS strict, no `any`.** Not a runtime invariant, but tests should not introduce `any`.
13. **I13 — Env-vs-config split.** Env = secrets + model names; yaml = tunables.
14. **I14 — Package gate.** Adopted packages: `@qdrant/js-client-rest`, `bun:sqlite`, `winston`, `zod`, `yaml`, `mdast-util-from-markdown`, `mdast-util-gfm`, `micromark-extension-gfm`, `ulid`. Nothing else at runtime.

---

## 7. Public TypeScript API

All via `import { ... } from "@june/mcp"` (= `packages/mcp/src/index.ts`):

**Types + IDs**: `Chunk, Document, Section, Run, IngestionError, ReconcileEvent`, branded ID types + constructors (`asDocId, asChunkId, asRunId, asSectionId, asVersion, InvalidIdError`).

**Vocabularies**: all `*_VALUES` arrays + type unions.

**Schemas**: `ChunkSchema, DocumentSchema, SectionSchema, FrontmatterSchema, ClassifierOutputSchema, DocumentOutlineSchema` + `type *Json = z.infer<typeof *Schema>`.

**Errors**: all typed `*Error` classes for `instanceof` checks.

**Error types**: `ERROR_TYPE_VALUES, ErrorType, isErrorType`.

**Env + config**: `getEnv, getConfig, loadConfig, type Env, type Config`.

**Storage**: interfaces (`SidecarStorage, VectorStorage, StorageInterface, VectorPoint, Tx`), factories (`createSqliteSidecar, createQdrantStorage, baseCollectionName`).

**Offline + shutdown + progress**: `computeWhitelist, installOfflineGuard, verifyOffline`, `installSignalHandlers, isShutdownRequested, requestShutdown, signalReceived`, `createProgressReporter, createSilentReporter`.

**Logger**: `type Logger, type LogFields` (value is module-scoped — import directly from `@/lib/logger` inside the package).

**IDs**: `deriveDocId, deriveChunkId, deriveSectionId, deriveContentHash, deriveContentHashBytes, chunkIdToQdrantPointId`.

**Embedder + classifier + summarizer**: interface types + Ollama factories + stub factories for tests (`createStubEmbedder(dim), createStubClassifier(), createStubSummarizer()`).

**Pipeline entry points**: `ingestPath, resumeRun, reconcile, reembed, purge, health, buildDeps`.

---

## 8. Test fixture patterns

### 8.1 Build pipeline deps with stubs

```ts
import {
  createStubClassifier, createStubEmbedder, createStubSummarizer,
  createSqliteSidecar,
} from "@june/mcp";

const sidecar = await createSqliteSidecar(":memory:");
const vector = makeInMemoryVector();  // test helper — see below
const deps = {
  classifier: createStubClassifier(),
  summarizer: createStubSummarizer(),
  embedder: createStubEmbedder(32),
  storage: { sidecar, vector },
};
```

### 8.2 In-memory vector backend for tests

Implement `VectorStorage` with Maps. Methods like `ensureCollections`, `flipIsLatest`, `swapEmbedAlias`, `probeReachable` return `resolved`/`0`/`true`. `upsert` records into a `Map<collection, Map<point_id, VectorPoint>>`. `scrollAllChunkIds` yields from the map.

### 8.3 Standard setup

Always `await loadConfig(undefined)` in `beforeAll` so `getConfig()` works. Use `mkdtemp(tmpdir())` for per-test sandboxes.

### 8.4 Offline guard around test

```ts
import { computeWhitelist, installOfflineGuard, uninstallOfflineGuard } from "@june/mcp";
// The uninstall helper is test-only, exported from @/lib/offline-guard.
```

### 8.5 Shutdown reset between tests

```ts
import { _resetShutdown } from "@/lib/shutdown";  // test-only, NOT re-exported from src/index.ts
afterEach(() => _resetShutdown());
```

---

## 9. What NOT to test (out of scope)

- **Retrieval / query side** — separate future package.
- **Specific Ollama HTTP wire format** — test at the `Classifier`/`Summarizer`/`Embedder` interface level with stubs. Ollama-specific tests belong in integration suites that require a live Ollama.
- **Live Qdrant**. Use the in-memory `VectorStorage`.
- **Performance numbers.** Benchmark harness exists but produces descriptive data; no assertions on throughput.
- **Prompt content.** I6 marks prompt-injection out of scope. Don't test "classifier refused an adversarial chunk."
- **Watch mode / daemon.** No daemon; `reconcile` runs under external cron.

---

## 10. Where to put tests

Repo layout (`packages/mcp/test/`):

- `chunker/` — structural invariants (protected regions, overlap, determinism).
- `classifier/` — fallback, tag filter, prompt construction.
- `offline/` — offline guard behavior under various URL shapes.
- `observability/` — I7 type-level logger assertions, Part-IV additions (error types, shutdown, progress).
- `pipeline/` — stage-by-stage and end-to-end.
- `storage/` — SQLite DDL, lock semantics, round-trip.
- Top-level: `smoke.test.ts` (cross-cutting), `parity.test.ts` (chunk ↔ schema + config discovery).

Import alias: `@/` maps to `packages/mcp/src/`. Test files import via the alias or via the package index `@june/mcp`.

Test runner: `bun test`. No Jest, no Vitest.

---

Good luck. If the code's behavior diverges from this brief, the code is wrong — file it.
