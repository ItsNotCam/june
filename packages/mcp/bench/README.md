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
5. Judges reader answers with the selected judge — sync `deepseek-v4-pro` (default) or Sonnet via the Anthropic Batch API.
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

- `queries.counts` — per-tier query counts (T1–T5 default 50/50/40/40/70 = 250; hard ceiling 500). T6 (3-hop) and T7 (4-hop) default 0 — only the dedicated deep-hop fixture sets them > 0.
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
june-eval report <run_dir>
june-eval compare <run_dir_a> <run_dir_b> [--force]
june-eval control-pin <run_dir> [--noise-floor <0..1>]
june-eval control-check <run_dir>
june-eval health
```

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

### Per-run config overrides

A caller can override config without editing `config.yaml`:
`--reader-concurrency <n>` and `--baseline`/`--no-baseline` override the
corresponding config values; `--reader-provider`/`--reader-model` and
`--judge-provider`/`--judge-model` swap the reader and judge per run; and
`--ingest-config <path>` supplies a YAML whose ingest tunables (chunk / embedding
/ summarizer / …) are merged into the temp mcp config Stage 4 generates for `june
ingest` (`sidecar.path` stays bench-owned and cannot be overridden). The `/test`
web UI in `packages/next` uses these to apply an operator-edited config to a run.

**Judge selection.** The judge (the gauge) runs as one of two providers:
`deepseek` (the default — sync `deepseek-v4-pro` over concurrent calls; ~7×
cheaper, validated to mirror Sonnet at κ=0.894) or `anthropic-batch` (Sonnet via
the Batch API — keep this as system-of-record for final/published runs). deepseek
has no Batch API, so the sync path has no checkpoint/resume — `--cache` covers
re-runs instead. Both run at `temperature: 0`.

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

**The golden bar.** Pin a control run as a golden baseline
(`june-eval control-pin <run_dir> --noise-floor <pp>`); gate later control runs with
`june-eval control-check <run_dir>` — it fails if any tier's reader-correct% regresses beyond
the noise floor. `golden.json` is a **per-fixture registry** keyed by `fixture_hash`: each
fixture (e.g. the current fixture vs the deep-hop T6/T7 fixture) keeps its own golden, so
pinning one never clobbers another, and `control-check` resolves the golden for the run's own
fixture. Flash deltas are hypotheses; the gemma control run is the verdict (a change that helps
flash but regresses gemma is overfit). Cadence is batched at milestones; track flash-predicted
vs gemma-actual deltas by failure class in `transfer-log.md`. See `CLAUDE.md` (reader-by-purpose)
for the full discipline.

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

### State directory

All bench-local artifacts live under `packages/mcp/bench/state/`:

- `state/runs/<run_id>/` — per-run output (`results.json`, `summary.md`, etc.)
- `state/scratch/<fixture_id>-<run_id>/` — Stage 4 scratch SQLite
- `state/cache/llm/<provider>/<sha256>.json` — LLM response cache (when `--cache` is on)

`rm -rf state/` resets everything. To migrate prior runs from the legacy paths once you're sure nothing in flight points at them:

```bash
mv runs/* state/runs/ && mv bench-scratch/* state/scratch/
```

## Honesty audit

Every measurement choice in this package maps to a specific failure mode in `BENCH_SPEC.md §4`'s L1–L14 table. If a design decision doesn't ladder up to defusing an `L`, it doesn't belong here.
