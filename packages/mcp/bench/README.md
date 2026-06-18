# @june/mcp-bench (`june-eval`)

Synthetic-corpus RAG-quality benchmark for june. A standalone measurement tool that sits beside june (not inside it), drives the ingestion pipeline end-to-end on a fictional synthetic corpus, and emits retrieval + reader quality numbers with 95% bootstrap confidence intervals.

The spec is [`.claude/plans/ingestion-pipeline-benchmark-v1/BENCH_SPEC.md`](../../.claude/plans/ingestion-pipeline-benchmark-v1/BENCH_SPEC.md) (2508 lines; load-bearing).

#### AI Disclosure:
Benchmarking tool written entirely by Claude after 3 hours of planning and spec development.

## What it does

Given a fictional-domain fixture (facts + corpus + queries), the bench:

1. Ingests the corpus through `june ingest` (isolated config + dedicated Qdrant).
2. Resolves every planted fact to an ingested chunk (two-tier: substring, then doc-scoped embedding).
3. Evaluates retrieval: Recall@{1,3,5,10} and MRR per query, dispatched on tier.
4. Evaluates the reader: feeds top-K chunks + the question to the SUT model.
5. **Externalizes judging (no API calls, default).** Emits a self-contained `judge_tasks.json` and halts at `awaiting_verdicts` — the Claude Code RSI orchestrator's Sonnet agents grade the tasks and write `verdicts.json` (see [`JUDGE-RUNNER.md`](JUDGE-RUNNER.md)); `june-eval score` then finalizes. Legacy in-bench judges (sync `deepseek-v4-pro` or Sonnet via the Anthropic Batch API) stay selectable with `--judge-provider`.
6. Aggregates into per-tier + overall metrics with bootstrap CIs, emits `results.json` + `summary.md`.

