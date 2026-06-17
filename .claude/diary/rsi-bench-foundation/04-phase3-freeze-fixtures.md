<!-- author: Claude -->
# RSI-Foundation · Phase 3 — Freeze fixtures + no-API agent authoring

**Commits:** `4274de1` → `88f5621`  ·  **Branch:** `rsi-phase-3-freeze-fixtures`
(`73ac3f9` backbone → `ae64b66` authoring seam → `88f5621` the glorbulon-v1 fixture)

## Summary
Turned the bench's LLM-authored inputs (corpus + queries) into an **immutable, hash-locked,
anti-collusion-clean** artifact, and — per the user's directive — made fixture authoring itself
**API-free**: Claude Code's own agents write fixtures (sonnet corpus / opus queries), the bench
emits a deterministic plan and validates the result. Shipped the first canonical frozen fixture,
`fixtures/glorbulon-v1/` (10 documents, 30 queries across T1–T5, `anti_collusion: true`). This
closes audit gaps #5 (non-deterministic inputs / no pinned fixture), #7 (anti-collusion — corpus
and queries were both sonnet), and part of #8 (validity-critical paths untested).

## High-level (plain English)
A fixture is the bench's exam: a fake knowledge base (the **corpus**) plus the questions asked
against it (the **queries**). Both are written by an LLM, so they drift — and an RSI loop can't
tell a real quality change from the exam quietly changing underneath it. Phase 3 fixes that two ways.

**Freeze.** A `freeze` command copies a fixture into the committed `fixtures/<name>/` directory and
writes a `fixture.lock.json` — the canonical fixture hash, a per-file SHA-256 manifest, and the
authoring provenance. From then on the fixture is immutable: `run` verifies the lock before ingest
and refuses a drifted fixture (`FixtureTamperedError`), and `verify-fixture` re-checks on demand.
`freeze` also **refuses a colluded fixture** — corpus and queries written by the *same* model — because
one author lets the questions echo the documents' wording and inflates retrieval scores.

**No-API authoring.** Every local fixture was sonnet+sonnet (colluded). The user's call: don't call
any API and don't commit a rigged fixture — have Claude Code's agents author a clean one, sonnet for
the corpus and opus for the queries. So authoring became an externalized seam (the same shape as the
Phase-0 judge): the bench runs the deterministic half (Stage-1 seeded facts, then a plan that says
which facts each document must plant and which fact each question targets), the agents write the
prose, and `assemble` validates it — every planted fact's sentence must appear verbatim (so ground
truth resolves) and every paraphrase/scenario/multi-hop question must stay under the anti-leakage
threshold. I ran it end to end: 10 sonnet agents wrote the documents, 5 opus agents wrote the
questions; two T4 multi-hop questions leaked and were re-authored; `assemble` then passed and `freeze`
locked it (`anti_collusion: true`, max Jaccard 0.375 < 0.40).

## Steps performed
- **`src/lib/fixture-lock.ts`** (new): `FixtureLock` schema; `computeFixtureHash` moved here (run.ts
  imports it — one definition); `buildFixtureLock` / `verifyFixtureLock`; `assertFrozenFixtureIntact`
  (run-time guard, no-op on non-frozen dirs). `FixtureTamperedError` added to `errors.ts`.
- **`cli/freeze.ts`** (new): `freeze` (copy + lock; collusion + overwrite + name guards; rewrites
  corpus `absolute_path` to the frozen location) and `verify-fixture`.
- **`cli/run.ts`**: calls `assertFrozenFixtureIntact` before loading a fixture; dropped the local
  `computeFixtureHash`.
- **`src/lib/authoring.ts`** (new): `buildAuthoringPlan` (deterministic — reuses `groupFactsIntoDocuments`,
  `buildFactChains`, a seeded rng) + `assembleCorpus` / `assembleQueries` (the validity gate).
- **`cli/author.ts`** (new): `scaffold` (Stage 1 + plan, no API) and `assemble` (validate drafts →
  fixture; `--corpus-model` ≠ `--query-model`). **`AUTHORING.md`**: the agent protocol.
- **`src/stages/05-resolve.ts`**: exported `resolveTier1`; first Stage-5 determinism tests
  (order-independent, earliest-chunk_index tie-break).
- **`.gitignore`**: un-ignored `packages/mcp/bench/fixtures/`.
- **The fixture**: `scaffold glorbulon-protocol --seed 31337` → 10 docs / 30 specs; agents authored;
  `assemble` (all hints verbatim; anti-leakage ok) → `freeze --name glorbulon-v1`. Committed
  `fixtures/glorbulon-v1/` (13 files, fixture_hash `dd68e4e2…`).
- **Tests** (+38, 148→186): fixture-lock build/verify + tamper detection; freeze guards;
  resolveTier1 determinism; anti-leakage Jaccard; authoring plan determinism + assemble accept/reject.
- **Verified**: `tsc --noEmit` clean; full suite green (**186 pass, 1 pre-existing skip, 0 fail**).
  Merged to `main`.

## Action items / next steps
- **Phase 4 (next) — real-doc holdout.** Source is the **Next.js `llms-full.txt`**
  (https://nextjs.org/docs/llms-full.txt, user-specified). Fetch → split into real documents →
  hand-label a small Q/A set → seal as `fixtures/holdout-real/` (run `--holdout`, reported separately,
  **never pinned/gated/tuned**). Reuse the freeze/verify lock machinery; honor no-API for any labeling
  agents. Synthetic↔holdout divergence is the reward-hacking alarm.
- **Pin a golden** off a real `--mode control` run on `glorbulon-v1` once the live stack is up
  (needs the Phase-2 measured noise floor first).
- Scaling: `glorbulon-v1` is T1–T5 at 6/tier. Deep multi-hop (T6/T7) and larger counts can be a
  follow-up frozen fixture via the same seam (`--counts`), authored the same no-API way.
- Portability watch-out: `freeze` writes absolute corpus paths into the frozen manifest (fine on this
  machine; a future tweak could resolve corpus relative to the fixture dir for cross-checkout runs).
