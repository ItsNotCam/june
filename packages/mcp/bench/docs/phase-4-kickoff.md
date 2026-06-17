<!-- author: Claude — self-contained kickoff prompt for RSI-foundation Phase 4 -->
# Phase 4 kickoff — Real-doc holdout (paste this into a fresh context)

> This file IS the prompt. It is self-contained: paths, current state, the task,
> the machinery to reuse, the env, and the open design calls. Read the four
> canonical docs it points to, then build.

---

Continue the **RSI-bench-foundation** work in `@june/mcp-bench`
(`packages/mcp/bench`). We are hardening the bench into a trustworthy *fitness
function* before building any RSI self-improvement loop. Scope is **FOUNDATION
ONLY** — do **not** build the optimizer. **You are now on Phase 4: the real-doc
holdout.**

A hard, standing constraint across this whole initiative: **the bench makes NO
LLM API calls.** Synthetic/judge/authoring work is done by *Claude Code's own
agents* (the Agent tool), out of process — never an API key, never a provider SDK
on the eval path.

## READ FIRST, in this order
1. `packages/mcp/bench/docs/rsi-foundation-status.md` — START HERE (status table,
   what's landed through Phase 3, env/run notes, decisions, file map).
2. `packages/mcp/bench/docs/rsi-foundation-plan.md` — the approved 8-phase plan
   (see "Phase 4 — Real-doc holdout").
3. `packages/mcp/bench/docs/rsi-research-dossier.md` — the deep research backing
   every design call (esp. §5C "Why real-document holdouts matter", Top-15 #7
   "Real Data for Held-Out Evals", #1 strict train/test separation).
4. `packages/mcp/bench/docs/bench-audit-findings.md` — audit reasoning (gap #6:
   100% synthetic/fictional, no real-doc holdout).
Also skim: `packages/mcp/bench/CLAUDE.md` (reader-by-purpose + Goodhart),
`packages/mcp/bench/AUTHORING.md` and `packages/mcp/bench/JUDGE-RUNNER.md` (the
no-API agent seams you'll mirror), and the per-phase diary at
`.claude/diary/rsi-bench-foundation/` (00–04).

## Current state (verify before you start)
- **Branch:** `main` @ **`c6f9cd8`** (== Phases 0–3 merged). Working tree clean.
- **Health:** `cd packages/mcp/bench && bun run typecheck && bun test` →
  `tsc` clean, **186 tests, 0 fail** (1 pre-existing live-judge skip).
- Phases 0–3 are DONE, committed, green. Phase 3 shipped: fixture freezing +
  tamper-lock (`freeze` / `verify-fixture` / `fixture.lock.json`), the **no-API
  agent-authoring seam** (`scaffold` → agents → `assemble`), and the first
  canonical frozen fixture **`fixtures/glorbulon-v1/`** (10 docs, 30 queries
  T1–T5, agent-authored sonnet-corpus/opus-queries, `anti_collusion: true`).
- **There is no `--holdout` flag yet** — Phase 4 builds the holdout path.

## Phase 4 objective
Add a **sealed real-document holdout**: a small real corpus + hand-labeled Q/A
that the (future) RSI loop **never** sees, never pins, never gates on, never
tunes against. Reported **separately** from the synthetic fixtures. The whole
point: **synthetic↔holdout divergence is the reward-hacking alarm** — if a change
lifts the synthetic score but not the real-doc score, it's overfitting the toy
domain (Goodhart). This is RSI safeguard #1 (strict train/test separation) and #7
(real data for held-out evals) from the dossier.

## The source (user-specified)
Use the **Next.js docs `llms-full.txt`**: https://nextjs.org/docs/llms-full.txt
(saved in auto-memory as `bench-phase4-holdout-source`). It is large (the entire
Next.js documentation concatenated). The holdout must be **SMALL** (dossier: 50–200
examples). So:
- Fetch it (WebFetch, or have the user `! curl` it locally — the bench must not
  fetch at eval time; this is a one-time, build-time acquisition).
- Take a **coherent SUBSET** (e.g. one area like App Router routing/caching, or a
  handful of sections) and split it into ~20–50 real documents (by `#`/`##`
  heading boundaries — these are genuine Markdown docs, no synthetic facts).
- Hand-label ~30–60 Q/A. Labeling = the orchestrator's **agents** (no API):
  for each question, record the **expected document(s)** that contain the answer
  (and ideally a short gold answer for the judge). Distinct-model discipline still
  applies where it makes sense.

## The central design decision (call this early)
The existing fixture model is **synthetic-native**: `facts.json` (planted facts
with `surface_hint`s) → `corpus/` (hints embedded verbatim) → `queries.json`
(`expected_fact_ids`) → **Stage 5** resolves `fact_id → chunk_id` by substring →
**Stage 6** scores recall@k/MRR against those chunks. **Real docs have no planted
facts**, so Stage 5's fact→chunk resolution does not apply.

You need a **holdout-native ground-truth path**. Recommended shape (decide and
write it down):
- **Corpus** = the real `.md` files, ingested as-is (Stage 4 already hashes +
  ingests arbitrary markdown — `corpus_manifest.json` just needs per-doc
  `content_hash` + paths; there are no `planted_fact_ids`).
- **Ground truth** = hand-labeled **per-query expected document(s)** (filename →
  `doc_id` via `juneDocId`), NOT synthetic facts. Score recall@k as "a chunk from
  an expected doc appears in top-k" (doc-level relevance), bypassing Stage 5.
- **`run --holdout <fixtures/holdout-real>`**: a distinct path that skips
  fact-resolution, scores doc-level retrieval, and runs the reader + the SAME
  external judge agents for answer-correctness — but writes a **separate**
  `holdout_results.json` / summary, and is **excluded from `control-pin` /
  `control-check` / the golden** by construction (a holdout can never be a golden).
- **Freeze it** with the Phase-3 lock machinery (`fixtures/holdout-real/` +
  `fixture.lock.json`); it's immutable + hash-verified like any frozen fixture.

## ⚠️ Real-doc caveat you MUST handle (it's a validity trap)
The reader (local **gemma4:26b**, the control reader — do NOT move it off
local/BYO) and the judge agents were **trained on real Next.js docs** — they have
**parametric knowledge** of the answers. So "reader correct%" on this holdout can
be satisfied from memory, not retrieval. Therefore:
- Lead with **retrieval metrics** (recall@k/MRR over the labeled expected docs) —
  those are not contaminated by parametric memory.
- Treat reader-correct% as secondary on the holdout, and consider a no-RAG
  baseline delta (RAG vs no-RAG) as the honest reader signal. Document this loudly
  in the holdout summary (an L-caveat, like the synthetic summary's L7).

## Reuse surface (don't rebuild)
- **Freeze/verify:** `src/lib/fixture-lock.ts` — `buildFixtureLock`,
  `verifyFixtureLock`, `assertFrozenFixtureIntact`, `computeFixtureHash`,
  `FIXTURE_LOCK_FILENAME`, `FixtureLockSchema`, `readFixtureArtifacts`,
  `hashFixtureFiles`. CLI: `cli/freeze.ts` (`freeze` / `verify-fixture`).
- **No-API agent seam pattern:** `src/lib/authoring.ts` + `cli/author.ts`
  (`scaffold`/`assemble`) and `AUTHORING.md` — mirror this shape for labeling
  (emit a labeling plan → agents label → validate/assemble → freeze).
- **Run pipeline:** `cli/run.ts` (Stages 4–9), `src/stages/04-ingest.ts`
  (ingests arbitrary markdown; already hash-verifies corpus bytes),
  `src/stages/06-retrieval.ts` (recall@k/MRR), `src/stages/08-judge.ts`
  (`buildJudgeTasks` — emits `judge_tasks.json`; the external Sonnet-agent judge),
  `src/stages/09-score.ts` (`rescoreWithVerdicts`). Judge protocol: `JUDGE-RUNNER.md`.
- **Stats:** `src/lib/bootstrap.ts` (`computeBootstrapCi`), `src/lib/variance.ts`,
  `src/lib/concurrency.ts` (`mapConcurrent`).
- **Types:** `src/types/corpus.ts`, `src/types/query.ts`, `src/types/results.ts`,
  `src/types/ground-truth.ts`. **CLI plumbing:** `cli/shared.ts`
  (`parseArgv`/`flagString`/`flagBool`/`bootstrap`), register new subcommands in
  `cli/bench.ts`.

## Decisions locked (honor unless the user says otherwise)
1. **Foundation only** — design the loop's seams; don't build the optimizer.
2. **Reader stays local/BYO** (gemma4:26b is the control reader / "expected
   results"). Only the **judge** and any **labeling/validation** use Claude Code
   agents. Do NOT move the reader onto Sonnet/Claude without explicit confirmation.
3. **No API anywhere** — agents do all LLM work; the bench calls no provider.
4. **Holdout is sealed:** reported separately, **never** pinned/gated/tuned. A
   holdout fixture must be structurally incapable of becoming a golden.

## Environment / how to run (WSL, native bash)
- `bun`: if not found, `export PATH="$HOME/.bun/bin:$PATH"`.
- Check: `cd packages/mcp/bench && bun run typecheck && bun test`.
- `config.yaml` is **gitignored** (the user has it locally); schema defaults are
  in `src/schemas/config.ts`. For hermetic CLI-runner tests, pass `--config` from
  `__test__/helpers.ts`'s `writeTestConfig()`.
- Committed fixtures live in `packages/mcp/bench/fixtures/` (un-gitignored in
  Phase 3); `state/` is local scratch (gitignored).
- The live run (ingest into Qdrant + gemma reader via Ollama) needs the user's
  stack — **you build the command + holdout-native scoring + tests; the user runs
  the live holdout.** (Same split as Phases 2–3.)

## Conventions (mandatory)
- You're on `main` — **create a branch first** (e.g. `rsi-phase-4-holdout`).
  Conventional-commit prefix (`(feat)`/`(docs)`/`(chore)`/…). **No
  `Co-authored-by` trailers.**
- After a verified+committed phase: update the touched package's **README**, write
  a **diary** entry at `.claude/diary/rsi-bench-foundation/05-phase4-holdout.md`
  (cite prev→new commit hashes), and write an **engineering-log** entry to the
  Obsidian vault via the `obsidian-notes` MCP
  (`engineering-log/rsi-bench-foundation/`, `sequence: 5`) — see the
  `engineering-log` skill. Update `docs/rsi-foundation-status.md` (mark Phase 4
  done, point at Phase 5).
- Follow the reader-by-purpose discipline in `packages/mcp/bench/CLAUDE.md`.

## Deliverables / definition of done
- A holdout-native build path: acquire+split Next.js docs → agents label expected
  docs (+ gold answers) → validate/assemble → `freeze` as `fixtures/holdout-real/`.
- `run --holdout` (or `run-holdout`): doc-level recall@k/MRR + reader/judge, a
  **separate** report, structurally **excluded from the golden/gate**.
- The parametric-knowledge caveat surfaced in the holdout summary.
- Tests: holdout ground-truth (doc-level recall) scoring; the "holdout can't be
  pinned/gated" guard; freeze/verify of the holdout; label-assembly validation.
- `tsc` clean, full suite green, README + diary + eng-log + status updated.

## Next after Phase 4
Phase 5 (judge calibration gate — Cohen's κ ≥ 0.7 via `validate-judge`),
Phase 6 (property/metamorphic tests + the RRF tie-break fix — which the Phase-2
`measure-noise-floor` determinism assertion is built to expose), Phase 7 (meta-
tests, CI, the "RSI-readiness contract").
