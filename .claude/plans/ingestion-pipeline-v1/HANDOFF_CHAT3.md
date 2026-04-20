# Handoff to Chat 3

**Status:** No SPEC.md written yet. Chat 2 did a Round-2 audit, caught several ripples, and updated the source docs. Chat 3's job is to execute Phase 1 of `CONTINUATION_PLAN.md` — write SPEC.md.

## What Chat 2 accomplished

A second audit pass beyond what produced the original invariants. Findings and resolutions are in **AUDIT_FINDINGS.md under "Round 2"**. All resolutions already folded into:

- **CONSTRAINTS.md** — 14 invariants now (added I12/I13/I14 for Bun-only, env-var split, package hard-gate); I1/I2/I7/I10 rewritten; target stack updated with pinned packages
- **RESEARCH_BRIEF.md** — §10.4 SQLite DDL fully rewritten (versioning, ingestion_errors, reconcile_events, heartbeat lock); §10.6 added (version resolution + is_latest semantics); §10.7 added (multi-backend story)
- **SKELETON.md** — §4 stack, §6 schema fields, §10 tables, §11 IDs, §20 Stage 7, §23 Stage 10, §24 resume, §25 failures, §25.5 offline, §27 CLI, §29 config, §32 API all updated

## Cam's engineering guardrails (non-negotiable, per memory + I12-I14)

- **Bun + TS strict.** No Node-only packages. No `any`.
- **Env vars** for: `OLLAMA_URL`, `QDRANT_URL`, `OLLAMA_EMBED_MODEL`, `OLLAMA_CLASSIFIER_MODEL`, `OLLAMA_SUMMARIZER_MODEL`. Hard-fail if unset.
- **config.yaml** for operational tunables only (chunk sizes, batch sizes, SQLite path, reconcile schedule, log level, etc.)
- **Package rules:** active maintenance, no CVEs, NO telemetry/phone-home. Non-negotiable.
- **Pinned libs:** `@qdrant/js-client-rest`, `bun:sqlite`, `winston`, `zod`, `yaml` (Eemeli Aro), `mdast-util-from-markdown` + GFM extensions. NOT Hono (out of scope), NOT transformers.js (deferred).

## Key decisions to carry forward when writing SPEC.md

1. **Six Pillars** (not four). Pillars 1-6: Identity, Provenance, Classification, Signals, Context-Injection, Relationships.
2. **Versioning: keep everything unless explicitly deleted.** `chunk_id = sha256(doc_id + version + offsets + schema_version)`. `documents` composite PK `(doc_id, version)`. `sections` composite PK `(section_id, version)`. `is_latest` bool in Qdrant payload, bulk-flipped on new version.
3. **Version resolution:** CLI flag `--version` > frontmatter `version:` > ISO-8601 timestamp fallback.
4. **schema_version policy:** bumps only on breaking changes; additive Pillar additions do NOT bump.
5. **Ollama is remote.** Whitelist for I10 is computed from env vars at startup, no localhost default.
6. **Logger is type-level content-blocked.** Interface forbids a raw-content field by its type signature.
7. **ingestion_errors + reconcile_events tables.** Proper SQL audit trails, not JSON blobs or `last_error` columns.
8. **Heartbeat lock.** `last_heartbeat_at` updated every 30s, stale at 90s. Container-safe.
9. **CLI:** `init`, `ingest`, `status`, `resume`, `reindex`, `purge`, `reconcile`, `re-embed`, `health`. No `dry-run`.
10. **references[]** in v1 = resolved internal doc_ids + section_ids only. Unresolved links go to separate `unresolved_links: string[]`. Entity extraction deferred.
11. **document_title** resolution: frontmatter.title > first H1 > de-kebabed filename.
12. **`bun:sqlite`** as v1 sidecar; multi-backend (PG/MSSQL) via `SidecarStorage` interface is a documented goal, not shipped in v1. Sidecar HA via Litestream deferred, noted in Appendix H.

## What Chat 3 should do (Phase 1 of CONTINUATION_PLAN.md)

1. Read CONTINUATION_PLAN.md, CONSTRAINTS.md (full, not skimmed), AUDIT_FINDINGS.md Round 2 section, SKELETON.md, RESEARCH_BRIEF.md (reference as needed).
2. Create `SPEC.md` with title + placeholder TOC.
3. Acknowledge to Cam in one sentence: "Files received, starting Part I." No meta-commentary.
4. Write Parts I → Part II (Part II is the checkpoint per CONTINUATION_PLAN).
5. Checkpoint with Cam after Part II before continuing.

## What NOT to do

- Do not re-audit. Round 2 is done; resolutions are final.
- Do not re-litigate the Mongo question (rejected, SSPL procurement risk + workload mismatch).
- Do not revisit the Pillar count (Six, done).
- Do not surface "we could" or "TBD" prose — commit.
- Do not include Hono or transformers.js in the ingest spec.

## Tone

Per Cam's user preferences and project memory: relaxed 30-year-old engineer voice, empathetic, direct. Honest pushback welcome. Zero tolerance for over-engineering. Hobby-PACED, production-BAR — do not default to "hobby scale is fine" tradeoffs.