Optional sibling pass: no-RAG Opus baseline for the headline "does RAG beat Opus" answer.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.2
- [Ollama](https://ollama.com) reachable at `OLLAMA_URL`; embedder model matching june's ingest model; reader model if role 3 is ollama (default `qwen2.5:14b`).
- [Qdrant](https://qdrant.tech) **bench-dedicated** instance at `QDRANT_URL` — never the operator's real Qdrant (mcp hardcodes the `internal`/`external` alias names, so store isolation happens at the instance boundary, not a collection-name boundary).
- `june` CLI on `PATH` (or set `JUNE_BIN`). The bench shells out to `june ingest` during Stage 4.
- Anthropic API key (required — used for the no-RAG baseline and the `anthropic-batch` judge). DeepSeek API key required when the judge or another role uses deepseek (the default judge is sync `deepseek-v4-pro`). OpenAI key optional, required only when a role is configured for openai.

## Environment

Copy `.env.example` → `.env` and fill in:

```bash
ANTHROPIC_API_KEY=sk-ant-...
OLLAMA_URL=http://localhost:11434
QDRANT_URL=http://localhost:6334        # dedicated; NOT the operator's real Qdrant
JUNE_BIN=june
CONFIG_PATH=./config.yaml
# OPENAI_API_KEY=sk-...                 # required if any role uses openai
# QDRANT_API_KEY=...                    # deployed clusters
# LOG_LEVEL=info
# BENCH_SCRATCH_ROOT=/tmp/bench
```

Hard-fail at startup if any required var is unset (§29.1 / I13).

## Config

Operational tunables live in `config.yaml`. Copy `config.example.yaml` → `config.yaml` and edit; or pass `--config <path>`. A fresh install with no `config.yaml` runs on shipped defaults.

Notable tunables:

- `queries.counts` — per-tier query counts (T1–T5 default 50/50/40/40/70 = 250; hard ceiling 500). T6 (3-hop) and T7 (4-hop) default 0. The no-API `scaffold --counts T1,..,T7` / `assemble` path now authors all seven tiers (frozen `fixtures/glorbulon-v2/` is the canonical 7-tier fixture — Sonnet corpus / Opus queries, anti-collusion clean); `fixtures/glorbulon-v1/` remains the 5-tier baseline.
- `anti_leakage.threshold` — token-overlap floor (default 0.40).
- `resolution.{max_unresolved_pct, max_embedding_pct}` — integrity thresholds (2% / 20%).
- `judge.max_unjudged_pct` — aborts run if more than 5% of reader answers cannot be judged.
- `cost.max_budget_usd` — hard cap (default $5.00); aborts mid-run if exceeded.
- `baseline.no_rag_opus` — when true, runs a sibling reader pass for the headline comparison.
- `retrieval.multi_hop` — optional "anchored bridge injection" decorator for multi-hop queries (T4/T6/T7; LLM planner; see `src/retriever/multi-hop.ts`). The planner decomposes a question into a linear chain of hops; the retriever resolves each bridge entity in sequence (the first from the base reader window, each next from the prior hop's own sub-retrieval), captures every intermediate relational chunk, and injects those + the atomic chunk into the reader window without demoting the base head. A 2-hop (T4) call is byte-identical to the original single-bridge behavior (the N=2 parity invariant). Diagnose misses with `scripts/triage-multihop.ts <run_dir> <fixture_dir> [debug_log]`.
- `retrieval.rerank` — optional second-pass cross-encoder reranker (`src/retriever/reranker.ts`). Fetches a deep candidate pool (`pool_k`, must be ≥ `max(k_values)`), rescores each candidate against the query with a local cross-encoder (`scorer.kind: cross-encoder`, `scorer.model` e.g. `Xenova/bge-reranker-base`), and returns the top-k by relevance. Order-only — it refines ranking (recall@1 / MRR) without changing which chunks the inner retriever found. `scorer.kind` is the swappable backend seam (a hosted/LLM scorer can be added later).

## CLI

```bash
june-eval generate [--seed <n>] [--domain <name>] [--out <dir>]
june-eval run <fixture_dir> (--mode iterate | --mode control |
                             --reader-provider <p> --reader-model <m>)
                            [--out <dir>]
                            [--resume | --skip-ingest <run_id> |
                             --from <run_id> --rerun-from <stage>]
                            [--quick | --sample <ratio>] [--cache] [--yes]
                            [--quiet] [--log-json] [--progress-ndjson]
                            [--ingest-config <path>] [--reader-concurrency <n>]
                            [--baseline | --no-baseline]
june-eval score <run_dir> --verdicts <verdicts.json>
june-eval report <run_dir>
june-eval compare <run_dir_a> <run_dir_b> [--force]
june-eval measure-noise-floor <run_dir...> [--out <path>] [--epsilon <n>]
june-eval measure-consistency <run_dir> <verdicts.json...> [--out <path>]
june-eval control-pin <run_dir> [--noise-floor-file <path>] [--accept-floor <0..1>]
june-eval control-check <run_dir>
june-eval freeze <fixture_dir> --name <name> [--signoff <who>] [--allow-collusion] [--force]
june-eval verify-fixture <fixture_dir>
june-eval holdout-split <source.txt> [--url-prefix <p>] [--max-docs <n>] [--out <dir>]
june-eval holdout-assemble <split_dir> --labels <file> --label-model <m> [--out <dir>]
june-eval freeze-holdout <holdout_dir> --name <name> [--signoff <who>] [--force]
june-eval verify-holdout <holdout_dir>
june-eval run-holdout <holdout_dir> --mode control [--no-baseline] [--out <dir>]
june-eval score-holdout <run_dir> --verdicts <verdicts.json>
june-eval validate-judge emit   [--gold <path>] [--out <tasks.json>]
june-eval validate-judge score  <verdicts.json> [--min-kappa <0..1>] [--gold <path>]
june-eval validate-judge status [--judge-model <m>]
june-eval health
june-eval dashboard [--port <n>] [--host <h>] [--runs <dir>] [--golden <file>]
```

### Frozen fixtures (immutable, hash-locked test sets)

A fixture (corpus + queries) is **LLM-authored and non-deterministic** — so to
stop input drift from masquerading as a quality change, the canonical test sets
are **frozen**: committed under `fixtures/<name>/` with a `fixture.lock.json` that
records the canonical fixture hash, a per-file SHA-256 manifest, and the authoring
provenance. `run` calls `assertFrozenFixtureIntact` before ingest, so a frozen
fixture that drifted from its lock fails the run (`FixtureTamperedError`); re-check
any time with `verify-fixture`. `freeze` **refuses a colluded fixture** — corpus
and queries authored by the *same* model — unless `--allow-collusion`, because a
single author lets queries lexically echo the corpus and inflates recall. The
canonical fixtures are authored with **no API calls**: Claude Code's own agents
write them (sonnet for the corpus, opus for the queries — distinct models restore
anti-collusion). Ground-truth resolution is deterministic (tier-1 substring is
order-independent with an earliest-chunk_index tie-break; tier-2 embedding is
deterministic given the pinned ingest), so a frozen fixture + pinned ingest yield
a reproducible ground truth.

### Sealed real-doc holdout (the reward-hacking alarm)

The synthetic fixtures are a *fictional* domain — they catch gross regressions but
are blind to real-doc idioms (L7). The **holdout** is a small slice of REAL docs
(committed `fixtures/holdout-real/` — 19 Next.js App Router "getting-started" docs,
40 hand-labeled Q/A) scored at the **document level**: recall@k = "a chunk from a
labeled expected document is in top-k" (no synthetic facts, no Stage-5 resolution).
It is **sealed** — reported separately, and structurally incapable of becoming a
golden: a holdout run writes `holdout_results.json` (`kind: "holdout"`), never the
`results.json` that `control-pin`/`control-check` consume (which also refuse a
holdout run-dir outright). The point is **synthetic↔holdout divergence**: a change
that lifts the synthetic score but not the real-doc score is overfitting the toy
domain (Goodhart). Build path (no API — agents do the labeling): `holdout-split`
(slice a real `llms-full.txt` on its frontmatter boundaries + emit a labeling plan)
→ agents label expected docs + gold answers → `holdout-assemble` (validates) →
`freeze-holdout` (locks it). Run path: `run-holdout --mode control` (doc-level
retrieval + the local reader + a no-RAG same-reader baseline) → agents judge →
`score-holdout`. **Validity caveat:** the reader (gemma) and judge agents have
**parametric knowledge** of real Next.js docs, so reader-correct% can come from
memory — **lead with the retrieval metrics** (immune to that) and read the
RAG−noRAG delta as the honest reader signal. Full protocol: `HOLDOUT.md`.

### Judge calibration (Cohen's κ licenses the judge)

The correctness judge is an LLM run by Claude Code agents (no API). It may only
certify a `control` run once it has been shown to agree with **human labels** beyond
chance: `validate-judge` scores agent verdicts against a committed human-labeled gold
set (`__test__/judge/fixtures/calibration-gold.json` — 40 self-contained cases,
balanced 8-per across CORRECT/PARTIAL/INCORRECT/REFUSED/HALLUCINATED) and computes
**Cohen's κ**. κ subtracts chance agreement, so a judge that always guesses the
majority verdict scores ~0 — it can't be gamed by guessing CORRECT. A passing record
(κ ≥ 0.7, default) keyed by `model + prompt hash` lands in `judge-calibration.json`
and **licenses** that judge; `control-pin` refuses to pin a golden produced by an
unlicensed judge (`assertJudgeCalibrated`), and editing the gold set invalidates the
license (a staleness check). The seam is no-API like the judge runner: `validate-judge
emit` → agents judge blind (JUDGE-RUNNER.md) → `validate-judge score`. The shipped
Sonnet judge scores κ = 1.000 on the (deliberately unambiguous) gold; grow the gold
with harder cases over time. Full protocol: `VALIDATE-JUDGE.md`.

### Progress output

`run` emits a one-line-per-stage `[n/9] … ok (Xs)` summary to **stderr** by default.
`--quiet` suppresses it; `--log-json` routes it through the structured logger.

`--progress-ndjson` additionally streams machine-readable progress as
newline-delimited JSON on **stdout** — one event per line: `run_start`,
`stage_start`, `tick` (per-item for stages 6/7), `poll` (judge batch status),
`stage_end`, `run_complete`. Human logs stay on stderr, so a parent process can
read events off stdout cleanly. This is what the Next `/test` web UI consumes
(see `packages/next`). The schema lives in `src/lib/progress-events.ts`.

```bash
june-eval run <fixture> --quick --cache --yes --progress-ndjson 1>events.ndjson 2>logs.txt
```

Independently of the flag, **every** run also persists the same events to
`<run_dir>/progress.ndjson`. The dashboard (below) tails that file to render live
stage progress without having to launch the run itself.

### Per-run config overrides

A caller can override config without editing `config.yaml`:
`--reader-concurrency <n>` and `--baseline`/`--no-baseline` override the
corresponding config values; `--reader-provider`/`--reader-model` and
`--judge-provider`/`--judge-model` swap the reader and judge per run; and
`--ingest-config <path>` supplies a YAML whose ingest tunables (chunk / embedding
/ summarizer / …) are merged into the temp mcp config Stage 4 generates for `june
ingest` (`sidecar.path` stays bench-owned and cannot be overridden). The `/test`
web UI in `packages/next` uses these to apply an operator-edited config to a run.

**Judge selection.** The judge defaults to **`external`** — **no API calls.** The
bench emits `judge_tasks.json` and halts at `awaiting_verdicts`; the Claude Code
RSI orchestrator's Sonnet agents grade the tasks (each self-contained, with the
retrieved context pre-rendered) and write `verdicts.json`, then `june-eval score
<run_dir> --verdicts <file>` overlays them and finalizes the run. See
[`JUDGE-RUNNER.md`](JUDGE-RUNNER.md). This makes a `--mode control` run fully
local: local Qdrant retrieval + local gemma reader + pure-math scoring, with the
only LLM judgment happening out-of-process under the Claude Code subscription.

The legacy in-bench judges stay selectable with `--judge-provider`: `deepseek`
(sync `deepseek-v4-pro`, validated to mirror Sonnet at κ=0.894) or
`anthropic-batch` (Sonnet via the Batch API — system-of-record for published
runs). Both in-bench paths run at `temperature: 0` and require API keys; the
verdicts' judge identity (model + prompt hash) is recorded so the regression gate
can refuse to compare across judges.

### Reader-by-purpose — flash iterates, gemma4:26b is the bar

june is BYO-AI with a 24GB-VRAM floor; **`gemma4:26b` is the reference reader that defines
"expected results."** It's slow, so iteration uses hosted **`deepseek-v4-flash`**. Every
`run` **must declare intent** (a run with neither flag below hard-errors; a PreToolUse hook
blocks it too):

- `--mode iterate` → reader `deepseek-v4-flash`. **Scratchpad — directional signal ONLY,
  never "expected results."**
- `--mode control` → reader `gemma4:26b` (Ollama @ `OLLAMA_URL`). **The authoritative bar.**
- explicit `--reader-provider/--reader-model` → `freeform` (e.g. a model bake-off). Never a
  baseline. Mutually exclusive with `--mode`.

`--mode` **forces** the reader (you cannot run `control` on the wrong model) — the contract
is committed in `src/lib/modes.ts`, not the gitignored `config.yaml`. Each run is stamped
with its `mode`; `summary.md` banners SCRATCHPAD vs CONTROL; `compare` flags cross-mode diffs.

**The golden bar.** Pin a control run as a golden baseline (`june-eval control-pin
<run_dir>`); gate later control runs with `june-eval control-check <run_dir>` — it fails when
a gated metric (reader-correct%, recall@1/@5, MRR) **confidently** regresses (point drop past
the noise floor AND non-overlapping 95% CI). `golden.json` is a **per-fixture registry** keyed
by `fixture_hash`: each fixture (e.g. the current fixture vs the deep-hop T6/T7 fixture) keeps
its own golden, so pinning one never clobbers another, and `control-check` resolves the golden
for the run's own fixture. Flash deltas are hypotheses; the gemma control run is the verdict (a
change that helps flash but regresses gemma is overfit). Cadence is batched at milestones; track
flash-predicted vs gemma-actual deltas by failure class in `transfer-log.md`. See `CLAUDE.md`
(reader-by-purpose) for the full discipline.

**The measured noise floor (not a guess).** `control-pin`'s floor is **measured**, not typed.
Two commands produce a `noise-floor.json` per fixture:

- `june-eval measure-noise-floor <run_dir...>` — re-run retrieval against ≥2 runs of one
  fixture (ideally sharing one ingest via `--skip-ingest`) and report the recall@k/MRR spread.
  Retrieval is LLM-free, so on a shared ingest the spread **must** be ≈0 — the command
  **asserts** it and fails (exit 3) on any non-zero drift (a real determinism bug). The one
  such bug it was built to expose — an unstable RRF tie-break — was **fixed in Phase 6**:
  `reciprocalRankFusion` now sorts by an explicit `(score desc, chunk_id asc)` total order, so
  equal-score chunks no longer reorder with vector-store arrival order (a cross-package parity
  test keeps the bench + production fusion byte-identical). This is the proof the retrieval
  metrics can be gated tightly. (Stage 6 also records `per_fact_recall_at_k` — the fraction of a
  multi-hop query's expected chunks in top-k — as a partial-composition diagnostic alongside the
  gated all-or-nothing recall.)
- `june-eval measure-consistency <run_dir> <verdicts.json...>` — re-score one run under ≥2
  independent agent re-judges of its tasks and report the reader-correct% spread. The judge is
  the only non-deterministic stage, so this is where the real floor comes from.

`control-pin` consumes the file's conservative `recommended_noise_floor`; a deliberate
`--accept-floor <0..1>` is the only way to pin without a measured file (logged as UNMEASURED).
The live N-run/N-judge execution needs the local stack (Qdrant + Ollama gemma + the
orchestrator's agents); the commands are the pure-aggregation half. See `JUDGE-RUNNER.md`.

### Dashboard (`june-eval dashboard`)

A local web dashboard for reviewing runs over time and watching a run live — so as
the future RSI loop iterates, you can see what's improving. Plain HTML/CSS/JS on a
zero-dependency `Bun.serve` backend (no Next.js, no build step). It is **read-only**:
it reads `state/runs/`, `golden.json`, and per-run `progress.ndjson`; it never
launches or mutates runs.

```bash
june-eval dashboard            # http://localhost:4317
june-eval dashboard --port 8080 --runs ./state/runs --golden ./golden.json
```

What it shows:

- **Trend** of `reader_correct_pct` / `recall@5` / `MRR` across runs, plus a
  **per-tier** view with golden baselines drawn as dashed lines.
- **Live in-flight panel** — stage-by-stage progress (stages 4–9) of a running
  eval, streamed over SSE (tails `progress.ndjson`; falls back to artifact-presence
  inference for holdout runs, which have no progress reporter).
- **Runs table** + per-run drill-down (per-tier point ± 95% CI, integrity, manifest,
  `summary.md`); holdout runs render a retrieval-led panel.
- **Golden gate** — pinned baseline per fixture and a pass/fail of the latest control
  run, plus a synthetic↔holdout divergence flag.

Guardrails it enforces (from the RSI-readiness contract): control & iterate are never
plotted on the same line (mode filter, control by default), metrics are grouped by
`fixture_hash`, and a cross-judge mismatch is flagged. The data layer
(`src/dashboard/reader.ts`) normalizes both the on-disk **v1** golden (flat
`per_tier_correct`) and the newer **v2** schema.

### Exit codes

`0` success. `1` fatal / config error. `2` run-dir lock contention. `3` integrity violation (resolution thresholds, unjudged cap, budget cap). `4` operator aborted at a confirmation prompt. `64` usage error.

Codes `0`/`1`/`2`/`64` match mcp's CLI; `3` and `4` are bench-specific per §28.

## Architecture

```
packages/mcp/bench/
├── cli/                       Subcommand routers (argv is handwritten; no commander/yargs).
├── src/
│   ├── stages/01–09.ts        One file per stage; pure functions that write one artifact each.
│   ├── providers/             Ollama, Anthropic, OpenAI, DeepSeek, Anthropic Batch.
│   ├── retriever/             Pluggable — stopgap (Qdrant+SQLite direct) for v1, with optional multi-hop + reranker decorators.
│   ├── judge/                 Pluggable — Anthropic Batch judge + sync deepseek judge.
│   ├── domains/               Synthetic-fact templates (Glorbulon Protocol in v1).
│   ├── lib/                   env, config, logger, rng, tokens, bootstrap, cost, artifacts, prompts.
│   ├── types/                 facts, query, verdict, results.
│   └── schemas/               Zod at LLM-output and config boundaries only.
├── prompts/*.md               One file per role; {{var}} templated at call time.
└── test/                      bun test; mocked providers for LLM stages, golden-output for deterministic ones.
```

## Tests

```bash
bun test
```

Covers §40: invariant tests (I-EVAL-1 through I-EVAL-6), tier-dispatched scoring, bootstrap CI shape, UNJUDGED cap, budget cap, fact-generation determinism.

## Running

```bash
# 1. Generate a fixture (facts + corpus + queries). One-time per fixture.
bun run cli/bench.ts generate --seed 42 --out ./fixtures/

# 2. Run a bench against the fixture. Repeatable; each run has its own <run_id>.
bun run cli/bench.ts run ./fixtures/<fixture_id>/ --out ./runs/

# 3. Inspect.
cat ./runs/<run_id>/summary.md

# 4. Compare two runs (e.g. before/after a pipeline change).
bun run cli/bench.ts compare ./runs/<run_a>/ ./runs/<run_b>/
```

`bun link` from this directory makes `june-eval` available globally.

## Iteration tooling

A full bench run is ~50 min and ~$0.20. The flags below trade safety for speed when iterating on retriever/reader/scorer tweaks. They're orthogonal — combine them.

| Flag | What it skips | Reuse safety |
|---|---|---|
| `--resume` | Stages already completed in this run-dir | Same run-dir only; no fixture/config drift possible |
| `--skip-ingest <run_id>` | Stage 4 (ingest) | Validates prior scratch SQLite + Qdrant collections still exist; aborts on fixture mismatch |
| `--from <run_id> --rerun-from <stage>` | Stages strictly below `<stage>` | Copies prior artifacts; same ingest validation as `--skip-ingest` when reused |
| `--quick` / `--sample <ratio>` | Most queries — runs a deterministic per-tier subset | Same fixture + same ratio = same subset; CIs widen, do NOT compare to full-fixture numbers |
| `--cache` | API calls whose inputs match a prior cache entry | Cache key covers `(provider, model, system, messages, max_tokens, temperature, response_format, disable_thinking)`; hits report `cost_usd: 0` |

`--rerun-from` accepts either named (`ingest|resolve|retrieve|reader|judge|score`) or numeric (`4|5|6|7|8|9`) values. `--from` and `--rerun-from` are paired — both required together. `--from` is mutually exclusive with `--resume` and `--skip-ingest`.

### Common iteration loops

```bash
# Smoke pass: 10% of queries, reuse prior ingest, response cache on.
june-eval run <fixture> --quick --skip-ingest <prior-run-id> --cache --yes

# Reader iteration: keep stages 4-6 from a known-good run, re-run reader+judge+score.
june-eval run <fixture> --from <prior-run-id> --rerun-from reader --yes

# Scoring tweak only: reuse all of 4-8, just re-run Stage 9. Completes in <1s.
june-eval run <fixture> --from <prior-run-id> --rerun-from score --yes
```

### Diagnostic scripts (`scripts/`)

Standalone, read-only diagnostics that sit beside the pipeline — run with `bun scripts/<name>.ts`.

- `judge-screen.ts` — **judge-agreement screen.** Re-judges a completed run's reader answers with a *second* model using the exact production judge prompt + parser, then compares verdict-for-verdict against the Sonnet verdicts already on disk (overall agreement, Cohen's κ, confusion matrix, the T4 CORRECT/PARTIAL boundary, disagreement dump). Makes zero Anthropic calls (reuses on-disk verdicts), opens SQLite read-only, writes only to `/tmp`. Run/fixture/model are consts at the top of the file. Use it to vet a cheaper judge before trusting it.

### In-session query authors (`scripts/author-*.ts`)

One-off, **fixture-mutating** scripts (not diagnostics). When the Anthropic Sonnet `query_author` is unavailable, deterministic question tiers can be authored against an existing corpus/ingest without it — the facts already exist, only the question *text* is missing. Each script carries the authoritative `(tier, fact_ids, text)` records, validates chain integrity + anti-leakage + dedup, and **appends** to a fixture's gitignored `queries.json`. Evaluate with `--skip-ingest` (no re-ingest, no Anthropic). The committed script is the record of the questions, since the fixture itself is gitignored.

- `author-t7-queries.ts <fixture_dir>` — the original 15 four-hop (T7) questions.
- `author-double-queries.ts <fixture_dir>` — doubles every tier of the deep-hop fixture (+80: T1–T7 → 10/10/10/30/10/60/30 = 160 questions). gemma-certified; golden pinned on the 160-question fixture. The questions are Opus-authored (a mild authorship difference vs the Sonnet-authored originals); a full Sonnet regenerate supersedes them once credits return.

### State directory

All bench-local artifacts live under `packages/mcp/bench/state/`:

- `state/runs/<run_id>/` — per-run output (`results.json`, `summary.md`, etc.)
- `state/scratch/<fixture_id>-<run_id>/` — Stage 4 scratch SQLite
- `state/cache/llm/<provider>/<sha256>.json` — LLM response cache (when `--cache` is on)

`rm -rf state/` resets everything. To migrate prior runs from the legacy paths once you're sure nothing in flight points at them:

```bash
mv runs/* state/runs/ && mv bench-scratch/* state/scratch/
```

## RSI-readiness — the gauge as a fitness function

This bench was hardened (RSI-foundation Phases 0–7) into a **trustworthy fitness function**: a
gauge an automated self-improvement loop can optimize *against* without gaming it. The full
list of guarantees — no-API eval path, deterministic ingest/retrieval, frozen hash-locked
fixtures, the statistical regression gate, the sealed real-doc holdout, the κ-licensed judge,
the BYO-local reader — with the seam each rests on and how CI verifies it, is the
**[RSI-readiness contract](docs/rsi-readiness-contract.md)**. Read it before building anything
that consumes these numbers programmatically.

**The load-bearing caveat (L7):** a green synthetic number is *"no regression detected,"* never
*"the product is good."* The fixture is fictional facts in a narrow question style — a higher
score on it can mean a worse product (Goodhart). The sealed holdout (`fixtures/holdout-real/`)
is the alarm for synthetic↔real divergence, but it is small and parametric-memory-contaminated
(lead with its retrieval metrics). Never read a synthetic % as a real-doc quality claim.

**CI.** [`.github/workflows/bench-ci.yml`](../../../.github/workflows/bench-ci.yml) runs the
hermetic hot path on every change to bench/ingest/shared: typecheck + unit + property +
the hermetic end-to-end test (`__test__/e2e/` — full pipeline over a fake retriever, no Qdrant/
Ollama/API) + the agent-free judge-calibration κ gate. Live `control` + holdout passes need the
BYO gemma + Qdrant stack and are kept off the hot path.

## Honesty audit

Every measurement choice in this package maps to a specific failure mode in `BENCH_SPEC.md §4`'s L1–L14 table. If a design decision doesn't ladder up to defusing an `L`, it doesn't belong here.
