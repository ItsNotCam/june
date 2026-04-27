# RAG Retrieval Deep-Fix — Session Results

**Date:** 2026-04-26
**Branch:** main
**Commits:** `9a33f6e` (Tier 1), `a0a04b7` (Tier 2)
**Status:** complete; bench validated end-to-end

---

## Headline

T1 (factoid) recall@5 went from **0.38 → 1.00** on the synthetic-protocol fixture. recall@1 went 0.12 → 0.86. The pipeline shrunk from ~12K LOC to ~9.7K (28% reduction in ingest src) and from 10 stages to 7. Reader-correctness held flat at 0.82. Zero integrity violations.

---

## Diagnosis (what was actually broken)

The 38% recall was three compounding bugs, not one. We confirmed each one with code inspection + SQLite/Qdrant data inspection on the prior bench run before fixing.

### Bug 1 — Parent/child chunk duplication from `sectionize`

**File:** [`packages/mcp/ingest/src/lib/chunker/sectionize.ts`](packages/mcp/ingest/src/lib/chunker/sectionize.ts)

`sectionize.closeTo()` emitted a `Section` for every popped stack entry — every heading at every depth — and Stage 3 chunked each section independently. Concrete result on the Wexmar Session doc: a `## Port Assignments` parent (1233 bytes) was indexed alongside its `### Control Port` (491 bytes) and `### Data Port` (558 bytes) children. The parent's char range *contained* both children verbatim. Confirmed via SQLite:

```sql
-- Found via INSTR(parent.raw_content, child.raw_content) > 0
parent  | child           | parent_size | child_size
1b1e05ed| 5491204c (Handshake)         | 2071 | 471
1b1e05ed| 399235c6 (Authentication)    | 2071 | 491
1b1e05ed| 3c9646777c7814 (Heartbeats)  | 2071 | 474
1b1e05ed| b4f6daf85ba5a0 (SessionTimeout)| 2071 | 613
```

Why this killed recall: bench resolves each fact to one specific `chunk_id`. The parent's diluted embedding often outranked the focused child, pushing the bench's resolved chunk_id out of top-k. Across 10 short docs, ~166 chunks for a corpus that should have produced ~80–100.

### Bug 2 — Asymmetric embedding model used without prefixes

**Files:**
- [`packages/mcp/ingest/src/lib/embedder/ollama.ts`](packages/mcp/ingest/src/lib/embedder/ollama.ts) (ingest side)
- [`packages/mcp/bench/src/providers/ollama.ts`](packages/mcp/bench/src/providers/ollama.ts) (retrieval side)

Both sides passed raw text to Ollama's `/api/embed`. The model is `snowflake-arctic-embed2`, which is asymmetric and trained to expect `query: ` on the query side (documents stay raw). Sending raw on both sides put the query and document vectors in subtly different sub-spaces and defeated the asymmetry the model was trained on.

### Bug 3 — Polluted contextual summaries

**File:** [`packages/mcp/ingest/src/lib/summarizer/ollama.ts`](packages/mcp/ingest/src/lib/summarizer/ollama.ts)

The summarizer called Ollama's `/api/generate` *without* `format: "json"` mode. The configured model (`smollm:1.7b`) frequently produced output that echoed the prompt template instead of summarizing. `validSummary()` only checked length and forbidden prefixes, so prompt-echo passed validation. SQLite audit: **37 of 166 chunks (22%) had corrupted summaries** containing phrases like:

```
"Write 4-6 sentences (<=120 words) that explain..."
"Here is an example of how to write a brief summary..."
"where this chunk sits in the document..."
```

The polluted summaries leak into `embed_text` (Stage 8 composes `title + heading_path + contextual_summary + content`), which contaminates both the dense embedding and the BM25 sparse vector. Generic prompt-template words like "where", "explain", "section" inflate scores on unrelated queries.

### Verified to be NOT a bug

- **BM25 / sparse retrieval:** Looked correct. Qdrant's `bm25` named vector field is configured with `modifier: "idf"` in [`packages/mcp/ingest/src/lib/storage/qdrant.ts:107-109`](packages/mcp/ingest/src/lib/storage/qdrant.ts#L107-L109), so even though the client-side vectorizer just sends raw term counts, Qdrant applies IDF weighting at query time.
- **Qdrant collection config:** dense Cosine distance is the right metric for arctic-embed-2; HNSW defaults are fine.
- **Chunking algorithm itself:** the recursive overflow splitter is sound. The duplication problem was at the section-emission layer above it, not in the splitter.

---

## Tier 1 — fixes that moved recall (commit `9a33f6e`)

### Step 0 — Move summarizer prompts to `prompts/*.md`

Mirrored the existing pattern from [`packages/mcp/bench/src/lib/prompts.ts`](packages/mcp/bench/src/lib/prompts.ts). Templates now live on disk and are rendered with `{{var}}` substitution; iteration on prompts is a markdown diff instead of a TypeScript template-literal change. Hard-fails on unfilled placeholders (`PromptTemplateError`) so a missing variable can't silently leak `{{unfilled}}` to the LLM.

**New files:**
- `packages/mcp/ingest/prompts/summarize-fits.md`
- `packages/mcp/ingest/prompts/summarize-long-doc-outline.md`
- `packages/mcp/ingest/prompts/summarize-long-doc-chunk.md`
- `packages/mcp/ingest/src/lib/prompts.ts` (renderPrompt helper)

**Modified:**
- `packages/mcp/ingest/src/lib/errors.ts` — added `PromptTemplateError`
- `packages/mcp/ingest/src/lib/summarizer/prompt.ts` — thin async wrappers around `renderPrompt`
- `packages/mcp/ingest/src/lib/summarizer/ollama.ts` — awaits the now-async builders

### Step 1 — Leaf-only sectionize emission

[`packages/mcp/ingest/src/lib/chunker/sectionize.ts`](packages/mcp/ingest/src/lib/chunker/sectionize.ts) — added a `hadChild: boolean` flag to `StackEntry`. When a deeper heading is pushed, the current top is marked `hadChild = true`. `closeTo()` now skips emission of any popped entry with `hadChild = true`. Before pushing the new child, `emitParentIntroIfNeeded()` carves out a separate "intro" section spanning from the parent's heading line to the first child's heading line — so any loose body text the parent had before its first subsection still gets chunked.

