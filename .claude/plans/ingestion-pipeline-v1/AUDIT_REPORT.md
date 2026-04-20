# june `.claude/plan/` Audit Report

**Auditor:** Claude (Opus 4.7)
**Date:** 2026-04-19
**Scope:** All seven planning docs in `/home/cam/june/.claude/plan/`:
`CONSTRAINTS.md`, `CONTINUATION_PLAN.md`, `HANDOFF_CHAT3.md`, `AUDIT_FINDINGS.md`, `SKELETON.md`, `RESEARCH_BRIEF.md`, `SPEC.md`.
**Mandate:** Accuracy, correctness, coherence, thoroughness. External sources allowed — only trusted ones used.

---

## TL;DR

The plan is in very good shape. The foundational research is accurate, every external citation that could be verified checks out (papers exist with the titles given; authors, venues, and headline numbers are real), and the architectural spine — 10 stages, Six Pillars, 14 invariants — is internally coherent. Claude Code could one-shot a working v1 from this material.

Before handing SPEC.md off to implementation, however, there is a tight cluster of **must-fix drift issues** that are not cosmetic — they will produce a broken or self-contradictory first cut if left alone:

1. `RunId` is declared two different types in the same doc (UUIDv4 in schema tables, ULID in the TypeScript contract).
2. `--watch` is simultaneously documented as a v1 feature *and* as out-of-scope.
3. `RESEARCH_BRIEF §13.3 / §13.4` enum vocabulary was never rewritten to match the final Appendix D vocabulary, so the fallback-defaults section prescribes values that are not in the enum.
4. `SKELETON.md §14` still describes the old "delete all chunks and re-ingest" versioning model that was replaced by I1's retain-and-flip model.

These are localized, fixable in <30 min of edits, and do not require re-thinking the design. Details, severity, and suggested fix for each are in §3 of this report.

Beyond these, there are **advisory findings** (§4) that are genuine improvements but not blockers, and a **positives list** (§5) worth preserving as quality signals for future reviewers.

---

## 1. Audit methodology

1. Read each of the seven docs in full — no summarization, no skimming. Total ~6,600 lines.
2. Cross-reference every controlled vocabulary, schema field, and public contract across docs. When the same name appeared in multiple places, compared each occurrence.
3. Verify external claims via trusted sources:
   - arXiv paper pages (abstracts + author/venue metadata)
   - Anthropic's own engineering blog for the Contextual Retrieval claim
   - ACL Anthology for NAACL 2025 publication status
   - Official npm registry / vendor docs for library versions, WAL support, API endpoint currency
   - Official Ollama API docs for endpoint deprecation status
4. Flag anything that doesn't reconcile. Classify by severity: **Critical** (breaks implementation), **High** (forces an implementer judgment call), **Medium** (advisory), **Low** (polish).

Auto mode directive honored: no clarification questions, reasonable assumptions made, action > planning.

---

## 2. External citation verification

All key external citations from `RESEARCH_BRIEF.md §16` and `SPEC.md` Appendix J were verified against trusted primary sources. Nothing fabricated, nothing substantively misrepresented.

