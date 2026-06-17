---
title: Frontend — @june/next
type: reference
status: active
tags: [project/june, area/product, tech/frontend]
project: june
area: product
created: 2026-06-17
summary: Next.js 16 / React 19 / Tailwind v4 app — Test Dashboard, Ingest UI, and Preview; relays backend CLI NDJSON streams.
keywords: [frontend, next.js, react, tailwind, shadcn, test dashboard, ingest ui, ndjson]
aliases: [june frontend, mcp-next]
---

# Frontend — `@june/next`

> A Next.js 16 / React 19 / Tailwind v4 app with three feature areas: a **Test
> Dashboard** that drives bench runs live, an **Ingest UI** for uploading and
> indexing markdown, and a **Preview** design-system showcase. The server never does
> heavy work in-process — it spawns the backend CLIs and relays their NDJSON streams.

---

## 1. Stack & configuration

- **Next.js 16.2.4** (App Router, no `src/`, `@/*` → root), **React 19**, **Bun**
  runtime (`bunx --bun next dev --turbopack`).
- **Tailwind v4** via `@tailwindcss/postcss`; **shadcn/ui** (`base-nova` style, RSC on,
  lucide icons). `next.config.ts` is minimal — **Cache Components / PPR are not on**.
- Libraries: `recharts` (charts), `next-themes` (dark mode), `react-markdown` +
  `remark-gfm`, `@base-ui/react`, `zod` (every trust boundary).
- Fonts (`app/typography.ts`): **Poppins** (prose) + **Geist Mono** (structural), wired
  as CSS variables.

### Theming (`app/globals.css`)

All color comes from **semantic CSS-variable tokens** exposed as Tailwind utilities —
`bg-background`, `text-foreground`, `text-primary`, `text-muted-foreground`,
`border-border`, the `sidebar-*` set, and a 5-color chart palette. Light and dark
palettes are warm and muted (sand surfaces, muted-green primary). The
[`ui-style.md`](../rules/ui-style.md) rule forbids raw color values unless computed at
runtime. Dark mode is a `.dark` class on `<html>` (managed by next-themes,
system-default), toggled by a fixed top-right button.

`app/layout.tsx` is the shell: `ThemeProvider` → fixed `ThemeToggleClient` +
`SideNav` + scrollable `<main>`.

---

## 2. Route map

| Route | Type | Purpose |
|---|---|---|
| `/` | Page | Marketing placeholder. |
| `/test` | Page + API | **Test Dashboard** — run + inspect bench evals. |
| `/ingest` | Page + API | **Ingest UI** — upload + index markdown, manage docs. |
| `/preview` | Page | Static design-system showcase (every component + token). |
| `/api/ingest` | Node route | POST: stage uploads, spawn ingest bridge, stream NDJSON. |
| `/api/documents` | Node route | GET: list indexed docs from the sidecar DB. |
| `/api/documents/purge` | Node route | POST: hard-delete a document. |
| `/test/api` | Node route | GET: SSE run progress; POST: start a run (202 / 409). |
| `/test/api/config` | Node route | GET/PUT: read/save the run config YAML. |
| `/test/api/runs` | Node route | GET: list run dirs (newest first, live-overlaid). |
| `/test/api/runs/[runId]` | Node route | GET/DELETE: one run's detail / delete it. |
| `/test/api/ollama-models` | Node route | GET: auto-detect chat models from Ollama. |

All API routes are `runtime = "nodejs"` (they spawn child processes); SSE/stream
routes are `dynamic = "force-dynamic"`.

---

## 3. Feature: Test Dashboard (`/test`)

Drives `@june/mcp-bench` from the browser with live progress.

**Components** (`app/test/_components/`):

- **`TestDashboard`** — client coordinator. A `refreshKey` bumps whenever run status
  changes, refreshing history + chart; the config panel locks while a run is live.
- **`TestRunner`** — opens an `EventSource` to `GET /test/api`, folds streamed
  `RunMessage`s into a snapshot (stages, progress bars, elapsed, cost, errors), and
  POSTs to start a run.
- **`ConfigPanel`** — loads/saves the run config: sample ratio (quick/sample/full),
  reader concurrency, cache/baseline toggles, **reader model** picker (Ollama
  auto-detected + Claude/DeepSeek curated), **judge model** picker, reuse-prior-ingest,
  plus ingest tunables (chunk/embedding/summarizer).
- **`RunHistory`** — lists run dirs; the live run is overlaid as "running"; rows expand
  to `RunDetail`; delete is blocked while running.
- **`RunDetail`** — per-run stage timeline, metrics table (answers-correct %, recall@5,
  MRR, cost), collapsible event log + stderr tail, rendered `summary.md`.