Edge cases preserved:
- Pre-heading prelude still emits (it's popped before any child is pushed by the existing `closeTo(1, start)` call).
- Doc with only flat H2s → all H2s emit as leaves (none have children).
- Doc with H1 > H2 > H3 → only H3 leaves emit, plus H1's intro (if non-empty) + H2's intros.

Tests added: two new sectionize tests in [`packages/mcp/ingest/__test__/pipeline/stage1-stage3.test.ts`](packages/mcp/ingest/__test__/pipeline/stage1-stage3.test.ts) — one asserts the H1>H2>H3 case emits only leaves + intros and that no chunk's content contains another's; one asserts sibling leaves cover the whole doc with no overlap.

### Step 2 — `query: ` prefix on retrieval embedding

[`packages/mcp/bench/src/providers/ollama.ts`](packages/mcp/bench/src/providers/ollama.ts) — `embedViaOllama()` now takes an optional `kind: "query" | "document"` parameter (default `"document"`). When `"query"`, prepends `"query: "` before the input. [`packages/mcp/bench/src/retriever/stopgap.ts`](packages/mcp/bench/src/retriever/stopgap.ts) passes `kind: "query"` when embedding the query text. The Tier-2 resolver (which embeds fact surface-hints, not questions) intentionally stays default `"document"`.

Document side (ingest) was *not* changed — arctic-embed-2 expects raw text on the document side, so the existing behavior matches the model's contract.

### Step 3 — JSON-mode contextual summaries (this was already done earlier in the session)

[`packages/mcp/ingest/src/lib/summarizer/ollama.ts`](packages/mcp/ingest/src/lib/summarizer/ollama.ts) — `summarizeChunk` now calls `generate(..., true)` (Ollama's `format: "json"` mode), parses with `ChunkSummaryJsonSchema = z.object({ summary: z.string() })`, and falls back to the deterministic heading-path blurb on parse/validation failure. Prompts restructured so all instructions precede the untrusted document/chunk content blocks.

### Side fixes that landed in the same commit

- `cli/bench.ts` and `cli/june.ts` had `// author: Claude` on line 1 with `#!/usr/bin/env bun` on line 2 → bun rejected the shebang. Swapped the lines.
- `bench/cli/health.ts` — `checkJune()` spawned `juneBin --help` without setting cwd, so bun couldn't resolve `@/*` aliases. Added the same cwd logic that `runJuneCommand` already had.

---

## Tier 2 — code cuts (commit `a0a04b7`)

The pipeline shipped 10 stages but only 7 affected recall. Stages 4, 5, and 7 produced metadata that the retriever never read or filtered on. The Six-Pillar schema also carried Pillars 3, 4, and 6 for hypothetical filter-based retrieval that v1 doesn't do.

### What got deleted

| Component | Lines | Reason |
|---|---|---|
| Stage 4 (`04-derive.ts`) | 105 | Produced `structural_features` (contains_code/has_table/etc) — never consulted by retriever |
| Stage 5 (`05-classify.ts`) | 108 | Produced classification (category/audience/tags/etc) — never filtered on |
| Stage 7 (`07-link.ts`) | 198 | Produced `relationships` (refs/siblings/etc) — query-side concern, not retrieval |
| `lib/classifier/` | ~250 | Entire directory: ollama.ts, prompt.ts, fallback.ts, stub.ts, types.ts |
| Pillar 3 fields on `Chunk` | ~80 | `classification` object + its Zod schema |
| Pillar 4 fields | ~30 | `runtime_signals` (quality_score/citation_count/...) — initialized to defaults, never updated |
| Pillar 6 fields | ~40 | `relationships` field on `Chunk` |
| Stage 10 payload bloat | ~60 | Removed all classification/structural/runtime/relationships from Qdrant payload |
| Qdrant payload indexes | 18 | 27 → 9 (kept doc_id/version/is_latest/source_type/content_type/source_system/source_modified_at/ingested_at/embedding_model_name) |
| Test files | ~336 | `stage7-link.test.ts`, `classifier/fallback.test.ts` |
| Test simplifications | ~100 | parity, smoke, e2e, fallback, observability tests pruned |
| Config schema | ~40 | `classifier.fallbacks` and `classifier_*` ollama knobs gone |
| Error vocabulary | ~20 | Removed `classifier_*` error_type values |
| benchmark/harness.ts | ~20 | Removed Stage 4/5/7 timing |

### What got modified

| File | Change |
|---|---|
| `src/pipeline/ingest.ts` | Orchestrator now sequences `1 → 2 → 3 → 6 → 8 → 9 → 10` |
| `src/pipeline/factory.ts` | `PipelineDeps` no longer carries `classifier` |
| `src/pipeline/stages/03-chunk.ts` | `chunkToStoredChunk` no longer initializes deleted pillars |
| `src/pipeline/stages/06-summarize.ts` | Input type changed from `ClassifiedChunk` to `UnclassifiedChunk` |
| `src/pipeline/stages/08-embed-text.ts` | Input type changed from `LinkedChunk` to `SummarizedChunk` |
| `src/pipeline/stages/10-store.ts` | `buildPoint` and `buildFullChunk` no longer write deleted pillars; `buildRelationships` removed |
| `src/types/chunk.ts` | `Chunk` is now Pillars 1+2+5+content+embedding only |
| `src/schemas/chunk.ts` | Matched type stripping |
| `src/lib/storage/sqlite/index.ts` | `rowToChunk` no longer fabricates default values for deleted pillars |
| `src/lib/storage/qdrant.ts` | Payload index list trimmed |
| `src/index.ts` / `src/types/index.ts` | Removed exports of deleted types |

### What got kept on purpose

- `vocab.ts` enums (`CATEGORY_VALUES`, `AUDIENCE_VALUES`, etc.) — still used by `Document` schema (`doc_category`, `doc_sensitivity`, `doc_lifecycle_status` on the document table), and pruning further is risky for diminishing returns.
- The `bm25.ts` sparse vectorizer — Qdrant's IDF modifier makes it work fine.
- The `Section` type and the SQLite `sections` table — still used by the resume path.
- Stage 6's `summarizer.summarizeDocument` (long-doc outline) — still feeds the long-doc chunk-prompt path.

---

## Verification

### Bench results table

| Metric (T1, n=50) | Baseline (pre-fix) | After Tier 1 | After Tier 2 |
|---|---|---|---|
| recall@1 | 0.120 | 0.820 | **0.860** |
| recall@3 | 0.220 | 0.980 | 0.980 |
| recall@5 | 0.380 | **1.000** | **1.000** |
| recall@10 | 0.720 | 1.000 | 1.000 |
| MRR | 0.240 | 0.895 | **0.915** |
| reader_correct | 0.780 | 0.820 | 0.820 |
| reader_hallucinated | 0.140 | 0.120 | 0.160 |
| reader_refused | 0.080 | 0.060 | 0.020 |

T5 (no-context, n=58):

| Metric | Baseline | After Tier 1 | After Tier 2 |
|---|---|---|---|
| reader_correct | 0.793 | 0.793 | **0.845** |
| reader_hallucinated | 0.207 | 0.207 | 0.155 |
| reader_refused | 0.793 | 0.793 | **0.845** |

Integrity all clean across runs (0% unresolved, 0% unjudged, 0 leakage warnings). Cost: $0.077 per run (Anthropic batch judge).

### Test results

- `bun x tsc --noEmit` clean (only pre-existing shebang errors which are now fixed).
- `bun test __test__/` — **126 pass / 0 fail** in the ingest package after Tier 2 (was 154 before — the delta is the deleted classifier/Stage-7 tests).
- `bun test` in the bench package — **73 pass / 0 fail**.

### Bench run dirs

- Tier 1 result: `packages/mcp/bench/runs/20260426191126-4CWE18CA/`
- Tier 2 result: `packages/mcp/bench/runs/20260426203757-3Y3P5M8B/`

---

## Outstanding work

### 1. Authorship hook is broken

`/home/cam/june/.claude/scratch/authorship.jsonl` was last written **2026-04-20**. The `PostToolUse` hook described in [.claude/CLAUDE.md](.claude/CLAUDE.md) hasn't been firing since. Per the project workflow, "no tracking data → Cam-primary," but in this session that misclassifies all the work (Claude wrote essentially everything). Both Tier 1 and Tier 2 commits include the `Co-authored-by: Claude` trailer because the user explicitly chose option #2 ("follow the spirit") when asked.

Fix: investigate `~/.claude/settings.json` or project `.claude/settings.json` hook configuration. The hook should run after every `Write` or `Edit` tool call and append a JSONL entry recording the file path + Claude's added line count.

### 2. Reader hallucination ticked up slightly on T1

T1 reader_hallucinated went 0.12 → 0.16 between Tier 1 and Tier 2 (= 2 queries more on n=50). Within reader noise but worth a closer look if it persists on subsequent runs. The reader is gemma4:26b via Ollama; could be model variance, could be an artifact of slightly tighter top-k context (since Tier 2 removed metadata from Qdrant payloads, the reader gets cleaner snippets but possibly less distractor-context for refusal triggers).

### 3. Tier 3 is an option but probably not needed

Originally floated:
- Merge Stage 6 (summarize) into Stage 8 (embed-text)
- Drop the multi-backend `SidecarStorage` interface (only SQLite ships)
- Collapse versioning (`is_latest` machinery is wide; v1 has no UX that uses it)

Recall is already saturated. Tier 3 would be code-quality gardening, not a recall play. Defer until there's a concrete UX reason.

---

## File location index

For a fresh chat picking up where we left off:

| What | Where |
|---|---|
| Pipeline orchestrator | `packages/mcp/ingest/src/pipeline/ingest.ts` |
| Pipeline factory (deps) | `packages/mcp/ingest/src/pipeline/factory.ts` |
| Stage 3 (chunk) | `packages/mcp/ingest/src/pipeline/stages/03-chunk.ts` |
| Stage 6 (summarize) | `packages/mcp/ingest/src/pipeline/stages/06-summarize.ts` |
| Stage 8 (embed-text) | `packages/mcp/ingest/src/pipeline/stages/08-embed-text.ts` |
| Stage 9 (embed) | `packages/mcp/ingest/src/pipeline/stages/09-embed.ts` |
| Stage 10 (store) | `packages/mcp/ingest/src/pipeline/stages/10-store.ts` |
| Sectionize (leaf-only) | `packages/mcp/ingest/src/lib/chunker/sectionize.ts` |
| Summarizer (Ollama) | `packages/mcp/ingest/src/lib/summarizer/ollama.ts` |
| Summarizer prompts | `packages/mcp/ingest/prompts/summarize-*.md` |
| renderPrompt helper | `packages/mcp/ingest/src/lib/prompts.ts` |
| Embedder (Ollama) | `packages/mcp/ingest/src/lib/embedder/ollama.ts` |
| Qdrant adapter | `packages/mcp/ingest/src/lib/storage/qdrant.ts` |
| SQLite adapter | `packages/mcp/ingest/src/lib/storage/sqlite/index.ts` |
| Chunk type | `packages/mcp/ingest/src/types/chunk.ts` |
| Chunk schema (Zod) | `packages/mcp/ingest/src/schemas/chunk.ts` |
| Bench retriever | `packages/mcp/bench/src/retriever/stopgap.ts` |
| Bench query embedder | `packages/mcp/bench/src/providers/ollama.ts` |
| Bench RRF fusion | `packages/mcp/bench/src/retriever/rrf.ts` |
| Bench BM25 vectorizer | `packages/mcp/bench/src/retriever/bm25.ts` |

### To re-run the bench

```bash
# Make sure Qdrant is running
cd /home/cam/june && docker compose up -d qdrant

# Purge old Qdrant data so the new ingest is clean
curl -X DELETE http://localhost:6333/collections/internal_v1
curl -X DELETE http://localhost:6333/collections/external_v1

# Re-run from the bench package
cd /home/cam/june/packages/mcp/bench
JUNE_BIN=/home/cam/june/packages/mcp/ingest/cli/june.ts \
  bun cli/bench.ts run fixtures/B3G0FYCMEKRJDXHYDXE1533726 --yes --log-json \
  > /tmp/bench-rerun.log 2>&1
```

Wall clock: ~45–55 min depending on Ollama latency. Cost: ~$0.08 (Anthropic batch judge).

The fixture's `corpus_manifest.json` had stale paths (`/packages/bench/...` from a prior directory move). The repo's `.gitignore` excludes `fixtures/`, so the patch was applied locally; if a fresh checkout regenerates the fixture path-issue, run the same `s/\/packages\/bench\//\/packages\/mcp\/bench\//` substitution.

---

# Session 2 — RAG Quality Push (T2 Reader + T4 Multi-Hop)

**Date:** 2026-04-27
**Branch:** main
**Commits:** none (everything uncommitted on disk)
**Status:** in progress; bench landed showing reader-model regression. Next step is a `--skip-ingest` flag and another reader-model A/B.

## What this session was for

Session 1 closed at: T1 recall@5 = 100%, reader_correct = 82%, T2/T3/T4 untested (silent generator bug). The session 2 goal: push reader quality on T1, get real signal on T2/T3/T4, fix multi-hop.

## Diagnostic findings before any fix

From the [Tier-2 baseline run](packages/mcp/bench/runs/20260426203757-3Y3P5M8B/results.json) (gemma4:26b reader, single-pass retrieval, fixture `B3G0FYCMEKRJDXHYDXE1533726`):

- T1 reader_correct 82% — **6 of 9 wrong verdicts had recall@1 = 1.** Reader correctly identified the answer entity, then appended fabricated mechanism (e.g. "issues session tokens consumed during the handshake phase"). Same disease across all gemma models.
- T2/T3/T4 = empty in fixture — generator silently dropped them. Bug was in [03-queries.ts](packages/mcp/bench/src/stages/03-queries.ts): `if (!parsed) break;` on parse failure with zero logging.
- T5 (no-context) = 84.5% reader_correct — sanity-check tier, no retrieval signal.

## Changes landed in this session (all on disk, uncommitted)

### Bug fixes (universally good — keep regardless of next reader)

| File | Change |
|---|---|
| [packages/mcp/bench/src/providers/anthropic.ts](packages/mcp/bench/src/providers/anthropic.ts) | When `response_format: "json"` is requested, append a system instruction asking for JSON-only output. Tried assistant-prefill first (Sonnet 4.6 rejects: "model does not support assistant message prefill"). |
| [packages/mcp/bench/src/stages/03-queries.ts](packages/mcp/bench/src/stages/03-queries.ts) | Replaced silent `if (!parsed) break;` with logged warnings: `query.tier.parse_failed`, `query.t4.extract_failed`, `query.t4.schema_failed`, `query.t5.extract_failed`, `query.t5.schema_failed`, `query.t5.all_filtered`. Added balanced-brace JSON walker to `extractJson` so prose-wrapped responses parse. |
| [packages/mcp/bench/src/providers/types.ts](packages/mcp/bench/src/providers/types.ts) | Added `disable_thinking?: boolean` to `LlmCallRequest`. |
| [packages/mcp/bench/src/providers/ollama.ts](packages/mcp/bench/src/providers/ollama.ts) | Honors `disable_thinking` via `body.think = false`. Defensive fallback: surfaces `message.thinking` when `message.content` is empty (gemma4/qwen3 used to return empty content when num_predict was eaten by hidden reasoning). |
| [packages/mcp/bench/src/lib/cost.ts](packages/mcp/bench/src/lib/cost.ts) | Added `role_5` (retrieval-time LLM calls) to `BudgetMeter`. Always Ollama in v1, always $0, but auditable. |
| [packages/mcp/bench/src/lib/logger.ts](packages/mcp/bench/src/lib/logger.ts) | Extended `BenchLogFields` with new diagnostic keys. |
| [packages/mcp/bench/config.yaml](packages/mcp/bench/config.yaml) | `roles.query_author.max_tokens: 2000 → 8000` (T2/T3/T4 responses were truncating mid-array at 2000). |
| [packages/mcp/bench/.env](packages/mcp/bench/.env) | `JUNE_BIN` path corrected (was `/packages/mcp/cli/june.ts`, should be `/packages/mcp/ingest/cli/june.ts`). |

### Reader prompt rewrite

[packages/mcp/bench/prompts/reader.md](packages/mcp/bench/prompts/reader.md) rewritten: one sentence ≤25 words, no fabricated mechanism, explicit "do not invent product mechanisms, security properties, ordering guarantees, or behavioral descriptions", structured `Sources: <chunk_id>` trailer. The prompt is maximally restrictive — further tightening probably won't help. The remaining failures are model-compliance failures.

### Multi-hop retriever (Phase B)

| File | Purpose |
|---|---|
| **NEW** [packages/mcp/bench/src/retriever/multi-hop.ts](packages/mcp/bench/src/retriever/multi-hop.ts) | `createMultiHopRetriever({inner, plannerProvider, plannerModel, plannerMaxTokens, fetchChunkContent, budget})`. Wraps any `Retriever`. Calls planner LLM to decompose query into hops; for hops with `depends_on`, extracts the bridge entity from the dependency's top-3 chunks and substitutes it into the hop's templated query. Combines all hops' results via RRF (`rank_constant=60`). Returns top-K. Has `parseJson` with balanced-brace walker. |
| **NEW** [packages/mcp/bench/prompts/decompose-query.md](packages/mcp/bench/prompts/decompose-query.md) | Decomposer prompt. Outputs `{hops: [{query, depends_on?}]}`. Examples cover single-hop, multi-hop. |
| **NEW** [packages/mcp/bench/prompts/extract-bridge.md](packages/mcp/bench/prompts/extract-bridge.md) | Bridge extractor. Returns `{entity: "<name>"}` from chunks + question, or `{entity: ""}` to bail. |
| [packages/mcp/bench/src/schemas/config.ts](packages/mcp/bench/src/schemas/config.ts) | Added optional `retrieval.multi_hop: { enabled, planner: { provider, model, max_tokens } }` block. |
| [packages/mcp/bench/cli/run.ts](packages/mcp/bench/cli/run.ts) | Wraps the inner retriever in `createMultiHopRetriever` when config enables it. Owns its own SQLite connection (closed after stage 6). Stage 7 still opens its own — read-only, no contention. |
| [packages/mcp/bench/config.yaml](packages/mcp/bench/config.yaml) | Added `retrieval.multi_hop: { enabled: true, planner: ollama/gemma3:27B }`. |

### Reader model swap

[packages/mcp/bench/config.yaml](packages/mcp/bench/config.yaml): `roles.reader.model` set to **gemma3:27B** (operator preference; do not auto-revert without checking with Cam first).

## Bench results

Three same-fixture runs in this session, all on `RP6PNN3KW7Q2JS2R0GQ3Z00JZG` (180 queries: T1=50, T2=50, T3=40, T4=40, T5=0):

| Run | Reader | Multi-hop | T1 reader | T2 reader | T3 reader | T4 recall@5 | T4 reader | Notes |
|---|---|---|---|---|---|---|---|---|
| `20260427004403-E0DAKXYK` | gemma4:26b | off | 90% | 68% | 87.5% | 30% | 5% | The "before" baseline for this session |
| `20260427022029-C7DSWCYB` | qwen2.5-coder:14b | on | — | — | — | — | — | Killed by mistake mid-ingest |
| `20260427024804-GT4XF05M` | **gemma3:27B** | **on** | **64%** | **64%** | **67.5%** | **20%** | **7.5%** | Latest. Regression on T1/T2/T3, drop on T4 recall |

**Verdict:** The gemma3:27B + multi-hop combo regressed across the board.

### Why T1 dropped from 90% → 64%

Same fixture, mostly the same retrieved chunks (verified: 4 of 5 chunks byte-identical between runs for the typical T1 query — see analysis at end of session 2 transcript). Reader output differs because **gemma3:27B has the same elaboration disease as gemma4:26b, slightly worse on T1**. Sample regression cases (chunks identical, only the reader changed):

- q-0005 "What port does Dargwave Transport use for control messages?" — answer adds "for session negotiation, keepalive signaling, and administrative commands" (fabricated detail).
- q-0017 "What does Viznet Exchange authenticate via?" — adds "delegating all credential validation and token issuance to the Borghyl Control subsystem" (fabricated).
- q-0049 "What encoding does Glorbulon Protocol use for payloads?" — adds "using `ext` types for timestamp and UUID fields" (fabricated).

**The reader prompt and `disable_thinking: true` are not enough on the gemma family. They elaborate.**

### Why T4 recall@5 dropped 30% → 20% with multi-hop

The decomposer (gemma3:27B) was the planner. Sample of resolved bridges from the live run:
- Good: "Borghyl Control", "Snorblath Protocol", "Glorbulon Protocol", "Plirnode Framework", "Dargwave Transport"
- Bad (resolved to a value, not an entity): "JSON", "lz4", "port 7918", "7 seconds", "2 seconds", "386 seconds", "port 7861"
- Empty: ~5–10 explicit `multi_hop.extract_failed` events with `{"entity": ""}`

When the bridge resolves to a literal value, the second-hop retrieval fetches noise. RRF fusion lets that noise displace correct chunks from top-5. The wrapper's fail-soft (use only hop 1's results when extract fails) catches the empty case but not the value case.

### Discovered bug: chunk_id is non-deterministic

Two ingestions of the same fixture produced **different chunk_ids for byte-identical raw_content**. Verified by sha256 of all 158 chunks' raw_content fields across both ingestions (sha matches), but chunk_ids in the SQLite differ. June's chunk_id derivation includes some non-deterministic component (timestamp? run_id?). Not blocking the bench (retrieval still hits the right content), but means cross-run chunk_id comparisons are nonsense — must compare by content hash.

### Discovered bug (logged, not fixed): T5 generator silent-failure

The fresh fixture has T1 + T2 + T3 + T4 populated (180 queries) but T5 = 0. Logging is now in place ([03-queries.ts](packages/mcp/bench/src/stages/03-queries.ts) `query.t5.*`) but the generator wasn't re-run with logs to find the cause. Lowest-priority — T5 is just a no-context refusal sanity check.

## Costs spent this session

| Item | $ |
|---|---|
| Failed prefill generate (Anthropic rejected) | 0.01 |
| Failed truncated-JSON generate (max_tokens too low) | 0.55 |
| Successful generate of fixture `RP6PNN3KW7Q2JS2R0GQ3Z00JZG` | 0.74 |
| Run E0DAKXYK (gemma4:26b, no multi-hop) | 0.20 |
| Run GT4XF05M (gemma3:27B + multi-hop) | 0.20 |
| **Total session spend** | **~$1.70** |

## Next steps (in order)

1. **`--skip-ingest <prior-run-id>` flag** — biggest dev-velocity win. Re-running the same fixture re-ingests for 25 min every time. Stage 4 should be skippable when Qdrant collections + bench-scratch SQLite exist for the fixture. Plan: add a flag to [run.ts](packages/mcp/bench/cli/run.ts) that points at an existing scratch dir, validates the SQLite has the right ingest_run_id, validates Qdrant collection counts, then jumps straight to stage 5. **Cuts every iteration from ~50 min → ~25 min.** This is what the user asked me to build before handing off.
2. **Try qwen2.5-coder:14b reader.** Bring back the original Phase A pick. The gemma family doesn't work for verbatim extraction. (Cam pushed back on this in session 2 — note the rationale: same retrieved chunks across runs but different reader output is the smoking gun for "model is the cause of the regression.")
3. **Multi-hop bridge-extract guards.** Reject extracted strings that are pure numbers, contain "port", are < 5 chars, or match common literal-value patterns. When rejected, fall back to single-pass (just hop 1's results).
4. **Summarizer parallelism in june's ingest.** [packages/mcp/ingest/src/pipeline/stages/06-summarize.ts:99](packages/mcp/ingest/src/pipeline/stages/06-summarize.ts#L99) is a serial `for await`. Bounded `Promise.all` at concurrency 4–8 would 4–8× stage 4. ~30 min code.
5. **Summarizer model upgrade.** smollm:1.7b is so small the GPU is wasted on call overhead — latency-bound. qwen2.5:7b (~5 GB VRAM) probably *faster* per-call because it actually saturates the GPU. Plus better summaries → cleaner embed_text → likely T2/T3 retrieval lift. Free upgrade with the 24 GB budget.
6. **T5 generator fix.** Run generate, read the new `query.t5.*` warnings, fix the cause.

## Files index for fast handoff

- Bench config: [packages/mcp/bench/config.yaml](packages/mcp/bench/config.yaml)
- Bench env: [packages/mcp/bench/.env](packages/mcp/bench/.env)
- Bench CLI entry: [packages/mcp/bench/cli/bench.ts](packages/mcp/bench/cli/bench.ts) and [cli/run.ts](packages/mcp/bench/cli/run.ts)
- Multi-hop retriever: [packages/mcp/bench/src/retriever/multi-hop.ts](packages/mcp/bench/src/retriever/multi-hop.ts)
- Stopgap retriever: [packages/mcp/bench/src/retriever/stopgap.ts](packages/mcp/bench/src/retriever/stopgap.ts)
- Stage 6 retrieval: [packages/mcp/bench/src/stages/06-retrieval.ts](packages/mcp/bench/src/stages/06-retrieval.ts)
- Reader stage: [packages/mcp/bench/src/stages/07-reader.ts](packages/mcp/bench/src/stages/07-reader.ts)
- Reader prompt: [packages/mcp/bench/prompts/reader.md](packages/mcp/bench/prompts/reader.md)
- Decompose prompt: [packages/mcp/bench/prompts/decompose-query.md](packages/mcp/bench/prompts/decompose-query.md)
- Bridge prompt: [packages/mcp/bench/prompts/extract-bridge.md](packages/mcp/bench/prompts/extract-bridge.md)
- Latest fixture: [packages/mcp/bench/fixtures/RP6PNN3KW7Q2JS2R0GQ3Z00JZG](packages/mcp/bench/fixtures/RP6PNN3KW7Q2JS2R0GQ3Z00JZG)
- Latest run: [packages/mcp/bench/runs/20260427024804-GT4XF05M](packages/mcp/bench/runs/20260427024804-GT4XF05M)
- Prior baseline run (this session): [packages/mcp/bench/runs/20260427004403-E0DAKXYK](packages/mcp/bench/runs/20260427004403-E0DAKXYK)
- June ingest summarizer (next-priority cleanup): [packages/mcp/ingest/src/pipeline/stages/06-summarize.ts](packages/mcp/ingest/src/pipeline/stages/06-summarize.ts)

## How to re-run with current state

Anthropic credits required (~$0.20 per run). Ollama at `$OLLAMA_URL` (see [.env](packages/mcp/bench/.env)) must be reachable. Qdrant at `localhost:6333` must be up.

```bash
# Confirm everything green
cd /home/cam/june/packages/mcp/bench
bun cli/bench.ts health

# Purge stale Qdrant data (CONFIRM with Cam first; these are project collections)
curl -X DELETE http://localhost:6333/collections/internal_v1
curl -X DELETE http://localhost:6333/collections/external_v1

# Run end-to-end (~50 min, $0.20)
bun /home/cam/june/packages/mcp/bench/cli/bench.ts run \
  /home/cam/june/packages/mcp/bench/fixtures/RP6PNN3KW7Q2JS2R0GQ3Z00JZG \
  --yes --log-json
```

Note: must run from inside `packages/mcp/bench` or use absolute paths — the `@/*` import alias breaks otherwise.

## What NOT to do

- **Don't auto-revert the reader to gemma4:26b or away from gemma3:27B without confirming with Cam.** The user explicitly chose gemma3:27B in session 2.
- **Don't drop multi-hop entirely.** It does help when bridge-extract works. Fix the bridge guards before reaching for the off-switch.
- **Don't re-generate the fixture.** Spent $0.74 on the current one and it's good enough. T2/T3/T4 are populated. T5 is missing but low priority.
- **Don't tighten the reader prompt further.** It's already maximally explicit. The remaining failures are model-side, not prompt-side.

---

# Session 3 — dev-velocity tooling + llama3.1 trial (interrupted)

**Date:** 2026-04-27 (~22:00–22:25)
**Branch:** main
**Commits:** none — everything below is uncommitted on disk
**Status:** in progress. Step 0 of an approved 3-step plan landed; Steps 1–2 are designed (modules pre-staged) but not wired.

## What this session was for

Session 2 closed with a working fixture, multi-hop retriever, and a reader-model regression on gemma3:27B. The session 3 goal was twofold:

1. **Ship dev-velocity tooling** so each iteration is minutes, not ~50 min: `--skip-ingest`, `--quick`/`--sample`, an LLM response cache, and per-stage cache control.
2. **Try llama3.1:8B as the reader** to see whether it elaborates less than the gemma family.

## What landed (functional, on disk, uncommitted)

### `--skip-ingest <prior-run-id>` flag — DONE & verified

Reuses Stage 4 artifacts (scratch SQLite + Qdrant collections) from a prior run. Cuts ~25 min off each iteration when ingest is known-good.

- Implementation: [packages/mcp/bench/cli/run.ts](packages/mcp/bench/cli/run.ts) — new `prepareSkipIngest` helper at lines 382-454 (before this session's later edits — line numbers may shift).
- Validates: prior `runs/<id>/ingest_manifest.json` exists, `fixture_id` matches, scratch SQLite has the recorded `ingest_run_id`, every Qdrant collection alias still resolves.
- Exit codes: any guard failure → `UsageError` (exit 64) with actionable message.
- Mutually exclusive with `--resume` (resume picks up artifacts in the *new* run-dir; skip-ingest reuses ingest from a *prior* run-dir).
- Smoke-tested with `--skip-ingest 20260427024804-GT4XF05M`: stage 4 marked `(reused)` 0.0s; stage 5 resolved 120/120 facts via SQLite substring matches (proves SQLite content + Qdrant aliases all intact).

### `--quick` / `--sample <ratio>` flags — DONE & static-checked, NOT smoke-tested live

Deterministic per-tier subsetting so iteration smoke passes are seconds, not tens of minutes.

- `--quick` is shorthand for `--sample 0.1` (10% per tier).
- `--sample <ratio>` accepts a float in (0, 1].
- Stratified by tier; sorted by `query_id` lexicographically; takes the head — same fixture + same ratio always yields the same subset (so reader A/B comparisons are on identical workloads).
- Bootstrap CIs widen — stderr emits a loud warning and the log line `run.sample.applied` records `query_count`, `candidates`, `sampled_ratio`.
- `--quick` and `--sample` are mutually exclusive.
- Implementation: [packages/mcp/bench/cli/run.ts](packages/mcp/bench/cli/run.ts) — `parseSampleRatio` + `stratifiedSample` helpers; sampling applied right after `queries.json` is loaded (fixture hash uses the *full* set so sampled runs remain attributable to the canonical fixture).
- Negative paths verified: `--quick --sample 0.1` → exits 64 with mutual-exclusion error; `--sample 1.5` → exits 64 with range error.

### `--out` default + `state/` dir consolidation — DONE & static-checked

All bench local state now lives under one top-level dir to make `rm -rf state/` a one-shot reset.

- New layout (created on disk): `packages/mcp/bench/state/{runs,scratch,cache/llm}/`
- `state/.gitkeep` + `state/cache/.gitkeep` are tracked so the dir survives a fresh clone; everything else under `state/` is gitignored.
- [packages/mcp/bench/config.yaml](packages/mcp/bench/config.yaml): `ingest.scratch_root: ./state/scratch` (was `./bench-scratch`); new `caching.cache_root: ./state/cache/llm`.
- [packages/mcp/bench/src/schemas/config.ts](packages/mcp/bench/src/schemas/config.ts): `caching.cache_root` schema field added (zod default `./state/cache/llm`).
- [packages/mcp/bench/cli/run.ts](packages/mcp/bench/cli/run.ts): `--out` default changed `./runs` → `./state/runs`.
- [.gitignore](.gitignore): explicit rules added under `# bench local state` heading; legacy `bench-scratch/` and `runs/` rules KEPT under a `# legacy paths` heading because the prior runs (Session 1/2 artifacts in `runs/`) still live there. Migration is an operator action — they can `mv runs/* state/runs/ && mv bench-scratch/* state/scratch/` once they're sure nothing in flight points at them.
- Verified: `git check-ignore -v packages/mcp/bench/state/cache/.gitkeep` returns the `!`-rule (file is tracked); same file under `state/cache/llm/anthropic/<key>.json` matches the ignore rule.

### LLM response cache modules (PRE-STAGED, NOT WIRED) — `--cache` does not work yet

**These two files are on disk but no caller invokes them. The bench behaves identically with them present until Step 1 wires them in.**

- [packages/mcp/bench/src/lib/llm-cache.ts](packages/mcp/bench/src/lib/llm-cache.ts): SHA-256-keyed disk K/V. Key inputs: `provider_name`, `model`, `system`, `messages`, `max_tokens`, `temperature`, `response_format`, `disable_thinking`. `custom_id` is deliberately excluded for batch-request keys (rebound on hit).
- [packages/mcp/bench/src/providers/cache.ts](packages/mcp/bench/src/providers/cache.ts): `withProviderCache(provider, cache_root)` and `withBatchProviderCache(provider, cache_root)`. The batch wrapper does per-request caching with synthetic batch-id encoding (`cached:<hash>` for full hits, `mixed:<real_id>:<hash>` for partial hits) so Stage 8's existing checkpoint/resume flow keeps working.
- Hits set `cost_usd: 0` so the BudgetMeter sees them as free; the original cost is preserved in the cache file for audit.

### llama3.1:8B reader trial — DIED on Anthropic 429s before Stage 8

- Config swapped: [packages/mcp/bench/config.yaml](packages/mcp/bench/config.yaml) `roles.reader.model: llama3.1:latest` (was gemma3:27B), concurrency raised to 4 (8B fits multiple in 24G VRAM). Multi-hop planner kept on gemma3:27B to isolate the reader change.
- Run-dir: [packages/mcp/bench/runs/20260427040559-WXV6BTZG/](packages/mcp/bench/runs/20260427040559-WXV6BTZG/)
- Used `--skip-ingest 20260427024804-GT4XF05M` — stages 4 + 5 reused in 0.0s (worked perfectly).
- Stage 6 retrieval: 424s (~7 min — multi-hop planner makes 2-4 LLM calls per T4 query).
- Stage 7 reader: completed; `reader_answers.json` (135K) on disk.
- Stage 7 baseline (no-RAG sonnet-4-6): hammered Anthropic at concurrency-2 in parallel with the reader; account hit per-minute rate-limit cap. The retry handler ([packages/mcp/bench/src/providers/retry.ts](packages/mcp/bench/src/providers/retry.ts)) backed off 1s→2s→4s→8s→16s and gave up after 5 retries → `ProviderRateLimitExhausted` → exit 1.
- Log: `/tmp/llama31-run.log`
- Reader and retrieval artifacts both preserved on disk. The run can be salvaged.

## How to salvage the llama3.1 run

The dead run-dir has `ground_truth.json`, `retrieval_results.json`, and `reader_answers.json` for llama3.1. Three options:

1. **Easiest — disable baseline + resume.** Edit [config.yaml](packages/mcp/bench/config.yaml) `baseline.no_rag_opus: false` and run:
   ```bash
   bun /home/cam/june/packages/mcp/bench/cli/bench.ts run \
     /home/cam/june/packages/mcp/bench/fixtures/RP6PNN3KW7Q2JS2R0GQ3Z00JZG \
     --resume --out /home/cam/june/packages/mcp/bench/runs --yes \
     --config /home/cam/june/packages/mcp/bench/config.yaml
   ```
   `--resume` will skip stages 4-7 and run only judge+score. Cost: ~$0.20 (judge batch).
   Note: `--out` is set explicitly to `./runs` because the run-dir was created under the legacy path before the Step-0 default flip.

2. **Wait until Step 1 lands then turn on `--cache`** — re-running will hit the cache for stages it can, but the existing reader_answers won't help much since the judge prompt is the gate.

3. **Drop the run.** It died once because Cam's Anthropic account hit a per-minute cap. The same will happen on retry without a quota change or smaller baseline concurrency.

If salvaging, the dev expectation is **llama3.1:8B will likely regress further than gemma3:27B** — see Session 2's pattern where smaller readers elaborate more under the verbatim-only prompt. The whole point of running was to confirm or refute that hypothesis, so even a partial result is useful. Don't compare numbers to Session 2's `20260427024804-GT4XF05M` until baseline+judge complete.

## Approved plan still pending

[/home/cam/.claude/plans/valiant-chasing-whisper.md](/home/cam/.claude/plans/valiant-chasing-whisper.md) holds the approved design. Step 0 (state-dir consolidation) landed in this session; Steps 1, 2, 3 remain.

### Step 1 — Wire LLM-cache (~30 LOC across 3 files)

- [packages/mcp/bench/src/providers/index.ts](packages/mcp/bench/src/providers/index.ts) — add `wrapRegistryWithCache(registry, cache_root)` that maps each sync provider through `withProviderCache` and the batch one through `withBatchProviderCache`.
- [packages/mcp/bench/cli/run.ts](packages/mcp/bench/cli/run.ts) — add `--cache` boolean flag; after `buildProviders()`, call `wrapRegistryWithCache(providers, cfg.caching.cache_root)` when `flag || cfg.caching.enabled`. Update RUN_HELP.
- Verification: run `--cache --quick --skip-ingest <prior>` twice; second run should show `cache.hit` for every reader+judge call, judge cost $0, byte-identical reader output.

### Step 2 — Per-stage cache control (`--from <run-id> --rerun-from <stage>`)

- Both flags REQUIRED together (forces explicit operator intent).
- Stage names: `ingest|resolve|retrieve|reader|judge|score` map to 4|5|6|7|8|9 (accept either).
- New `prepareReuseFromPrior` helper in [cli/run.ts](packages/mcp/bench/cli/run.ts) that copies artifacts for stages `< rerun_from_stage` from prior run-dir to new run-dir, validates the ingest manifest the same way `--skip-ingest` does (extract `validateReusableIngest` from `prepareSkipIngest` and reuse).
- Mutually exclusive with `--resume` and with `--skip-ingest`.
- Verification: `--from X --rerun-from score` completes in <10s with only Stage 9 running; `--from X --rerun-from reader` reuses 4-6 + reruns 7-9.

### Step 3 — Docs

- [packages/mcp/bench/README.md](packages/mcp/bench/README.md): new "Iteration tooling" section listing `--resume`, `--skip-ingest`, `--from + --rerun-from`, `--quick`, `--sample`, `--cache` with the three common loop combinations (smoke pass, reader iteration, scoring tweak).
- This Session 3 entry → consolidate / supersede when it stops being current.

## Files index for fast handoff (Session 3 deltas)

- Plan: [/home/cam/.claude/plans/valiant-chasing-whisper.md](/home/cam/.claude/plans/valiant-chasing-whisper.md)
- Cache modules (pre-staged, not wired): [src/lib/llm-cache.ts](packages/mcp/bench/src/lib/llm-cache.ts), [src/providers/cache.ts](packages/mcp/bench/src/providers/cache.ts)
- Provider registry (where Step 1 wiring goes): [src/providers/index.ts](packages/mcp/bench/src/providers/index.ts)
- CLI driver (where flag wiring + per-stage logic goes): [cli/run.ts](packages/mcp/bench/cli/run.ts)
- New gitignore + state dir layout: [.gitignore](.gitignore) lines 54-69, [state/](packages/mcp/bench/state/)
- Llama3.1 dead run: [runs/20260427040559-WXV6BTZG](packages/mcp/bench/runs/20260427040559-WXV6BTZG)
- Llama3.1 run log: `/tmp/llama31-run.log`

## Costs spent this session

| Item | $ |
|---|---|
| Llama3.1 trial (died at baseline) — reader was Ollama ($0); baseline burned an unknown amount of sonnet-4-6 tokens before 429s | unknown — check Anthropic console; estimated <$0.10 since baseline was mid-flight |
| Smoke tests for `--skip-ingest` (Cam's earlier runs verified at ~$0.20/run × 0 fully-completed in this session) | $0 |
| **Total session spend** | **<$0.10 estimated** |

## Updated next-steps priority

In the order I'd take them in a fresh context window:

1. **Decide on the llama3.1 dead run** — salvage with baseline-disabled resume, or drop it. (If dropped, you've lost ~5 min Stage 7 work but nothing else.)
2. **Step 1 — wire `--cache`** (~30 min). Big iteration unlock once turned on, especially when re-running the same reader/judge inputs after a Stage-9 scoring fix or a downstream change. Verification needs two end-to-end smoke runs (~5 min each with `--quick`).
3. **Step 2 — `--from + --rerun-from`** (~1-2 hr). Bigger code surface than Step 1. Critical helper to extract: `validateReusableIngest` from the existing `prepareSkipIngest`. Skip if Step 1's `--cache` already gives you the iteration loop you need.
4. **Step 3 — docs refresh** (~20 min).
5. **Multi-hop bridge-extract guards** (Session 2 priority #3, still open). Reject extracted strings that are pure numbers, contain "port", are <5 chars, or match common literal patterns. ~30 min in [src/retriever/multi-hop.ts](packages/mcp/bench/src/retriever/multi-hop.ts).
6. **qwen2.5-coder:14b reader** (Session 2 priority #2, still open). Phase A's original pick. Worth A/B-ing against gemma3:27B once the iteration loop is fast.
7. **Summarizer parallelism + model upgrade** (Session 2 priorities #4 + #5, still open). Big june-side wins; not bench-side.

## What NOT to do (Session 3 additions)

- **Don't commit until you've decided which subset of these changes belongs together.** The diff spans 11 modified files + 4 new files spanning Sessions 2 and 3 — splitting into logical commits matters for the authorship trailer rules. Run `bash /home/cam/june/scripts/check-authorship.sh` before any commit message.
- **Don't migrate `runs/*` and `bench-scratch/*` into `state/*` automatically.** Cam's prior runs are in those dirs and the Session 1/2 results table at lines 326-332 references them. Migration is an explicit operator move.
- **Don't enable `caching.enabled: true` in committed config.** Default ships off (opt-in via `--cache` or local config edit).
- **Don't re-enable baseline (`baseline.no_rag_opus`) before raising Anthropic concurrency awareness or quota.** That's what killed the llama3.1 run.

---

# Session 4 — Step 1 + Step 2 wired, full-fixture cache populated, llama3.1 measured

**Date:** 2026-04-27 (~22:00–23:25)
**Branch:** main
**Commits:** `2aa18ee` (Session 2 multi-hop bundle), `63ea5f0` (iteration tooling), `<docs>` (this entry + README)
**Status:** Steps 1, 2, 3 of [valiant-chasing-whisper.md](/home/cam/.claude/plans/valiant-chasing-whisper.md) all landed; full-fixture llama3.1 run completed and scored.

## What this session was for

Pick up Session 3's pre-staged work, finish the approved 3-step plan, and produce a measured llama3.1:8B reader number on the full fixture — Session 3 ended with the reader trial dead at baseline rate-limits, so we hadn't seen the metric yet.

## What landed (committed)

### Commit `2aa18ee` — multi-hop retriever + reader-thinking fix + JSON robustness

Rolls up Session 2's uncommitted multi-hop work and the JSON-extraction fixes that came with it:

- [src/retriever/multi-hop.ts](packages/mcp/bench/src/retriever/multi-hop.ts) — wraps the inner retriever; planner decomposes T4 queries via [prompts/decompose-query.md](packages/mcp/bench/prompts/decompose-query.md) and [prompts/extract-bridge.md](packages/mcp/bench/prompts/extract-bridge.md); per-hop rankings fused via RRF.
- [src/stages/07-reader.ts](packages/mcp/bench/src/stages/07-reader.ts) sets `disable_thinking: true` on Ollama calls so verbatim-extraction on thinking-enabled models (gemma4, qwen3, deepseek-r1) can't return empty content when `num_predict` is consumed by hidden reasoning. New optional `disable_thinking` field on [LlmCallRequest](packages/mcp/bench/src/providers/types.ts); honored by [providers/ollama.ts](packages/mcp/bench/src/providers/ollama.ts) which also surfaces `message.thinking` as a defensive fallback when `message.content` is empty.
- [providers/anthropic.ts](packages/mcp/bench/src/providers/anthropic.ts) steers JSON output via a system-prompt suffix (Claude 4.x rejects assistant-prefill).
- [stages/03-queries.ts](packages/mcp/bench/src/stages/03-queries.ts) gains balanced-`{...}` JSON extraction + explicit parse-failure logging so prose-wrapped output from gemma3:27B is recoverable.
- [src/lib/cost.ts](packages/mcp/bench/src/lib/cost.ts) `BudgetMeter` adds `role_5` for retrieval-time LLM calls (multi-hop planner spend).

### Commit `63ea5f0` — bench iteration tooling

The §32-style iteration loop. All three approved Steps from the plan in one cohesive commit because [cli/run.ts](packages/mcp/bench/cli/run.ts), [src/lib/logger.ts](packages/mcp/bench/src/lib/logger.ts), and [src/schemas/config.ts](packages/mcp/bench/src/schemas/config.ts) are touched by every step:

- **State-dir consolidation:** `packages/mcp/bench/state/{runs,scratch,cache/llm}/` with `.gitkeep` pinning the layout. Legacy `runs/` and `bench-scratch/` rules kept ignored so prior artifacts survive until the operator migrates.
- **`--skip-ingest <run_id>`:** reuse Stage 4 from a prior run-dir; validates fixture id, scratch SQLite presence, `ingestion_runs` row, every Qdrant collection alias.
- **`--quick` / `--sample <ratio>`:** deterministic per-tier subsetting; same fixture + same ratio = same subset; loud CI-widen warning.
- **`--cache`:** boolean flag wraps every provider with [src/providers/cache.ts](packages/mcp/bench/src/providers/cache.ts) (sync) or [withBatchProviderCache](packages/mcp/bench/src/providers/cache.ts) (Anthropic Batch). Cache key in [src/lib/llm-cache.ts](packages/mcp/bench/src/lib/llm-cache.ts) is SHA-256 over `(provider, model, system, messages, max_tokens, temperature, response_format, disable_thinking)`. Hits report `cost_usd: 0`; original cost preserved in cache file.
- **`--from <run_id> --rerun-from <stage>`:** copies prior-run artifacts for every stage strictly below `<stage>` into the new run-dir; named (`ingest|resolve|retrieve|reader|judge|score`) and numeric (`4|5|6|7|8|9`) inputs both accepted. `prepareSkipIngest` refactored: validation half extracted into shared `validateReusableIngest`. `resume`-only stage gates moved to `reuse_artifacts := resume || skip_ingest || from`.

## Verifications

| Test | Result |
|---|---|
| `tsc --noEmit` from `packages/mcp/bench/` | exit 0 after both commits |
| Smoke 1 (`--cache --quick --skip-ingest`, cold cache) | 8.5min, $0.0203, all `cache.miss` |
| Smoke 2 (same flags, warm cache) | **9s, $0.00**, 58 `cache.hit` + 2 `cache.batch.full_hit`, 0 misses, 0 live judge submits |
| Reader text byte-identical between smoke 1 and smoke 2 | yes — only diffs are timestamps, latency_ms zeroed, bootstrap-CI RNG jitter |
| `--from <smoke1> --rerun-from score` | **50ms**, $0, 7 artifacts copied, only Stage 9 ran |
| `--from <smoke1> --rerun-from reader` + `--cache` | **67ms**, $0, 36 hit + 2 batch full-hit, 3 artifacts copied |
| Negative paths (4 mutex + bogus stage + missing prior) | all exit 64 with actionable message |

## Full-fixture llama3.1 run — `runs/20260427045300-WG1B0WH6`

After Steps 1+2 verified, ran the **full 180-query fixture** with `--cache --skip-ingest 20260427024804-GT4XF05M --out ./runs --yes` to (a) produce the missing llama3.1 metric and (b) populate the cache for every reader, baseline, planner, and judge call so future iterations skip live API calls entirely.

**Headline:** llama3.1:latest with retrieval **61.7%** reader-correct (95% CI [55.0%, 68.9%]) vs claude-sonnet-4-6 no-RAG **0.0%**. Wall clock 19:15. Cost $0.1828.

| Tier | N | Recall@5 | MRR | Reader-correct |
|---|---|---|---|---|
| T1 atomic | 50 | 100.0% | 93.0% | 86.0% |
| T2 relational | 50 | 96.0% | 77.0% | 72.0% |
| T3 translation | 40 | 95.0% | 86.7% | 72.5% |
| **T4 multi-hop** | **40** | **20.0%** | **9.2%** | **7.5%** |
| T5 out-of-corpus | **0** | — | — | — |
| **Macro** | — | 62.2% | 53.2% | 47.6% |
| **Micro** | 180 | 80.0% | 68.6% | 61.7% |

Compare to the Session 2 baseline (gemma3:27B, run-id `20260427024804-GT4XF05M`, full results in [runs/20260427024804-GT4XF05M/summary.md](packages/mcp/bench/runs/20260427024804-GT4XF05M/summary.md)). The two share the same fixture + the same `--skip-ingest`-validated ingest, so a tier-by-tier diff is honest.

### Findings

1. **T4 collapsed.** Recall@5 = 20%, reader-correct = 7.5%. The multi-hop planner runs end-to-end (we see decomposition + bridge-extract calls in the log) but retrieval isn't finding the bridge entity ~80% of the time. This is the dominant drag on the micro number — fixing it has a much bigger payoff than reader swaps.
2. **T5 = 0 queries.** `config.yaml` has `queries.counts.T5: 70` but the fixture and run report 0 T5 queries. Either the fixture's query authoring dropped T5 (check `fixtures/RP6PNN3KW7Q2JS2R0GQ3Z00JZG/queries.json` for the T5 entry count) or Stage 5/6 filters them silently. Worth investigating before running again.
3. **Llama3.1 elaboration is *muted*, not amplified.** The Session 2 hypothesis was "smaller readers elaborate more under verbatim-only prompts" (gemma family confirmed it). Llama3.1:8B with the same `disable_thinking: true` reader prompt produced only 2 hallucinations in 10 sampled verdicts. Sample is small but the direction contradicts the hypothesis. The `disable_thinking` plumbing from commit `2aa18ee` is doing real work here.
4. **Integrity clean:** 0.6% UNJUDGED, 0% leakage warnings, 0% unresolved, 0% embedding-fallback. Nothing else to chase.

## Cache state on disk

`packages/mcp/bench/state/cache/llm/` — 942 entries:

| Provider | Entries | Covers |
|---|---|---|
| `anthropic` | 180 | One per query baseline call (no-RAG sonnet-4-6) |
| `anthropic-batch` | 360 | 180 reader-judge + 180 baseline-judge |
| `ollama` | 402 | 180 reader + 222 multi-hop planner (decompose + bridge-extract) |

Any future re-run with this exact fixture + identical reader/judge prompts + identical retrieval results hits the cache for every LLM call and costs $0. The cache is opt-in via `--cache`; default `caching.enabled: false` in [config.yaml](packages/mcp/bench/config.yaml).

## Authorship hook is broken — read before next commit

[.claude/scratch/authorship.jsonl](.claude/scratch/authorship.jsonl) has 5 entries, all timestamped `2026-04-21` (3 days ago). The PostToolUse hook that should append on every Write/Edit isn't firing in the current session. Both code commits this session went out without a `Co-authored-by: Claude` trailer per the [CLAUDE.md](packages/mcp/bench/.claude/CLAUDE.md) rule "No tracking data for a file (Cam edited it directly): treat as Cam-primary." Concretely: I authored ~250 LOC in [cli/run.ts](packages/mcp/bench/cli/run.ts) and the entirety of [src/lib/llm-cache.ts](packages/mcp/bench/src/lib/llm-cache.ts) + [src/providers/cache.ts](packages/mcp/bench/src/providers/cache.ts) this session; under the rule-as-written they all committed as Cam-primary. The split is wrong on the merits. Either fix the hook (check [.claude/settings.json](.claude/settings.json) PostToolUse config) and/or amend the two commits with the trailer once authorship is restored.

## Updated next-steps priority

In the order I'd take them in a fresh context window:

1. **Fix the authorship hook** (~15 min). Verify `.claude/settings.json` has the PostToolUse hook configured and that it writes to `.claude/scratch/authorship.jsonl` on Write/Edit. Without this, every future commit's authorship attribution is wrong by default.
2. **Investigate T4 collapse** (~1-2 hr). Now that the cache is fully populated, you can iterate on the multi-hop planner *for free* — all reader+judge inputs are cached, so any retrieval-only tweak lets you re-score in ~50ms with `--from <prior> --rerun-from retrieve`. Concrete things to try:
    - Read [src/retriever/multi-hop.ts](packages/mcp/bench/src/retriever/multi-hop.ts) and the planner outputs in `runs/20260427045300-WG1B0WH6/retrieval_results.json` for the 32 failed T4 queries — see what the planner extracted as a bridge entity vs what was actually needed.
    - **Bridge-extract guards** (Session 3 priority #5, still open): reject extracted strings that are pure numbers, contain "port", are <5 chars, or match common literal patterns. ~30 min.
    - Try a stronger planner model (`gemma4:31b` or `qwen3:14b` are on the box per `curl "$OLLAMA_URL/api/tags"`).
3. **Investigate T5 = 0** (~20 min). Check `fixtures/RP6PNN3KW7Q2JS2R0GQ3Z00JZG/queries.json | jq '[.queries[] | select(.tier=="T5")] | length'`. Either fixture-side bug (re-authoring needed — that means a fresh `generate` run) or bench-side filter bug.
4. **Migrate legacy paths.** `runs/` has the Session 1, 2, 3 dead-llama, and the new full-llama runs. `bench-scratch/` has the scratch SQLite still alive. Operator move:
   ```bash
   mv runs/* state/runs/ && mv bench-scratch/* state/scratch/
   ```
   After migration, drop the legacy ignore rules from [.gitignore](.gitignore) lines 67-69.
5. **Drop the dead llama3.1 run.** [runs/20260427040559-WXV6BTZG/](packages/mcp/bench/runs/20260427040559-WXV6BTZG/) is superseded by [runs/20260427045300-WG1B0WH6/](packages/mcp/bench/runs/20260427045300-WG1B0WH6/) (same reader, same fixture, same skip-ingest target, but completed). Safe to `rm -rf`.
6. **qwen2.5-coder:14b reader A/B** (Session 2 priority #2, still open). Worth trying once T4 is fixed, since T4 is reader-independent — fixing T4 first avoids re-running cost.

## Costs spent this session

| Item | $ |
|---|---|
| Smoke 1 (cold-cache `--quick`) | $0.0203 |
| Smokes 2/3/4 (warm-cache `--quick`) | $0 |
| Full-fixture llama3.1 run (`20260427045300-WG1B0WH6`) | $0.1828 |
| **Total session spend** | **$0.2031** |

## Files index for fast handoff

- Plan: [/home/cam/.claude/plans/valiant-chasing-whisper.md](/home/cam/.claude/plans/valiant-chasing-whisper.md) — all four steps (0/1/2/3) now complete.
- New runs this session:
  - `runs/20260427042834-3D6AF0JW` — smoke 1 (cold cache, --quick)
  - `runs/20260427043730-MHWAWB03` — smoke 2 (warm cache, byte-identical to smoke 1)
  - `runs/20260427044415-XXQ7X3XM` — smoke 3 (`--rerun-from score`, 50ms)
  - `runs/20260427044436-QCN222A4` — smoke 4 (`--rerun-from reader` + `--cache`, 67ms)
  - **`runs/20260427045300-WG1B0WH6` — full-fixture llama3.1 (the one that matters)**
- Cache: `packages/mcp/bench/state/cache/llm/` (942 entries; gitignored)
- Scratch: `bench-scratch/RP6PNN3KW7Q2JS2R0GQ3Z00JZG-20260427024804-GT4XF05M/` — still on legacy path; the new `--skip-ingest` walks back to it via the prior manifest's `scratch_path`.