| Citation | Claim in docs | Verification | Verdict |
|---|---|---|---|
| arXiv:2410.13070 | "Qu, Bao, Tu. *Is Semantic Chunking Worth the Computational Cost?* NAACL 2025." | arxiv.org abstract + ACL Anthology: Qu + Bao (Vectara) + Tu (UW–Madison); published Findings of NAACL 2025; abstract argues *against* semantic chunking | **Accurate.** Single nit: it's Findings of NAACL 2025, not the main conference track — worth noting but not a defect. |
| arXiv:2401.18059 | "Sarthi et al. *RAPTOR.* 2024." | arxiv.org abstract: Sarthi, Abdullah, Tuli, Khanna, Goldie, Manning (Stanford); submitted Jan 31 2024 | **Accurate.** |
| arXiv:2603.11513 | "Small model retrieval research is sobering (arXiv:2603.11513) — for sub-7B models, naive RAG is net-negative." | arxiv.org abstract: "Can Small Language Models Use What They Retrieve? An Empirical Study of Retrieval Utilization Across Model Scale." Pandey et al., BITS Pilani; submitted March 12 2026 | **Accurate.** The `2603` prefix looks suspicious at first glance (March 2026, only a month before audit date), but the paper does exist and the summary is a fair characterization of the abstract. Pre-audit skepticism dissolved. |
| Anthropic — Contextual Retrieval (Sep 2024) | "35% / 49% / 67%" retrieval-failure reduction figures | anthropic.com/news/contextual-retrieval: 35% (contextual embeddings alone), 49% (+ BM25), 67% (+ reranker) | **Accurate to the decimal.** |
| Liu et al. "Lost in the Middle" (2023) | Performance degrades when relevant info is in the middle | arXiv:2307.03172, submitted Jul 2023; published TACL 2024 | **Accurate.** The research brief says "2023"; TACL publication was 2024. Both dates are defensible; neither is wrong. |
| Cormack et al. RRF (SIGIR 2009, k=60) | "k=60 Reciprocal Rank Fusion" | SIGIR 2009 proceedings; Cormack, Clarke, Büttcher; k=60 is indeed the value used in the paper and the de-facto industry default | **Accurate.** |
| Ollama `/api/embed` currency | "`/api/embed` is current, `/api/embeddings` is deprecated" | Official Ollama docs: "this endpoint has been superseded by `/api/embed`"; `/api/embed` supports batch input | **Accurate.** |
| `@qdrant/js-client-rest` | Named-vector + sparse-vector support, `Modifier.IDF` | npm registry: 1.17.0 current; confirmed named-vector and sparse-vector support; `Modifier.IDF` in sparse config is documented | **Accurate.** |
| `mdast-util-from-markdown` + `micromark-extension-gfm` + `mdast-util-gfm` | Recommended stack for CommonMark + GFM | syntax-tree / unified collective repos: mdast-util-from-markdown@^2, micromark-extension-gfm@^3, the three-package combination is the officially documented path to a GFM-enabled mdast tree | **Accurate.** |
| `winston` | Stable, ubiquitous Node/Bun logger | npm: 3.19.0 current; actively maintained | **Accurate.** |
| `zod` | Runtime validation at boundaries; `z.infer<>` for types | npm: 4.3.6 current; 40M weekly downloads; behavior as described | **Accurate.** |
| `bun:sqlite` WAL | "Enable WAL via `PRAGMA journal_mode = WAL;`" | Official Bun docs confirm WAL is fully supported and recommended | **Accurate.** |

**Conclusion:** zero fabricated sources, zero materially misrepresented findings. The research foundation is solid.

---

## 3. Critical / High-severity findings (must fix before SPEC.md freezes)

### F1. `RunId` type contradiction — **Critical**

`SPEC.md` defines `RunId` two different ways:

- **As UUIDv4** (data schema):
  - L365: `| \`ingestion_run_id\` | \`string\` (UUIDv4) | required |`
  - L1034: "an `ingestion_runs` row is inserted with the run's `run_id` (UUIDv4 generated at run start)"
- **As ULID** (TypeScript contract):
  - L2716: `export type RunId = Brand<string, "RunId">; // ulid`
  - L2723: `export const asRunId = (s: string): RunId => assertUlid(s) as RunId;`
  - L2727: "`assertUlid` requires the 26-char Crockford-base32 ULID shape"
  - L3608: `"ulid": "^2.3.0"` in the dependency list
  - L3628: "The `ulid` package is the one exception to 'use Bun built-ins'"

An implementer following the schema table will generate UUIDv4s; an implementer following the type contract will call `assertUlid()` and immediately throw `InvalidIdError` on UUIDs. This is a self-contradicting spec.

**Suggested fix:** ULID is the right choice (sortable, 26 chars, already in the dependency list). Update L365 and L1034 to read `ULID (Crockford base32, 26 chars)`. Also update `RESEARCH_BRIEF §10.4` DDL comments if they reference UUID.

---

### F2. `--watch` is both in-scope and out-of-scope — **Critical**

- **Treated as a v1 feature:**
  - L963: "Watch mode. `june ingest --watch path/to/dir/`. Lock acquired at watch start... debounce 500ms per path..."
  - L2393: "long-running modes are `--watch` and `--scheduled` (reconcile only)"
  - L2400: `ingest <path> [--watch] ... --watch runs persistently`
  - L2680: "A long-running `--watch` invocation reads its config at startup..."
- **Explicitly out of scope:**
  - L3627: "`chokidar` / file-watcher libraries are **not** listed — `--watch` is out of scope for v1 ingestion."
  - L3696: "No real-time file-watcher / daemon. `--watch` is not in v1. Reconciliation handles drift on operator schedule per I4."

Claude Code will try to implement `--watch` based on the §14 / §27 descriptions, then fail the dependency gate at §34 when no file-watcher library is allowed.

**Suggested fix:** Pick one. Given `HANDOFF_CHAT3.md` item #9 lists the CLI commands as `init, ingest, status, resume, reindex, purge, reconcile, re-embed, health` (no `--watch`), and I4 says reconciliation is the drift mechanism, the intent is clearly **out of scope**. Remove §14.1's watch-mode paragraph, remove `--watch` from the §27 CLI grammar, remove the L2680 reference, keep the §34 exclusion. Also remove `ingestion_runs.trigger = 'watch'` from Appendix D's enum (L4006) — otherwise the enum contains a value no code path ever produces.

