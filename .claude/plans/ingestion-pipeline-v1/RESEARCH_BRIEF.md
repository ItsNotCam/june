# june — Research Brief for Ingestion Pipeline Spec

**Purpose.** This is the distilled source material for the ingestion pipeline spec. Every finding below has a citation. The spec references this document, not the original sources. This brief is what lets a fresh chat pick up and write the spec without re-doing the research pass.

---

## 1. Chunking — what the benchmarks actually say

### 1.1 The semantic-chunking trap
**Finding.** Semantic chunking is overhyped. Vectara NAACL 2025 (Qu, Bao, Tu — *Is Semantic Chunking Worth the Computational Cost?*, arXiv:2410.13070) tested three chunker families on document retrieval, evidence retrieval, and answer generation. **Fixed-size chunking consistently outperformed or matched semantic chunking.** The computational cost of semantic chunking is not justified by consistent performance gains.

**Implication for june.** Do NOT implement semantic-embedding-based chunking. Recursive structural chunking is the right default.

### 1.2 Benchmark-validated defaults (2026)
- **Chunk size:** 256–512 tokens is the sweet spot. FloTorch 2026 found recursive character splitting at 512 tokens with 50–100 token overlap scored 69% accuracy — the top of the benchmark. NVIDIA found factoid queries work well at 256–512, analytical/multi-hop at 512–1024.
- **Overlap:** 10–20% of chunk size. NVIDIA tested 10/15/20% — 15% performed best on FinanceBench. Never skip overlap entirely; even 10% recovers context lost at boundaries.
- **Context cliff:** Chunks >2500 tokens show sharp quality drop (Firecrawl Jan 2026). Hard ceiling well below this.
- **Fragment floor:** Chunks <100 tokens give LLM too little context to generate correct answers even when retrieval recall is high (FloTorch — semantic chunker produced 43-token fragments; 54% accuracy despite good recall).

**Implication for june.** Target chunk size ~450–550 tokens (treat as characters via tokenizer-agnostic counting initially, ~1800-2200 chars). Overlap 10–15%. Hard min 100 tokens, hard max ~1000 tokens per chunk.

### 1.3 The right architecture
Structure-aware recursive is best: prefer heading boundaries, fall back through paragraph → sentence → character. The power-user move (LLM Practical Experience Hub, 2026): **MarkdownHeaderTextSplitter first, then run RecursiveCharacterTextSplitter on any resulting chunks that are still too big.** This is the proven shape.