- **`ResultsChart`** — recharts line chart of answers-correct / recall@5 / MRR over time.

**Server plumbing** (`lib/test/`):

- **`run-manager.ts`** (server-only singleton, cached on `globalThis` to survive HMR) —
  `startRun()` validates env and spawns the `june-eval` CLI child with
  `--progress-ndjson`; folds `TestEvent`s into a `RunSnapshot`; broadcasts to SSE
  subscribers; persists `progress.ndjson` + `.stderr.log`.
- **`run-store.ts`** (server-only, read-only disk interface) — `listRuns()`,
  `getRunDetail()`, `deleteRun()`, with a `STAGE_ARTIFACTS` map and a `RunMetrics`
  shape.
- **`config.ts`** — Zod schemas (`IngestConfigSchema`, `RunConfigSchema`); `deriveRunArgs()`
  translates the saved config into CLI flags + an ingest YAML.
- **`events.ts`** — Zod schemas for the bench NDJSON protocol (`run_start`,
  `stage_start`, `tick`, `poll`, `stage_end`, `run_complete`, `run_error`) and the
  `RunSnapshot` type.
- **`model-catalog.ts`** — curated provider/model lists (`CLAUDE_MODELS`,
  `DEEPSEEK_MODELS`, `JUDGE_PROVIDERS`).

The SSE endpoint replays the latest snapshot on connect (catch-up), heartbeats every
15s, and closes on a terminal status; the client reconnects on the next Start.

---

## 4. Feature: Ingest UI (`/ingest`)

Drag-and-drop markdown → live pipeline progress → document management. One client
component tree (`app/ingest/_components/`): `IngestClient` (coordinator) →
`UploadDropzone`, `IngestTable` (expandable per-file rows with live logs + progress),
`WipeDialog`.

**Flow:** the user drops `.md` files and clicks "Ingest all" → `POST /api/ingest`
(multipart) → the server stages bytes to `INGEST_STAGING_DIR`, spawns the
`@june/mcp-ingest` **web bridge** child, and streams `application/x-ndjson`
`BridgeEvent`s back (`run_start`, `file_start`, `stage`, `file_done`, `file_skipped`,
`file_error`, `run_done`, `documents`, `purged`, `fatal`). The client maps file IDs to
rows and advances each row's stage/progress.

**Server** (`lib/server/ingest-runner.ts`): a counting semaphore bounds parallel
ingest/purge (`INGEST_MAX_PARALLEL`, default 2); the bridge is spawned with a sentinel
(`@@JUNE_EVT@@`) so its event lines can be filtered from incidental stdout. Exports:
`runIngest(uploads, sendEvent)`, `listDocuments()`, `purgeDocument(docId)`. The
isomorphic event protocol + `DocumentRow` type live in `lib/ingest-events.ts` (safe to
import on both client and server).

---

## 5. Feature: Preview (`/preview`)

A static showcase of the whole design system — stat cards, recharts variants (line /
bar / area / donut), tables, badges, buttons, inputs, typography, skeletons, timeline,
toasts, sparklines, empty states, the full color palette, and a fake form. Pure demo
data; no backend calls. It's the visual reference when building new UI.

---

## 6. Components & utilities

- `components/ui/` (shadcn): `Badge`, `Button`, `Card`, `Chart`, `Input`, `Label`,
  `Markdown`, `Select`, `Switch`.
- `components/layout/`: `SideNav` (collapsible, active-by-pathname).
- `components/theme/`: `ThemeProvider`, `ThemeToggleClient`.
- `lib/ui/utils.ts`: `cn()` (clsx + tailwind-merge).

---

## 7. Environment

**Test runner:** `TEST_BENCH_RUNNER` (default `bun`), `TEST_BENCH_CLI`
(`cli/bench.ts`), `TEST_BENCH_CWD` (`../mcp/bench`), `TEST_FIXTURE_DIR` (**required**),
`TEST_RUNS_DIR`, `TEST_CONFIG_PATH`, `TEST_RUN_FLAGS`, `OLLAMA_URL`.

**Ingest runner:** `INGEST_PKG_DIR` (`../mcp/ingest`), `BUN_BIN`, `INGEST_STAGING_DIR`
(`.ingest-uploads`), `INGEST_MAX_PARALLEL` (2).

The backend connection is always **spawn-a-child + stream**: the Test Dashboard spawns
`june-eval`, the Ingest UI spawns the `@june/mcp-ingest` bridge, and both read the
sidecar SQLite directly for listings. The frontend itself holds no pipeline logic.