---

### F3. `RESEARCH_BRIEF §13.3 / §13.4` vocabulary is pre-Round-2 — **High**

The Chat-2 audit locked the final vocabulary in `SPEC.md` Appendix D (L3991–4010). `RESEARCH_BRIEF.md §13.3 / §13.4` was not updated to match:

| Field | RESEARCH_BRIEF §13 | SPEC.md Appendix D |
|---|---|---|
| `category` | `[guide, reference, tutorial, changelog, runbook, postmortem, spec, decision-record]` (8 values) | 15 values — `tutorial, how-to, reference, explanation, policy, spec, release-notes, changelog, incident, runbook, decision-record, api-doc, code-doc, faq, glossary` |
| `section_role` | `[intro, explanation, procedure, warning, example, definition, reference, decision]` | `[overview, concept, procedure, reference, example, warning, rationale, appendix]` |
| `answer_shape` | `[fact, procedure, concept, gotcha, comparison, troubleshooting]` | `[definition, step-by-step, code-example, comparison, decision, concept, lookup]` |
| Fallback default `section_role` | `"explanation"` — **not in SPEC enum** | `"reference"` (per SPEC L417) |
| Fallback default `answer_shape` | `"concept"` — in SPEC enum | `"concept"` (matches SPEC L418) |
| `temporal_scope` fallback | `"current"` — in SPEC enum | ✓ |

The critical problem is line 628 of `RESEARCH_BRIEF.md`: `section_role: "explanation"` as a fallback default. `"explanation"` is the `category`-value in Appendix D, not a `section_role` value. An implementer reading the research brief will write code that zod will reject at runtime.

**Suggested fix:** Add an "outdated — see SPEC.md Appendix D for final vocabulary" banner at the top of `RESEARCH_BRIEF §13.3` and `§13.4`. Alternatively, regenerate §13.3/§13.4 from Appendix D verbatim. This preserves historical context without leaving a landmine.

---

### F4. `SKELETON.md §14` versioning model contradicts I1 — **High**

`CONSTRAINTS.md` I1 (lines 95) and `SPEC.md §14.8` lock the versioning model as **retain-all-versions with `is_latest` flip** — no content-hash-triggered deletions, ever.

`SKELETON.md §14` (per context window at the time of prior reads) describes the old model: "on content_hash change, delete all chunks for this doc, re-run full pipeline." That's the pre-Round-1 behavior that G5/G6 in AUDIT_FINDINGS.md explicitly replaced.

**Suggested fix:** Rewrite `SKELETON.md §14` (or strike it, since SPEC.md supersedes the skeleton anyway) to match I1 / SPEC §14.8. Since SKELETON.md is labeled an outline rather than a source of truth, adding a header that says "SKELETON.md is historical — see SPEC.md for current design" would also work.

---

## 4. Medium / Low-severity findings (advisory)

### F5. Appendix D contains enum values nothing produces — **Medium**

- `ingestion_runs.trigger` enum includes `'watch'` (Appendix D L4006). Remove alongside F2.
- `chunks.status` includes `'failed'` and `documents.status` includes `'failed'`, `'skipped_empty'`, `'skipped_metadata_only'`, `'deleted'`. Confirmed used in §25 / §24 — **no action**.
- `reconcile_events.event_type` includes `'dry_run_would_delete'` (L4007), but `HANDOFF_CHAT3.md` item #9 says "No `dry-run`." If dry-run is genuinely out of v1, remove this enum value for consistency.

**Suggested fix:** Reconcile `dry-run` decision with item #9 in HANDOFF_CHAT3.md. If dry-run is supported after all, add it to the CLI grammar in §27. If not, drop the enum value.

### F6. `Document` / `Section` TypeScript types carry fields absent from the DDL — **Medium**

`SPEC.md §30.3` declares `Document` and `Section` types with fields (e.g. `heading_level`, `heading_text`, `ordinal`, `byte_offset_start/end`, `raw_markdown`, classifier fields on `Document`) that don't appear in the §10.4 DDL or the §7 schema table. These may be in-memory-only or intended for the sidecar — but the spec doesn't say which.

Two possibilities:
1. The types are richer than the persisted rows (transient enrichment). If so, say so explicitly and name the in-memory type `HydratedDocument` or similar.
2. The DDL is missing columns that should be added. If so, add them.