### 1.4 Structural guardrails (non-negotiable)
Never split inside:
- Code fences (fenced code blocks per CommonMark §4.5)
- Tables (GFM extension)
- List items (a single item shouldn't be split across chunks)

CommonMark: ATX headings are `#` through `######` (1-6 levels), require space after `#`, can interrupt paragraphs without blank-line separation. Setext headings use `=` (h1) or `-` (h2) underlines. Fenced code blocks use ``` ``` `` or `~~~` with optional language info string (first word = language).

---

## 2. Contextual Retrieval — the single biggest quality lever

### 2.1 Numbers (from Anthropic's original release, replicated by LlamaIndex cookbook)
- Contextual Embeddings alone: **35% reduction in top-20-chunk retrieval failure** (5.7% → 3.7%)
- Contextual Embeddings + Contextual BM25: **49% reduction** (5.7% → 2.9%)
- Add reranking on top: **67% reduction** (5.7% → 1.9%)

### 2.2 The mechanism
For every chunk, a small LLM generates a 50–100 token contextual description ("situating blurb") using both the whole document and the chunk. The blurb is prepended to the chunk before both embedding AND BM25 indexing. That's the full technique.

### 2.3 Anthropic's reference prompt (verbatim from the cookbook)
```
<document>
{{WHOLE_DOCUMENT}}
</document>
Here is the chunk we want to situate within the whole document
<chunk>
{{CHUNK_CONTENT}}
</chunk>
Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else.
```
Anthropic uses prompt caching for cost efficiency with the full document. For june (local Ollama), we can't use prompt caching the same way — but since we're offline and ingest time doesn't matter, we just pay the compute cost per chunk. No caching infrastructure needed.

### 2.4 Implementation shape
Combine context blurb with chunk: `f"{chunk.content}\n\n{contextualized_text}"` (Anthropic cookbook pattern — context goes AFTER content. LlamaIndex cookbook puts it before. Either works; Anthropic's own code puts it after. We'll put breadcrumb before, context blurb before content, for clarity of hierarchy.)

### 2.5 Local model choice for context generation
For june: use a small local model (3B-class) for the context generation. Llama 3.2 3B Instruct or Qwen 3 4B via Ollama. Ingestion is offline and slow-tolerant.

### 2.6 Knowledge base size threshold
Anthropic notes: for knowledge bases under ~200k tokens (~500 pages), contextual retrieval may be overkill — just stuff the whole KB into the prompt. June's target is much larger than that, so contextual retrieval earns its place.

---

## 3. Embedding model — Ollama-only options

### 3.1 Benchmarks (Morph, April 2026, MTEB English retrieval nDCG@10)
| Model | Params | Dims | Context | MTEB | Disk |
|-------|--------|------|---------|------|------|
| qwen3-embedding:8b | 8B | 32-4096 | 8192 | **70.58** | ~4.9GB (Q4) |
| qwen3-embedding:4b | 4B | 32-4096 | 8192 | ~67 | ~2.5GB (Q4) |
| mxbai-embed-large | 335M | 1024 | 512 | 64.68 | 670MB |
| bge-m3 | 568M | 1024 | 8192 | ~63.0 | 1.2GB |
| nomic-embed-text v1.5 | 137M | 768* | 8192 | 62.39 | 274MB |
| qwen3-embedding:0.6b | 0.6B | 32-4096 | 8192 | ~60 | ~400MB |

(*nomic supports Matryoshka reduction to 512/256/128/64)

### 3.2 Critical tradeoffs
- **mxbai-embed-large** has the best sub-500M retrieval score (64.68) BUT only 512-token context. Chunks >512 tokens get silently truncated. That's a dealbreaker for anything we want to contextualize (chunk + context blurb often exceeds 512).
- **nomic-embed-text v1.5** has the best long-context + small-size tradeoff. 8192 context. Runs on CPU. 274MB. The safe default.
- **qwen3-embedding:8b** is SOTA but needs 16GB VRAM at F16, 4-6GB at Q4. Overkill for "Lil Timmy" tier but excellent for "Enterprise Paul" tier.
- **bge-m3** supports hybrid retrieval natively (dense + sparse + multi-vector) in one model. 568M, 1.2GB, 8192 context. If we want multi-vector/ColBERT-style, this is the only Ollama option.

### 3.3 Recommendation for june
**Parameterize. Default = `nomic-embed-text` (v1.5). Config allows upgrade path to `qwen3-embedding:8b` for enterprise tier.** Both have 8192 context which supports contextual retrieval blurbs. Dimensions differ (768 vs configurable) so the Qdrant collection must be created with the matching dimension — spec this as a per-config collection, not a hardcoded schema.

Matryoshka dimension reduction on nomic-embed-text is worth noting: truncate to 512 dims for storage economy without large quality loss.

### 3.4 Ollama embedding API
Endpoint: `${OLLAMA_URL}/api/embed` (NOT `/api/embeddings` — that's deprecated since Ollama 0.2.0). `OLLAMA_URL` is an environment variable, not a config.yaml entry — it's a service endpoint and in some deployments will be a remote/internal address, not localhost. Hard-fail on startup if `OLLAMA_URL` is unset. Body: `{"model": "${OLLAMA_EMBED_MODEL}", "input": "text or [array]"}` — model name also env-var driven so upgrades are deploy-time config. Returns L2-normalized vectors. Supports batch input via array.

---

## 4. Hybrid search — BM25 + dense + RRF

### 4.1 Why hybrid is non-negotiable
Dense embeddings miss exact identifiers (IPs, error codes, function names, config flags). BM25 misses semantic matches. They fail orthogonally — combined, they catch what either alone misses. For technical documentation (june's core corpus), BOTH failure modes are common.

### 4.2 Qdrant supports this natively
Qdrant has built-in sparse vector support + dense vector support on the same collection/point. Sparse vectors use inverted index with exact dot-product similarity (not ANN). Each point can have one dense + one named sparse vector. **Qdrant can compute IDF server-side** when `Modifier.IDF` is set on the sparse vector config.

Important clarification: BM25 is a statistical formula, not a neural model. Sparse vector *generation* (tokenize + term-frequency count) happens **client-side in Bun/TypeScript** — no Ollama call, no model load, pure CPU work measured in microseconds per chunk. Qdrant's server-side contribution is the IDF adjustment on stored sparse vectors, which keeps corpus statistics fresh as the corpus grows. The "client-side BM25 + server-side IDF" split is architecturally important: it means BM25 adds zero load to the (potentially remote) Ollama service.

### 4.3 The fusion method: RRF (Reciprocal Rank Fusion)
RRF, not linear interpolation. Linear interpolation breaks because BM25 scores (unbounded positive floats) and cosine similarity (−1 to 1) are on different scales, and outliers distort the combined ranking.

**RRF formula:** `score(doc) = Σ 1/(k + rank_in_list_i)` where `k=60` is the standard constant (Cormack et al., SIGIR 2009). Parameter-free (k=60 has consensus). Robust across score distributions.

### 4.4 The stack (from LlamaIndex/Anthropic cookbook)
1. Dense retrieval → top 150
2. BM25 (contextualized) retrieval → top 150
3. Merge via RRF → top N (typically 40-60)
4. Rerank with cross-encoder → top 20
5. (Optional) LLM final filter → top 5

For june, we build the first four; the final filter is at query time (out of spec).

### 4.5 BM25 corpus statistics problem
BM25 needs global corpus statistics (avg doc length, IDF). If we add new data, stats change. **Qdrant's IDF modifier handles this server-side** — streaming updates of sparse embeddings keep IDF fresh without re-indexing everything. Critical for june's incremental ingest story.

---

## 5. Reranking — where Ollama gets awkward

### 5.1 The problem
Ollama doesn't have a native rerank API. Cross-encoder models (bge-reranker-v2-m3, mxbai-rerank-large) aren't convertible to GGUF format via llama.cpp in the standard way (GitHub issue ollama/ollama#4360).

### 5.2 Options
- **Run reranker outside Ollama** — use `transformers.js` or ONNX-runtime in Node/Bun, load `bge-reranker-v2-m3` directly. Self-contained, offline. Recommended approach.
- **qllama/bge-reranker-v2-m3 on Ollama** — a community upload that hacks it into embedding API (scores returned as embeddings). Works but awkward.
- **Skip reranking in v1** — accept the 49% improvement from contextual retrieval + hybrid and leave reranking for phase 2.5.

### 5.3 Recommendation
Spec the reranker as an **interface with two implementations**: a stub that returns inputs unchanged (v1), and a bge-reranker implementation via transformers.js (v1.1). The ingest pipeline doesn't care about reranking — reranking is query-side. So this affects the retrieval spec, not ingest. **Punt on reranker implementation for the ingest spec; just ensure the schema supports reranker score caching if we decide to pre-compute anything.**

---

## 6. Parent-child / small-to-big retrieval

### 6.1 The concept
Embed small, retrieve big. Small child chunks (100-500 tokens) give precision on match. Parent chunks (500-2000 tokens) give context on delivery. The retriever finds the best child, returns the parent. LangChain calls this ParentDocumentRetriever; LlamaIndex calls it small-to-big.

### 6.2 For june's "Document-as-surface" UI
This maps naturally to the section structure:
- **Child** = leaf chunk (~500 tokens) — embedded, indexed
- **Parent** = heading section (may be 500-3000 tokens) — stored but NOT embedded, retrieved by ID when a child matches

### 6.3 Implication for schema
Every chunk carries both `chunk_id` and `parent_section_id`. A separate `sections` table/collection stores full section text. At query time, retrieval returns chunks but can optionally "expand to parent" for SME mode's comprehension-first view.

---

## 7. Lost in the middle — what it means for ingest

### 7.1 The finding (Liu et al. 2023; follow-ups 2025)
Performance degrades >30% when relevant info shifts from start/end to middle of context. RoPE positional encoding creates long-term decay biasing attention toward start and end.

### 7.2 How it affects INGEST (not just query)
- **Order of chunks in retrieval matters.** Not our problem at ingest, but we must return chunks in a way retrieval can reorder them (don't force arbitrary order at storage).
- **Chunk count matters.** Research consensus: keep only 3-5 chunks in final prompt, not 20. Our retrieval returns many; final selection narrows.
- **Minimize duplicates in retrieved set.** Dedup should happen at ingest (content hash) AND at retrieval (near-dup detection).

### 7.3 Implication for schema
Store `chunk_index_in_document` and `chunk_index_in_section` as integers. Enables retrieval-side logic to reorder and to detect adjacency (for auto-merging).

---

## 8. Small-model RAG research — the sobering data

### 8.1 The finding (arXiv:2603.11513 — "Can Small Language Models Use What They Retrieve?")
For sub-7B models: even with perfect retrieval, 7B extracts correct answer only 14.6% of the time for unknown questions. Retrieval DESTROYS 42-100% of correct answers on known questions. **The bottleneck is context utilization, not retrieval quality.**

### 8.2 What this means for june
This is both a threat and a vindication of the founding bet.
- **Threat:** A naive "dump 10 chunks at a 3B model" pipeline is worse than no RAG at all for small models.
- **Vindication:** The right response is EXACTLY what june is designed for — maximum metadata density per chunk, minimal chunk count (3-5), aggressive contextualization before the chunk ever reaches the model. The chunks have to arrive pre-digested.

### 8.3 Implication for schema
Every chunk must be self-contextualizing to a degree that a 3B model CAN use it. This means:
- Breadcrumb path prepended
- Contextual retrieval blurb prepended  
- `self_contained` flag for retrieval filter
- `continuation_of` pointer so mid-section chunks don't arrive headless
- `answer_shape` hint so the model knows what kind of question this chunk can answer

### 8.4 Target model sizing
- **14B primary target** (from user): Gemma 4, Qwen 2.5 14B, DeepSeek 14B. These are genuinely capable of RAG at quality.
- **3B lower bound** (Lil Timmy): Llama 3.2 3B, Qwen 2.5 3B. Usable but needs maximum metadata density to compensate.
- **150B enterprise** (Paul): Qwen 2.5 72B, DeepSeek V2/V3, Llama 3.3 70B. These can handle reranking chunks internally; more chunks okay.

---

## 9. Qdrant — schema and payload design

### 9.1 Collection architecture
June already has this decided: `internal` + `external` collections. This is correct — source-type boundary is the primary scope, and Qdrant is optimized for many small-medium collections.

### 9.2 Payload indexing — critical for speed
Qdrant payloads are JSON. For filtering to be fast, **create explicit payload indexes** on every field used in a filter. Indexed field types:
- `keyword` — exact match (e.g. `category`, `sensitivity`)
- `integer` / `float` — range queries (e.g. `quality_score`)
- `bool` — boolean (e.g. `deprecated`)
- `datetime` — time ranges (e.g. `ingested_at`)
- `uuid` — ID lookups
- `text` — full-text on payload (rare; we use sparse vectors for this)

**Rule:** any field appearing in a filter needs an index. Don't skip this.

### 9.3 Sparse + dense on same point
```
vectors_config:
  dense: { size: 768, distance: Cosine }
sparse_vectors_config:
  bm25: { modifier: IDF }
```
Each point gets `vector: { dense: [...], bm25: { indices: [...], values: [...] } }`.

### 9.4 Ingest performance
Batch upserts (100-500 points per batch). Parallel uploads supported safely. Use meaningful point IDs — UUIDs generated deterministically from chunk content hash let us upsert idempotently.

### 9.5 Collection aliases for zero-downtime schema migration
Qdrant supports collection aliases. Deploy v2 schema to new collection, swap alias atomically. Relevant to june's "no re-ingest needed" goal: if a future pillar addition DOES require a schema migration, aliases let us migrate without user visible disruption.

---

## 10. Idempotent ingestion — proven patterns

### 10.1 Three rules of idempotent ingestion
1. **Deterministic inputs** — same input produces same output (content hash identity)
2. **Prefer replace over append** — partition-replace or MERGE/upsert, never blind append
3. **Track what's processed** — dedup store (SQLite sidecar in our case)
4. **Atomic writes** — transactions so partial writes don't leave inconsistent state

### 10.2 Checkpointing
For resume: persist processing state to disk frequently. On crash/resume, read last good state and continue. The unit of checkpointing should be the stage boundary (e.g. "parsed file X, now chunking"). Not every tiny operation.

### 10.3 Deterministic IDs
`chunk_id = sha256(doc_id + version + char_offset_start + char_offset_end + schema_version)` where `doc_id = sha256(absolute_source_uri)` and `version` is the resolved version string for this ingest (CLI flag > frontmatter > ISO-8601 timestamp fallback — see §10.6). `section_id` uses the same shape minus offsets: `sha256(doc_id + heading_path_joined + char_offset_start)`; sections are versioned via composite PK `(section_id, version)` in SQLite.

Running ingest twice on the same file with the same content AND same version produces the same chunk IDs — Qdrant upsert becomes a no-op. Running ingest with a new version produces a disjoint set of chunk IDs; the prior version's chunks remain in Qdrant with `is_latest=false` in their payload.

`schema_version` enters the hash deliberately. Additive schema changes (new optional fields with defaults) do NOT bump `schema_version` — old chunks stay queryable, no re-ingest. Only breaking changes bump it, and those are explicit phase-level events, not routine.

### 10.4 SQLite sidecar pattern

> **Authoritative DDL lives in `SPEC.md` §10.**
> The DDL below was the research-phase draft. `SPEC.md` §10 is a strict superset: it adds `CHECK` constraints on every enum column (`is_latest`, `status`, `trigger`, `event_type`, `reason`), the `ingestion_run_id` foreign key on `documents`, a `created_at` column on `sections`, additional indexes (`idx_documents_deleted_at`, `idx_sections_doc`), and a `busy_timeout = 5000` pragma. Implement from `SPEC.md` §10, not from here. Retained for narrative context only.

All tables use `bun:sqlite` (built-in, no native addon). Pragmas: `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`.

```sql
-- Tracks every (document, version) pair ingested
-- Composite PK because all versions are retained until explicit deletion
CREATE TABLE documents (
  doc_id TEXT NOT NULL,             -- sha256(absolute_source_uri)
  version TEXT NOT NULL,            -- resolved: CLI flag > frontmatter > ISO-8601 timestamp
  source_uri TEXT NOT NULL,         -- canonical URL/path; NOT unique (same uri across versions)
  content_hash TEXT NOT NULL,       -- sha256(raw content)
  is_latest INTEGER NOT NULL,       -- 0 or 1; exactly one row per doc_id has is_latest=1
  source_modified_at TEXT,          -- from source system
  ingested_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  status TEXT NOT NULL,             -- 'pending' | 'parsed' | 'chunked' | 'contextualized'
                                    -- | 'embedded' | 'stored' | 'failed'
                                    -- | 'skipped_empty' | 'skipped_metadata_only' | 'deleted'
  deleted_at TEXT,                  -- soft-delete timestamp (reconcile, or manual)
  ingestion_run_id TEXT NOT NULL,
  PRIMARY KEY (doc_id, version)
);
CREATE INDEX idx_documents_source_uri ON documents(source_uri);
CREATE INDEX idx_documents_is_latest ON documents(doc_id, is_latest);
CREATE INDEX idx_documents_status ON documents(status);

-- Tracks every chunk produced (for resume + dedup)
-- chunk_id includes version, so each version has its own chunks
CREATE TABLE chunks (
  chunk_id TEXT PRIMARY KEY,        -- sha256(doc_id + version + offset_start + offset_end + schema_version)
  doc_id TEXT NOT NULL,
  version TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  status TEXT NOT NULL,             -- 'pending' | 'contextualized' | 'embedded' | 'stored' | 'failed'
  content_hash TEXT NOT NULL,       -- sha256(raw chunk content, pre-embed-text-construction)
  section_id TEXT NOT NULL,
  raw_content TEXT NOT NULL,        -- persisted for re-embed flow
  contextual_summary TEXT,          -- persisted for re-embed flow
  embedding_model_name TEXT,        -- e.g. "nomic-embed-text"
  embedding_model_version TEXT,
  embedded_at TEXT,                 -- null until embedded
  created_at TEXT NOT NULL,
  FOREIGN KEY (doc_id, version) REFERENCES documents(doc_id, version)
);
CREATE INDEX idx_chunks_doc_version ON chunks(doc_id, version);
CREATE INDEX idx_chunks_status ON chunks(status);
CREATE INDEX idx_chunks_section ON chunks(section_id, version);

-- Parent sections (stored but NOT embedded — retrieval-by-ID)
-- Versioned via composite PK
CREATE TABLE sections (
  section_id TEXT NOT NULL,
  version TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  heading_path TEXT NOT NULL,       -- JSON array
  content TEXT NOT NULL,
  char_start INTEGER NOT NULL,
  char_end INTEGER NOT NULL,
  PRIMARY KEY (section_id, version),
  FOREIGN KEY (doc_id, version) REFERENCES documents(doc_id, version)
);

-- Run log for observability + debugging
CREATE TABLE ingestion_runs (
  run_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  doc_count INTEGER,
  chunk_count INTEGER,
  error_count INTEGER,
  trigger TEXT NOT NULL             -- 'cli' | 'api' | 'reconcile' | 're-embed' | 'init'
);

-- Error history — append-only, proper audit trail
-- Separate table, not a JSON blob column, for SQL queryability
CREATE TABLE ingestion_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  doc_id TEXT,                      -- nullable: some errors aren't doc-scoped
  version TEXT,                     -- nullable: matches doc_id
  chunk_id TEXT,                    -- nullable: some errors aren't chunk-scoped
  stage TEXT NOT NULL,              -- which pipeline stage
  error_type TEXT NOT NULL,         -- classification for filtering
  error_message TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES ingestion_runs(run_id)
);
CREATE INDEX idx_errors_doc ON ingestion_errors(doc_id, version);
CREATE INDEX idx_errors_chunk ON ingestion_errors(chunk_id);
CREATE INDEX idx_errors_run ON ingestion_errors(run_id);
CREATE INDEX idx_errors_type ON ingestion_errors(error_type);
CREATE INDEX idx_errors_time ON ingestion_errors(occurred_at);

-- Reconciliation audit trail — separate from errors for compliance queryability
-- Every soft-delete, hard-delete, and orphan cleanup is recorded here
CREATE TABLE reconcile_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  event_type TEXT NOT NULL,         -- 'soft_delete_document' | 'hard_delete_chunks'
                                    -- | 'qdrant_orphan_deleted' | 'dry_run_would_delete'
  doc_id TEXT,
  version TEXT,
  chunk_id TEXT,                    -- for orphan events
  source_uri TEXT,
  reason TEXT NOT NULL,             -- 'file_vanished' | 'qdrant_orphan' | 'manual_purge'
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES ingestion_runs(run_id)
);
CREATE INDEX idx_reconcile_doc ON reconcile_events(doc_id, version);
CREATE INDEX idx_reconcile_run ON reconcile_events(run_id);
CREATE INDEX idx_reconcile_time ON reconcile_events(occurred_at);

-- Single-writer enforcement via heartbeat (container-safe)
CREATE TABLE ingestion_lock (
  lock_id INTEGER PRIMARY KEY CHECK (lock_id = 1),
  run_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  last_heartbeat_at TEXT NOT NULL,  -- updated every 30s by active run
  host TEXT NOT NULL,               -- diagnostic only
  pid INTEGER NOT NULL              -- diagnostic only
);
-- Acquire logic: if existing lock's last_heartbeat_at is older than 90s, break and acquire.
-- Otherwise INSERT OR FAIL — second invocation exits cleanly.
-- pid/host are recorded for debugging but NOT used for staleness detection
-- (container restarts change both and break pid-based liveness checks).
```

### 10.5 Status state machine
pending → parsed → chunked → contextualized → embedded → stored → (done)
Any stage can fail → status set to 'failed' AND a row written to `ingestion_errors` with full context. Resume = "find all docs/chunks not in 'stored' state, replay from their current state."

### 10.6 Version resolution and is_latest semantics

**Version resolution order** (first non-empty wins):
1. CLI flag `--version <string>` on the ingest command
2. YAML frontmatter field `version:` in the source file
3. ISO-8601 UTC timestamp of ingest start (e.g. `2026-04-18T14:30:00Z`)

Timestamps provide automatic, ordered, globally meaningful versioning when no explicit version is declared. The resolved version string enters the chunk_id hash verbatim.

**is_latest flip on new version.** When a new version is ingested for an existing doc_id, Stage 10 (Storage Commit) performs:
1. Upsert new version's chunks to Qdrant with `is_latest=true` in payload
2. Bulk filtered payload update on prior version's chunks: set `is_latest=false` (Qdrant supports this via `set_payload` with a filter selector)
3. Single SQLite transaction: insert new documents row with `is_latest=1`, update prior row(s) with `is_latest=0`

Ordering: Qdrant flip FIRST (idempotent, retry-safe), then SQLite (authoritative). If Qdrant flip partially succeeds and the process dies, resume detects state mismatch and re-runs the flip — idempotent because setting `is_latest=false` on already-`false` chunks is a no-op. The window where two versions momentarily claim `is_latest=true` is bounded to the duration of the Qdrant bulk update; retrieval-side is expected to tolerate this (take the newest by `version` in edge cases).

**Soft-delete resurrection.** If a document with `deleted_at` set is re-ingested (file reappears at the same source_uri), the existing row is UPDATED in place: `deleted_at` cleared, new version row added with `is_latest=1`, prior versions' `is_latest` flipped. Hard deletion only via `purge <doc_id>` or explicit reconcile action with `--purge` flag.

### 10.7 Multi-backend storage goal

The DDL above is the **SQLite reference implementation** shipped in v1. June is designed to support pluggable sidecar backends: **SQLite** (v1, shipped), **PostgreSQL** (interface-compliant, impl deferred), **Microsoft SQL Server** (interface-compliant, impl deferred). The storage layer sits behind a `SidecarStorage` interface (defined in the spec's TypeScript contracts section). Operators choose a backend via config; the rest of the pipeline is dialect-agnostic.

Logical schema is fixed — same tables, same columns, same semantics — but dialect-appropriate types replace SQLite-specific choices:

| Concept | SQLite | PostgreSQL | SQL Server |
|---------|--------|-----------|-----------|
| auto-increment PK | `INTEGER PRIMARY KEY AUTOINCREMENT` | `GENERATED ALWAYS AS IDENTITY` | `IDENTITY(1,1)` |
| boolean | `INTEGER` (0/1) | `BOOLEAN` | `BIT` |
| large text | `TEXT` | `TEXT` | `NVARCHAR(MAX)` |
| conflict-on-insert | `INSERT OR FAIL` | `ON CONFLICT DO NOTHING` | `MERGE` or `IF NOT EXISTS` |
| ISO timestamp | `TEXT` (ISO-8601) | `TIMESTAMPTZ` | `DATETIMEOFFSET` |
| WAL / crash safety | `PRAGMA journal_mode=WAL` | default MVCC | default snapshot isolation |

For v1, the spec ships SQLite only, with the interface designed such that adding a backend is a bounded unit of work (new adapter file, no pipeline-core changes). Query-builder choice (if any) must survive the package-selection rules in CONSTRAINTS.md: no telemetry, mature, well-supported. **Kysely** is the leading candidate for the abstraction layer if/when a second backend is implemented — lightweight, TS-first, no telemetry, native SQLite + PG support, community MSSQL adapter. Evaluated and pinned when the second backend is implemented, not now.

---

## 11. Markdown parsing in TypeScript

### 11.1 Library choice
**remark / unified / mdast** is the canonical ecosystem. Three packages relevant:
- `mdast-util-from-markdown` — just parses markdown to mdast AST. Lightest option.
- `remark-parse` — plugin wrapper around mdast-util-from-markdown for the unified pipeline.
- `remark` (meta-package) — parse + stringify, for full pipelines.

For june: **`mdast-util-from-markdown` + `micromark-extension-gfm` + `mdast-util-gfm`**. GFM extension gives us tables, strikethrough, task lists, autolinks. That's the full standards-compliant markdown parser in TypeScript, no LangChain needed.

### 11.2 What we get from mdast
The AST has typed nodes: `heading` (with `depth`), `code` (with `lang`, `meta`, `value`), `paragraph`, `list`, `listItem`, `blockquote`, `table`, `tableRow`, `thematicBreak`, `html`, `text`. We can walk this tree and implement our chunking rules precisely — no regex-based parsing.

### 11.3 Position info
mdast nodes carry `position: { start: {line, column, offset}, end: {line, column, offset} }`. This gives us exact source offsets for every chunk — essential for the "open in source" feature AND for deterministic chunk IDs.

### 11.4 Headings
- ATX: `# ` through `###### ` (1-6 levels), space after `#` required in strict CommonMark
- Setext: underline with `=` (h1) or `-` (h2)
- mdast normalizes both to `{type: 'heading', depth: N}`

---

## 12. The metadata schema — synthesis

This is the consolidated schema that survives the four pillars framework AND the research findings. **Every field has a justification.** Fields are grouped by lifecycle but tagged by RUNTIME JOB: F=Filter, R=Rank, C=Context-inject, D=Display, O=Operational.

### PILLAR 1 — Identity (required, immutable)
| Field | Type | Job | Notes |
|-------|------|-----|-------|
| `id` | UUID | O | Deterministic: sha256(doc_id + version + offset_start + offset_end + schema_version) |
| `doc_id` | UUID | F | sha256(source_uri) |
| `version` | string | F | Resolved version: CLI flag > frontmatter > ISO-8601 timestamp |
| `is_latest` | bool | F | True iff this is the current version for its doc_id. Retrieval default filter. |
| `section_id` | UUID | O | For parent-child retrieval |
| `source_type` | enum | F | internal \| external (collection boundary) |
| `content_type` | enum | F | doc \| endpoint \| schema \| code \| conversation |
| `schema_version` | int | O | Migration support. Always present. Only bumps on breaking changes, never on additive field adds. |
| `chunk_index_in_document` | int | R,O | For ordering + continuation detection |
| `chunk_index_in_section` | int | R,O | Same, within section |

### PILLAR 2 — Provenance (required, updates on re-ingest)
| Field | Type | Job | Notes |
|-------|------|-----|-------|
| `source_uri` | string | D | Canonical URL/path — "open in source" |
| `source_system` | enum | F | confluence \| onedrive \| github \| openapi \| local \| ... |
| `content_hash` | string | O | sha256 of raw chunk content, pre-embed-text-construction. Dedup + staleness. |
| `source_modified_at` | ISO datetime | F,R | Staleness detection |
| `ingested_at` | ISO datetime | O | When WE ingested it |
| `ingestion_run_id` | ULID | O | Which run produced this chunk (Crockford base32, 26 chars, time-sortable) |
| `heading_path` | string[] | F,C,D | ["Auth Service", "Token Refresh", "Gotchas"] — the breadcrumb |
| `char_offset_start` | int | O | Position in source file |
| `char_offset_end` | int | O | Same |
| `external_links` | string[] | D | Outbound http/https links in this chunk — for later analysis. Excludes mailto, javascript:, etc. |
| `unresolved_links` | string[] | D,O | Raw target strings of internal/relative links whose doc_id couldn't be resolved at ingest time. Candidates for a future `june re-resolve-links` pass. |

### PILLAR 3 — Classification (optional, evolves; controlled vocab)
| Field | Type | Job | Notes |
|-------|------|-----|-------|
| `namespace` | string | F | "org:acme" \| "team:platform" \| "personal" — multi-tenancy hook |
| `project` | string | F | Free-ish within namespace |
| `category` | enum | F | guide \| reference \| tutorial \| changelog \| runbook \| postmortem \| spec \| decision-record |
| `tags` | string[] | F | Controlled vocab |
| `audience` | string[] | F | engineering \| legal \| ops \| hr \| executive |
| `audience_technicality` | int 1-5 | F | 1=non-technical, 5=deep implementation |
| `sensitivity` | enum | F | public \| internal \| confidential \| restricted |
| `lifecycle_status` | enum | F | draft \| published \| deprecated \| archived |
| `stability` | enum | F | stable \| beta \| experimental \| internal-draft |
| `temporal_scope` | enum | F | current \| historical \| planned |
| `source_trust_tier` | enum | R | canonical \| derived \| community \| external |

### PILLAR 4 — Signals (optional, continuously updated)
| Field | Type | Job | Notes |
|-------|------|-----|-------|
| `quality_score` | float 0-1 | R | Learned from citations + feedback |
| `freshness_decay_profile` | enum | R | slow \| medium \| fast \| never — determines decay rate |
| `authority_source_score` | float 0-1 | R | Based on source_system |
| `authority_author_score` | float 0-1 | R | Based on author when known |
| `retrieval_count` | int | R | How often retrieved |
| `citation_count` | int | R | How often ACTUALLY cited in final answer |
| `user_marked_wrong_count` | int | R | Explicit negative signal |
| `last_validated_at` | ISO datetime | R | Human confirmation timestamp |
| `deprecated` | bool | F | Hard filter unless query explicitly includes history |
| `embedding_model_name` | string | O | e.g. "nomic-embed-text" — detect mismatches on retrieval |
| `embedding_model_version` | string | O | Version/tag; enables re-embed detection |
| `embedded_at` | ISO datetime | O | When this vector was generated |

### PILLAR 5 (NEW) — Context-injection fields (small-model-critical)
These were in my previous analysis and are what distinguishes june from a naive RAG. They EXIST to substitute for the reasoning a small model can't do.

| Field | Type | Job | Notes |
|-------|------|-----|-------|
| `document_title` | string | C | Human-meaningful title, NOT filename |
| `contextual_summary` | string | C | Anthropic-style 50-100 token blurb, prepended before embedding |
| `section_role` | enum | C,R | intro \| explanation \| procedure \| warning \| example \| definition \| reference \| decision |
| `answer_shape` | enum | C,R | fact \| procedure \| concept \| gotcha \| comparison \| troubleshooting |
| `prerequisites` | string[] | C | "assumes familiarity with X" |
| `self_contained` | bool | F | Does this chunk stand alone? If false, retrieval auto-expands to parent |
| `is_continuation` | bool | C | True if this chunk is mid-section |
| `previous_chunk_id` | UUID? | O | Neighbor pointer for auto-merge |
| `next_chunk_id` | UUID? | O | Same |
| `contains_code` | bool | F | Code-routing hint |
| `code_languages` | string[] | F | If contains_code |
| `negation_heavy` | bool | R | "What NOT to do" chunks need different handling |

### PILLAR 6 (NEW) — Relationships
| Field | Type | Job | Notes |
|-------|------|-----|-------|
| `references` | string[] | R | Entity IDs this chunk mentions (from controlled entity vocab) |
| `canonical_for` | string[] | R | Entity IDs for which THIS is the definition |
| `siblings` | UUID[] | O | Other chunks under same parent section |
| `supersedes` | UUID? | R | Chunk this replaces |
| `superseded_by` | UUID? | F | If present, auto-demote |

### Type-specific fields (under `type_specific`)
Keeps top-level shape stable as new content_types are added:
```ts
type_specific: {
  // when content_type === "doc"
  version?: string;
  
  // when content_type === "endpoint" (phase 7)
  api_name?: string;
  method?: string;
  path?: string;
  api_refs?: string[];
  
  // when content_type === "code" (phase 6)
  repo?: string;
  branch?: string;
  file_path?: string;
  symbol_kind?: string;
  symbol_name?: string;
  language?: string;
}
```

---

## 13. Classifier design for metadata population

### 13.1 What's cheap vs expensive
**Free (parse-time):**
- Everything in Pillar 1 (Identity)
- Everything in Pillar 2 (Provenance) — all derivable
- `contains_code`, `code_languages` — from mdast
- `heading_path` — from mdast traversal
- `chunk_index_*` — from position in document
- `is_continuation`, `previous_chunk_id`, `next_chunk_id` — from chunk sequence
- `char_offset_*` — from mdast position

**Config-time or default:**
- `namespace`, `sensitivity` (from source org policy)
- `source_type`, `source_system`, `source_trust_tier` (from configured source)

**Needs small-model classifier (3B via Ollama):**
- `category` — single classification task, constrained vocab
- `tags` — multi-label from controlled vocab
- `audience`, `audience_technicality` — classification
- `section_role` — classification
- `answer_shape` — classification
- `temporal_scope` — classification
- `stability`, `lifecycle_status` — from frontmatter hints + classification
- `prerequisites` — extraction task
- `self_contained` — classification
- `negation_heavy` — classification
- `contextual_summary` — generation task (the big one)
- `document_title` — generation (or extract from H1)

**Needs entity resolution pass:**
- `references` — NER against controlled entity vocab
- `canonical_for` — heuristic from section title + body

**Accumulated over time (never filled at ingest):**
- All of Pillar 4 signals (scores start at neutral defaults, update from usage)
- `supersedes`, `superseded_by` — manual or version-detection

### 13.2 Classifier invocation pattern
One Ollama call per chunk per classification task is wasteful. **Batch classifications into a single structured-output call.** Llama 3.2 3B and Qwen 2.5 3B both support JSON-mode / tool-calling well enough to produce structured output reliably with the right prompt.

Recommended pattern: ONE classifier call per chunk returns a JSON object with ALL classifications at once. Separate call for contextual_summary (different prompt shape, uses full document — expensive input).

### 13.3 Classifier prompt pattern (recommended)

> **Outdated — see `SPEC.md` Appendix B and Appendix D for the final classifier prompt and enum vocabulary.**
> The enum values below are the pre-Round-2 research draft. They were superseded during Chat 2 and do not match what the spec ships. The final `category`, `section_role`, `answer_shape`, `audience`, and related enums live in `SPEC.md` Appendix D; the final classifier prompt lives in `SPEC.md` Appendix B. Retained here only for historical context — do not implement from this section.

```
System: You are a document analysis classifier. Given a markdown chunk from a technical document, classify it along several dimensions. Return ONLY valid JSON matching the schema.

User: 
Document title: {document_title}
Heading path: {heading_path}

---CHUNK---
{chunk_content}
---END CHUNK---

Classify as JSON:
{
  "category": one of [guide, reference, tutorial, changelog, runbook, postmortem, spec, decision-record],
  "section_role": one of [intro, explanation, procedure, warning, example, definition, reference, decision],
  "answer_shape": one of [fact, procedure, concept, gotcha, comparison, troubleshooting],
  "audience_technicality": integer 1-5,
  "temporal_scope": one of [current, historical, planned],
  "self_contained": boolean,
  "negation_heavy": boolean,
  "tags": array of 0-5 tags from controlled vocab [list here]
}
```

### 13.4 Fallback strategy

> **Outdated — see `SPEC.md` §6 (Pillar 3 / Pillar 5 fallback columns) and §29 (`classifier.fallbacks.*` config) for final fallback defaults.**
> The defaults listed below are the pre-Round-2 research draft. In particular, `section_role: "explanation"` is NOT a member of the final `section_role` enum (the value `"explanation"` moved to the `category` enum during Round 2). Using these defaults verbatim will fail zod validation at runtime. Retained for historical context only.

Every classifier field needs a default for when the classifier fails / returns invalid output:
- `category: "reference"` (most common)
- `section_role: "explanation"`
- `answer_shape: "concept"`
- `audience_technicality: 3`
- `temporal_scope: "current"`
- `self_contained: true` (fail-safe)
- `tags: []`
- `negation_heavy: false`

A failed classifier call is logged but non-fatal. The chunk still gets embedded and stored; classifier can be re-run later.

---

## 14. CommonMark specifics worth encoding in the chunker

1. **Headings (ATX):** `/^(#{1,6})\s+(.+)$/m` — require space after `#`. Strict CommonMark rejects `#foo` without space.
2. **Headings (Setext):** H1 = line(s) of text followed by `===+` on next line. H2 = `---+`. Must be ≤3 spaces indent.
3. **Fenced code blocks:** Start with 3+ backticks or 3+ tildes at ≤3 spaces indent. Info string after opener (first word = language). Close with same fence character, equal or greater count.
4. **Tables (GFM):** Pipe-delimited. Header row, separator row `|---|---|`, data rows.
5. **Lists:** Ordered (`1.`, `2.` ...) or unordered (`-`, `*`, `+`). Nested via indentation.
6. **Block quotes:** `>` prefix. Can contain other blocks.
7. **Thematic break:** `---`, `***`, `___` on own line.
8. **Paragraph continuation:** A non-blank line continues the current paragraph (unless it starts a new block).

Using mdast we don't implement any of this — the parser handles it. But our chunker must respect the AST structure: never split inside a `code`, `table`, `listItem`, or `blockquote` node.

---

## 15. Non-obvious findings to bake into the spec

1. **Anthropic's cookbook puts contextual blurb AFTER chunk content.** LlamaIndex puts it before. There's no benchmark-settled answer. I recommend BEFORE for june, because small models benefit from "headline first" framing.

2. **Qdrant can compute IDF server-side** — this matters because it means our BM25 sparse vectors stay fresh as corpus grows, no batch re-indexing required. Critical for june's incremental ingest story.

3. **nomic-embed-text v1.5 has Matryoshka** — truncate to 512 dims and quality barely drops. Saves 33% storage and speeds retrieval. Worth exposing as a config option.

4. **Ollama embedding API changed** — `/api/embed` is current, `/api/embeddings` is deprecated. Spec must use the new endpoint.

5. **Small model retrieval research is sobering** (arXiv:2603.11513) — for sub-7B models, naive RAG is net-negative. Only heavy-metadata, heavy-context-injection RAG (which is what june is building) works.

6. **Reranking on Ollama is genuinely awkward.** Deferred entirely to the retrieval spec — NOT an ingest concern. When implemented (v1.1+), `transformers.js` + `bge-reranker-v2-m3` via ONNX-runtime in Bun is the recommended path. Flagged here only so the ingest spec doesn't accidentally depend on it.

7. **"Lost in the middle" affects RETRIEVAL, not ingest — but ingest must store what retrieval needs.** Specifically: chunk index, section index, neighbor pointers.

8. **BM25 corpus-statistics problem is solved by Qdrant's IDF modifier.** Document this explicitly in the spec so we don't spend a weekend reimplementing it.

9. **Parent-child retrieval is mostly free for us.** We already have section-level structure from mdast. Store the section as a separate row in SQLite, reference by ID. No second embedding, no extra vector cost.

10. **Classifier batching matters.** 10 separate Ollama calls per chunk = 10x slower than one structured-output call. The spec should mandate the batched-classifier pattern.

---

## 16. Sources cited
Primary:
- Qu, Bao, Tu. *Is Semantic Chunking Worth the Computational Cost?* arXiv:2410.13070. NAACL 2025.
- Anthropic. *Introducing Contextual Retrieval.* 2024. (Via Cookbook, DataCamp, Together AI, LlamaIndex secondary coverage.)
- Liu et al. *Lost in the Middle.* 2023. (Via dev.to and getmaxim.ai 2026 follow-ups.)
- Sarthi et al. *RAPTOR: Recursive Abstractive Processing for Tree-Organized Retrieval.* 2024. arXiv:2401.18059. (Deferred — too complex for phase 2.)
- arXiv:2603.11513. *Can Small Language Models Use What They Retrieve?* 2026.
- Cormack et al. *Reciprocal Rank Fusion.* SIGIR 2009. (k=60 constant.)

Technical references:
- Morph. *Ollama Embedding Models: Benchmarks, VRAM, and Which to Use.* April 2026.
- Qdrant documentation: payload indexing, sparse vectors, hybrid search, BM42.
- CommonMark 0.30 spec + GFM spec.
- mdast / remark / unified documentation.
- Anthropic Cookbook: contextual embeddings guide.
- LlamaIndex cookbook: contextual retrieval.
- FloTorch 2026 benchmark (via blog.premai.io).
- NVIDIA chunking tests (via blog.premai.io and stackviv.ai).
- PremAI 2026 chunking benchmark guide.
- PremAI hybrid search guide.

Application patterns:
- LangChain ParentDocumentRetriever docs.
- LlamaIndex small-to-big retrieval tutorial.
- Dify parent-child retrieval blog.
- Weaviate hybrid search explanation.

This brief is sufficient. Proceeding to skeleton.
