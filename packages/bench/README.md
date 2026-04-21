# @june/bench (`june-eval`)

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
5. Judges reader answers via the Anthropic Batch API (always Batch, never sync).
6. Aggregates into per-tier + overall metrics with bootstrap CIs, emits `results.json` + `summary.md`.

Optional sibling pass: no-RAG Opus baseline for the headline "does RAG beat Opus" answer.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.2
- [Ollama](https://ollama.com) reachable at `OLLAMA_URL`; embedder model matching june's ingest model; reader model if role 3 is ollama (default `qwen2.5:14b`).
- [Qdrant](https://qdrant.tech) **bench-dedicated** instance at `QDRANT_URL` — never the operator's real Qdrant (mcp hardcodes the `internal`/`external` alias names, so store isolation happens at the instance boundary, not a collection-name boundary).
- `june` CLI on `PATH` (or set `JUNE_BIN`). The bench shells out to `june ingest` during Stage 4.
- Anthropic API key (judge is always Anthropic Batch). OpenAI key optional, required only when a role is configured for openai.

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

- `queries.counts` — per-tier query counts (default 50/50/40/40/70 = 250; hard ceiling 500).
- `anti_leakage.threshold` — token-overlap floor (default 0.40).
- `resolution.{max_unresolved_pct, max_embedding_pct}` — integrity thresholds (2% / 20%).
- `judge.max_unjudged_pct` — aborts run if more than 5% of reader answers cannot be judged.
- `cost.max_budget_usd` — hard cap (default $5.00); aborts mid-run if exceeded.
- `baseline.no_rag_opus` — when true, runs a sibling reader pass for the headline comparison.

## CLI

```bash
june-eval generate [--seed <n>] [--domain <name>] [--out <dir>]
june-eval run <fixture_dir> [--out <dir>] [--resume] [--yes]
june-eval report <run_dir>
june-eval compare <run_dir_a> <run_dir_b> [--force]
june-eval health
```

### Exit codes

`0` success. `1` fatal / config error. `2` run-dir lock contention. `3` integrity violation (resolution thresholds, unjudged cap, budget cap). `4` operator aborted at a confirmation prompt. `64` usage error.

Codes `0`/`1`/`2`/`64` match mcp's CLI; `3` and `4` are bench-specific per §28.

## Architecture

```
packages/bench/
├── cli/                       Subcommand routers (argv is handwritten; no commander/yargs).
├── src/
│   ├── stages/01–09.ts        One file per stage; pure functions that write one artifact each.
│   ├── providers/             Ollama, Anthropic, OpenAI, Anthropic Batch.
│   ├── retriever/             Pluggable — stopgap (Qdrant+SQLite direct) for v1.
│   ├── judge/                 Pluggable — Anthropic Batch LLM judge for v1.
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

## Honesty audit

Every measurement choice in this package maps to a specific failure mode in `BENCH_SPEC.md §4`'s L1–L14 table. If a design decision doesn't ladder up to defusing an `L`, it doesn't belong here.
