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
components/
  PreviewCharts.tsx   ← Recharts-based chart showcase
  theme/
    ThemeProvider.tsx ← next-themes provider wrapper
    ThemeToggle.tsx   ← Server component shell
    ThemeToggleClient.tsx ← Client-side theme toggle button
  ui/
    button.tsx        ← shadcn Button
    card.tsx          ← shadcn Card
    chart.tsx         ← shadcn Chart (recharts wrapper)
lib/
  utils.ts            ← shadcn cn() helper
```

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
| `TEST_RUN_FLAGS` | `--quick --cache --yes` | flags appended to `run <fixture>` |
| `TEST_RUNS_DIR` | `<cwd>/state/runs` | where run-dirs live (must match bench `--out`) |

The runner always appends `--yes --quiet --progress-ndjson`. The bench run still
needs its own env (Anthropic/Qdrant/Ollama/`JUNE_BIN`) resolvable from its cwd.

## Adding shadcn components

```bash
bunx shadcn@latest add <component>
```
