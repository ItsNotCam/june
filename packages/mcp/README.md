# @june/mcp

June's ingestion pipeline: markdown → enriched, embedded chunks, persisted in Qdrant + SQLite. CLI-driven; one process per invocation.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.2
- [Ollama](https://ollama.com) running somewhere reachable; models pulled: embedder (e.g. `nomic-embed-text`), classifier + summarizer (e.g. `llama3.2:3b`).
- [Qdrant](https://qdrant.tech) running somewhere reachable.

## Environment

Copy `.env.example` → `.env` and fill in:

```bash
OLLAMA_URL=http://localhost:11434
QDRANT_URL=http://localhost:6333
OLLAMA_EMBED_MODEL=nomic-embed-text
OLLAMA_CLASSIFIER_MODEL=llama3.2:3b
OLLAMA_SUMMARIZER_MODEL=llama3.2:3b
# QDRANT_API_KEY=            # optional
# CONFIG_PATH=./config.yaml  # optional; defaults to discovery order (§29.2)
```

All five `OLLAMA_*` / `QDRANT_URL` vars are required — june hard-fails at startup if any is missing (I13).

## Config

Operational tunables (chunk sizes, retry policy, classifier fallbacks, etc.) live in `config.yaml`. Copy `config.example.yaml` → `config.yaml` and edit; or run with `--config <path>`. A fresh install with no `config.yaml` runs on shipped defaults.

## CLI

```bash
june init                                 # create Qdrant collections + apply SQLite DDL
june ingest ./docs                        # ingest a file or directory (recursive)
june status [<doc_id>]                    # read-only run + document status
june resume                               # replay non-terminal documents
june reindex <doc_id>                     # force full re-run for one doc
june purge <doc_id> [--all-versions] --yes
june reconcile [--dry-run] [--purge]      # detect vanished files + Qdrant orphans
june re-embed --embedding-model <name> --yes
june health
june bench <corpus-path>                  # throughput / latency harness (stubbed models)
```

Exit codes follow §27.3: `0` success, `1` fatal, `2` lock held, `3` health failed, `4` user aborted, `64` usage error.

## Architecture

- `src/pipeline/stages/01-discover.ts` … `10-store.ts` — one file per stage.
- `src/lib/{parser,chunker,classifier,summarizer,embedder,storage}/` — swappable backends behind typed interfaces.
- `src/pipeline/ingest.ts` — orchestrator (stages 1 → 10 per doc).
- `src/lib/{env,config,logger,errors,error-types,offline-guard,lock,shutdown,progress,ids,encoding,tokenize,retry}.ts` — shared primitives.
- `cli/*.ts` — thin argv wrappers around the public API in `src/index.ts`.

### Operational surfaces (Part IV)

- `src/lib/error-types.ts` — canonical `error_type` vocabulary (§25.6); `IngestionError.error_type` is narrowed to this union.
- `src/lib/shutdown.ts` — SIGINT/SIGTERM handlers flip a process-level flag; pipeline workers drain at stage boundaries (§24.5 / I8).
- `src/lib/progress.ts` — stderr progress reporter with rolling-average ETA after 5 docs (§27.4). `--quiet` / `--json-log` swap in a silent reporter.
- `resumeRun` accepts an `embedder` to run the §24.6 mismatch check; persists `embedding_model_mismatch_count` on the result without re-embedding automatically.

Full spec: [`.claude/plan/SPEC.md`](../../.claude/plan/SPEC.md) (4300 lines; load-bearing).

## Tests

```bash
bun test
```

Covers §37 invariants: chunker structural invariants, idempotency, encoding normalization, lock/heartbeat, offline whitelist enforcement, typed logger, end-to-end pipeline with stub model backends.

## Running one-off

```bash
bun run cli/june.ts ingest ./some-docs --config ./config.yaml
```

The `june` bin is declared in `package.json`; `bun link` from this directory makes `june` available globally.
