<!-- author: Claude -->
# packages/next

Next.js 16 frontend for the june monorepo.

## Stack

- **Next.js 16.2.4** with App Router, React 19, TypeScript strict
- **Tailwind v4** with shadcn/ui (Tailwind v4 compatible)
- **Bun** runtime — use `bun dev`, not `npm`/`node`

## Running

```bash
cd packages/next
bun dev
```

Opens at [http://localhost:3000](http://localhost:3000).

## Structure

```
app/
  layout.tsx          ← Root layout with ThemeProvider and Geist fonts
  globals.css         ← Tailwind v4 theme tokens
  typography.ts       ← Typography scale constants
  preview/
    page.tsx          ← Component/design preview page
  ingest/
    page.tsx          ← Markdown ingestion UI (server shell)
    _components/       ← IngestClient, UploadDropzone, IngestTable, WipeDialog
  api/
    ingest/route.ts            ← POST: stage uploads, stream pipeline progress (NDJSON)
    documents/route.ts         ← GET: list ingested documents
    documents/purge/route.ts   ← POST: wipe a document (embeddings + sidecar + staged file)
components/
  ui/                 ← shadcn Button / Card / Badge / Chart
  theme/              ← next-themes provider + toggle
lib/
  ui/utils.ts         ← shadcn cn() helper
  ingest-events.ts    ← Isomorphic Zod protocol shared by the runner + bridge + client
  server/
    ingest-runner.ts  ← Server-only: spawns the ingest bridge, staging + manifest + mutex
```

## Ingestion UI (`/ingest`)

Upload markdown, run the full `@june/mcp-ingest` pipeline (parse → chunk → summarize → embed → store), watch per-file progress with live logs, and wipe documents.

**How it runs the pipeline.** The Next process never imports `@june/mcp-ingest` directly — Bun resolves that package's internal `@/` path alias against the *caller's* tsconfig, which breaks from `packages/next`. Instead, the server [`ingest-runner`](./lib/server/ingest-runner.ts) spawns the ingest package's [`cli/web-bridge.ts`](../mcp/ingest/cli/web-bridge.ts) as a **Bun child process with cwd = the ingest package**, where `@/` and `bun:sqlite` resolve cleanly. The bridge runs the real programmatic API and emits sentinel-prefixed NDJSON events on stdout; the runner filters, validates ([`ingest-events.ts`](./lib/ingest-events.ts)), and streams them to the browser. This keeps the pipeline (and its native deps) entirely out of the Next bundle.

Uploaded files are staged under `.ingest-uploads/` (gitignored); a `manifest.json` there maps `doc_id → staged path` so a wipe can delete the file from disk.

**Concurrency.** The pipeline holds a single-writer SQLite lock per run, so writes serialize. `INGEST_MAX_PARALLEL` (env, default `2`) caps how many ingest/purge operations the runner admits concurrently; overlapping operations wait on the lock (the bridge retries on `SidecarLockHeldError`) rather than erroring. Because the lock serializes actual writes, values >1 bound in-flight requests + resource use, not write throughput.

**Prerequisites.** Ollama + Qdrant must be running and reachable. Configure the bridge via `packages/next/.env.local` (mirrors [`packages/mcp/ingest/.env.example`](../mcp/ingest/.env.example)): `OLLAMA_URL`, `QDRANT_URL`, `OLLAMA_EMBED_MODEL`, `OLLAMA_CLASSIFIER_MODEL`, `OLLAMA_SUMMARIZER_MODEL`. With no `CONFIG_PATH`, the sidecar defaults to `packages/mcp/ingest/june.db` — the same store the `june` CLI uses when run from that directory, so docs ingested either way appear together.

## `/test` — bench pipeline runner

`/test` starts a bench RAG-eval run (`june-eval run`) and streams its live
progress to the browser over Server-Sent Events. One run at a time.

- `app/test/page.tsx` + `app/test/_components/TestRunner.tsx` — the UI: a single
  Start button (disabled while a run is live) and a live per-stage progress bar.
- `app/test/api/route.ts` — `POST` starts a run (`409` if one is already
  running); `GET` is the SSE stream. It replays the current snapshot on connect,
  so a page reload mid-run picks up where the pipeline is.
- `lib/test/run-manager.ts` — server-only singleton that spawns the bench CLI
  with `--progress-ndjson`, parses the NDJSON events off stdout, and broadcasts a
  folded snapshot to all SSE subscribers.
- `lib/test/events.ts` — Zod schema for the NDJSON events (mirror of bench's
  `src/lib/progress-events.ts`; keep in sync).

### Run history

Below the live runner, `/test` lists every past run found under `TEST_RUNS_DIR`,
newest first. Each row expands to a detail view: stage timeline (from which
artifact files exist), headline metrics + cost (from `results.json`), the
`summary.md` report, and — for runs launched here — the saved progress timeline
and captured stderr.

- `lib/test/run-store.ts` — read-only: `listRuns()` / `getRunDetail(runId)` scan
  the run-dirs and derive status from `results.json` (or artifact presence for
  interrupted runs). `runId` is regex-guarded against path traversal.
- `app/test/api/runs/route.ts` + `app/test/api/runs/[runId]/route.ts` — list +
  detail endpoints; both overlay the live run's status.
- `app/test/_components/{TestDashboard,RunHistory,RunDetail}.tsx` — the UI; the
  history refetches whenever the live run's status changes.

The run-manager saves `progress.ndjson` (the event timeline) and
`progress.stderr.log` into each UI-launched run's dir, so they're replayable
later. Runs created before this feature (or outside the UI) show only their
on-disk `results.json` / `summary.md`.

### Configuration (server env)

The run target is env-configurable; only `TEST_FIXTURE_DIR` is required.

| Var | Default | Meaning |
|---|---|---|
| `TEST_FIXTURE_DIR` | _(required)_ | fixture dir from `june-eval generate` |
| `TEST_BENCH_RUNNER` | `bun` | executable that runs the bench CLI |
| `TEST_BENCH_CLI` | `cli/bench.ts` | bench CLI entry (relative to cwd) |
| `TEST_BENCH_CWD` | `../mcp/bench` | working dir (so bench `.env`/`config.yaml` resolve) |
| `TEST_RUNS_DIR` | `<cwd>/state/runs` | where run-dirs live (must match bench `--out`) |
| `TEST_CONFIG_PATH` | `<cwd>/test-run.config.yaml` | the editable run-config the UI reads/writes |
| `TEST_RUN_FLAGS` | _(empty)_ | optional extra bench flags appended after the config-derived ones |

The runner always appends `--yes --quiet --progress-ndjson`. The bench run still
needs its own env (Anthropic/Qdrant/Ollama/`JUNE_BIN`) resolvable from its cwd.

### Editable run config

A **Configuration** panel at the top of `/test` exposes curated ingest tunables
(chunk sizes/overlap, embedding batch/matryoshka/max-chars, summarizer) and bench
run options (sample ratio, response cache, no-RAG baseline, reader concurrency).
Edits are saved to a YAML at `TEST_CONFIG_PATH` (editable outside the UI too) and
reused by every run. On Start the runner translates them into bench flags
(`--sample`/`--quick`, `--cache`, `--baseline`/`--no-baseline`,
`--reader-concurrency`) and writes the `ingest:` section to a temp YAML passed via
`--ingest-config`. The panel locks while a run is live (`PUT` also returns `409`).

- `lib/test/config.ts` — `TestConfigSchema` (Zod), `loadTestConfig`/`saveTestConfig`,
  `deriveRunArgs`. The `ingest` section mirrors the ingestion `ConfigSchema`
  (`packages/mcp/ingest/src/lib/config.ts`) — keep them in sync.
- `app/test/api/config/route.ts` — `GET`/`PUT` the config.
- `app/test/_components/ConfigPanel.tsx` — the form.

## Adding shadcn components

```bash
bunx shadcn@latest add <component>
```