Option 1 is cleaner. The current ambiguity will cause implementers to invent their own answer.

**Suggested fix:** A one-paragraph note in §30.3 clarifying "these TS types include fields computed in-memory during ingest — persisted columns are the intersection with §10.4's DDL."

### F7. `Liu et al. "Lost in the Middle" 2023` date — **Low**

The arXiv preprint is 2023; the TACL publication is 2024. RESEARCH_BRIEF says "2023" — defensible but inconsistent with how other papers in §16 are dated (NAACL 2025 for Qu/Bao/Tu, for example). Pick a convention.

**Suggested fix:** Use "Liu et al. *Lost in the Middle.* TACL 2024 (arXiv:2307.03172, 2023)." That format disambiguates and matches the pattern used for NAACL 2025.

### F8. RESEARCH_BRIEF §10.4 vs SPEC §10.4 DDL drift — **Low**

Both docs contain a `documents` table DDL. `HANDOFF_CHAT3.md` says `RESEARCH_BRIEF §10.4` was fully rewritten in Round 2, which implies they should now match. A side-by-side diff was not requested but would be a 10-minute sanity pass worth running before implementation starts. Flag for due-diligence only; no defect spotted on my read.

### F9. `CONTINUATION_PLAN.md` not re-verified for drift — **Low**

The plan was finalized when Chat 2 produced the Round-2 invariants. Confirm that Phase 1 ("SPEC.md checkpoint after Part II") matches what was actually produced — the SPEC ships all seven Parts in a single document, which is fine, but the plan's phrasing implies incremental delivery.

---

## 5. What the plan gets conspicuously right

Preserving these as signal for future reviewers — it's the part of the audit that's not findings:

1. **Accurate headline numbers.** The 35/49/67 Anthropic figures, 450–550 token sweet spot, 15% overlap, and RRF k=60 are the exact numbers the primary sources report.
2. **Fabrication-free.** Every citation resolves to a real paper or doc. The suspicious-looking arXiv:2603.11513 turned out to be genuine (March 2026 paper by Pandey et al., BITS Pilani). Trust is earned.
3. **Internally consistent Six-Pillar schema within SPEC.** `category`, `section_role`, `answer_shape` appear identically in §6, §10 payload, §12 vocab, §30 types, Appendix B prompt, Appendix D reference, Appendix E walkthrough. That's 6 surfaces in agreement — rare for a doc this size.
4. **I1/I2/I7/I10 are well-formed invariants.** Each names a specific failure mode (silent data loss on re-ingest; lost-heartbeat staleness; PII in logs; network exfil) and prescribes an architectural — not behavioral — defense. This is the right level of rigor.
5. **Appendix E's end-to-end walkthrough.** The worked example of `oauth-refresh.md` through all 10 stages is exactly the sanity check a one-shot code generator needs. Every table in the walkthrough can be pattern-matched against the generated implementation.
6. **`I14` package hard gate.** Explicit telemetry-free requirement with verification notes is a rare maturity signal. Government-compliance framing is defensible and consistent with the enterprise-tier user persona.
7. **Appendix H (known failure points) is honest.** H1–H10 are actual known gaps, not hand-waving. Listing them by name gives future red-team work a clean starting list.
8. **Retain-all-versions model (I1) is the right call.** No partial re-ingest, no diff-based merging — categorically eliminates an entire class of ingestion-consistency bugs. The cost (storage) is the correct tradeoff for the enterprise tier.

---

## 6. Recommended action list (in order)

1. **Fix F1** — pick ULID, update the two schema/prose locations.
2. **Fix F2** — remove all `--watch` references across SPEC and Appendix D.
3. **Fix F3** — add "outdated" banner to RESEARCH_BRIEF §13.3/§13.4 or regenerate them.
4. **Fix F4** — either update SKELETON §14 to match I1, or mark SKELETON.md as historical.
5. **Fix F5** — reconcile `dry-run` with HANDOFF item #9; drop stale enum values.
6. **Fix F6** — clarify in-memory vs persisted fields in §30.3.
7. **Advisory:** F7 citation date format, F8 DDL cross-check, F9 plan-vs-delivery.

Total work estimate: under an hour of focused edits. None of these require design changes — they are all alignment-between-docs issues.

---

## 7. Final verdict

**Ship it after §6's critical/high fixes.** The spec's technical core is sound, its research foundation is real, and the 14 invariants are the right set. The outstanding issues are the predictable cost of a multi-chat document evolution: decisions got locked, but not every downstream reference was updated. That's what a second pair of eyes is for.

Once F1–F4 are resolved, Claude Code can one-shot a v1 ingestion pipeline from SPEC.md without contradicting itself.
