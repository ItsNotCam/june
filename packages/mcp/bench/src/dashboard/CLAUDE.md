# Dashboard — the RSI bench frontend

A local web UI for reviewing `june-eval` runs over time and watching one run live.
It is the **window onto the gauge**: as the future RSI loop iterates the pipeline,
this is where you see what's improving, what regressed, and whether a control run
clears its golden baseline.

Launched with `june-eval dashboard` (default `http://localhost:4317`). It is
**strictly read-only** — it reads `state/runs/`, `golden.json`, and per-run
`progress.ndjson`; it never launches, mutates, or deletes a run.

> Read the package contract first: [`../../CLAUDE.md`](../../CLAUDE.md). The
> dashboard only *displays* the bench — every invariant below (reader-by-purpose,
> fixture grouping, cross-judge calibration, "gauge not goal") originates there.
> The frontend's job is to surface those invariants, never to relax them.

## What it is / what it currently displays

A single-page app with five cards in the main column plus a persistent detail aside:

1. **Run in progress** (`#inflight`, hidden when idle) — stage-by-stage progress of
   the live run (stages 4–9: ingest → ground-truth → retrieval → reader → judging →
   scoring). Driven by SSE: tails `progress.ndjson` when present, else infers the
   current stage from which artifact files exist (the holdout fallback — holdout runs
   have no progress reporter).
1b. **Live log** (`#logcard`, hidden when idle) — a tail of the active run's
   `<run_dir>/run.log` (the full human log `run.ts` tees there via `addLogFile`),
   colorized by level. **Polled, not SSE**: `app.js` GETs `/api/runs/:id/log` every 5s
   while a run is active. `reader.ts:readRunLog` returns a byte-capped tail (last ~64KB
   / 400 lines) so an unbounded log never bricks the response. A `follow` toggle
   auto-scrolls to the newest line.
2. **Performance over time** (trend chart) — `reader_correct_pct` / `recall@5` / `MRR`
   across runs (toggleable series), or a **per-tier correct%** view with golden
   baselines drawn as dashed lines. Controlled by three selects: **fixture**, **mode**
   (control / iterate / all), **view** (overall / per-tier). Tooltips carry the 95% CI
   and the run id + mode.
3. **Golden gate** — the pinned baseline for the selected fixture and a per-tier
   PASS/FAIL of the latest *control* run against it (− noise floor). Also raises a
   cross-judge caveat and a synthetic↔holdout recall divergence alarm (possible
   overfitting to the toy domain).
4. **Runs table** — every run for the selected fixture (when, mode, kind, reader,
   judge, correct%, recall@5, MRR, status, cost). Click a row to populate the detail
   aside.

The **detail aside** (`#detail`) shows one run's manifest + per-tier table (point ±
CI), a grouped per-tier bar chart, integrity stats, and the rendered `summary.md`.
Holdout runs render a distinct **retrieval-led** panel (reader correctness is caveated
as parametric-memory-contaminated; trust recall@k).

## Guardrails the frontend enforces (don't weaken these)

These mirror the RSI-readiness contract and are the *reason* the dashboard exists —
to keep the human reading the gauge honestly:

- **control & iterate are never plotted on one trend line** — the mode filter defaults
  to `control` (gemma4:26b, the bar); `iterate` (flash) is a scratchpad. The `all`
  view prints a loud warning because the two readers fail on different queries.
- **metrics are only comparable within one `fixture_hash`** — everything is grouped by
  the fixture selector; never aggregate across fixtures.
- **cross-judge mismatch is flagged** — a control run judged by a different model/prompt
  than the golden was pinned with is marked (⚠ in the table, a caveat in the gate);
  gate comparisons aren't calibrated across judges.
- **holdout leads with retrieval** — reader correctness on real docs is contaminated by
  the model's parametric memory, so the holdout panel foregrounds recall@k.

## Architecture

Zero-dependency, no framework, no build step. Two TS modules on the server, three
static assets in the browser.

```
src/dashboard/
├── server.ts          Bun.serve HTTP + SSE. Routes static files + a JSON/SSE API.
├── reader.ts          Pure, filesystem-only data layer (read-only, side-effect-free).
└── public/            The vanilla frontend (served as static assets).
    ├── index.html     Markup + CDN <script>s (Chart.js, annotation plugin, marked).
    ├── app.js         All client logic: fetch, state, render, SSE.
    └── style.css      Theme palette (dark default; light via :root[data-theme=light]).
```

**`server.ts`** — `Bun.serve` (no Next.js, no Express). `createHandler` is split from
`startDashboardServer` so tests can route without binding a port. Endpoints:

| Route | Returns |
|---|---|
| `GET /` | `public/index.html` |
| `GET /static/<file>` | static asset (path-traversal guarded) |
| `GET /api/runs` | `RunSummary[]`, newest first |
| `GET /api/runs/:id` | `{ kind, results, summary_md }` (run-id regex validated) |
| `GET /api/runs/:id/log` | `{ present, lines, truncated }` (byte-capped `run.log` tail) |
| `GET /api/golden` | `Record<fixture_hash, GoldenNormalized>` |
| `GET /api/stream` | `text/event-stream`: `hello` / `runs_changed` / `active` / `idle` / `progress` |

**`reader.ts`** — parses on-disk artifacts into the **one** shape the frontend
consumes. Its central job is translating the two non-overlapping result schemas into a
unified `RunSummary`:

- synthetic `results.json` (`overall.macro`, `fixture_id`, `per_tier`) — see
  [`../types/results.ts`](../types/results.ts)
- holdout `holdout_results.json` (`answerable.*`, `holdout_id`, no per-tier) — see
  [`../types/holdout.ts`](../types/holdout.ts)

It is **robust over strict**: a malformed/partial artifact is skipped or downgraded to
a `running`/`error` summary rather than thrown — a live run mid-write must never brick
the list. It also normalizes both the **v1** golden (flat `per_tier_correct`) and the
**v2** schema (`per_tier[*].reader_correct_pct.point` + judge identity).

**`app.js`** — a single `state` object + plain render functions; no virtual DOM. Chart
rendering via Chart.js (CDN). SSE via `EventSource`; `runs_changed` triggers a full
`loadAll()` refetch, `progress` events drive the in-flight stage list. The query-tier
glossary (T1–T7) and metric definitions are inlined here for the user; the source of
truth for tiers is [`../types/query.ts`](../types/query.ts).

### Notes / gotchas

- **CDN dependencies**: Chart.js, the annotation plugin, and `marked` load from
  jsdelivr — first load needs network. `marked` falls back to escaped `<pre>` if it
  didn't load; charts simply won't render offline.
- The `stage_inferred` SSE path is the holdout/legacy fallback (artifact-presence
  inference). The stage roster in `reader.ts` (`STAGE_ARTIFACTS`) mirrors `cli/run.ts`
  `RUN_STAGES` — keep them in sync if stages change.
- `summary.md` is **locally generated and trusted**, so it's rendered as HTML; any
  other text from runs is escaped (`escapeHtml`).
- Run detail loads are race-guarded (`state.selected` re-check) — a newer click wins.

## Related docs

- [`../../CLAUDE.md`](../../CLAUDE.md) — package contract (reader-by-purpose, stopgap,
  gauge-not-goal). **The source of every invariant the UI enforces.**
- [`../../README.md`](../../README.md) — `june-eval` CLI incl. the `dashboard`
  subcommand (flags, what it shows); `progress.ndjson` reporter; exit codes.
- [`../../HOLDOUT.md`](../../HOLDOUT.md) — the sealed real-doc holdout the retrieval-led
  detail panel renders.
- [`../../JUDGE-RUNNER.md`](../../JUDGE-RUNNER.md) / [`../../VALIDATE-JUDGE.md`](../../VALIDATE-JUDGE.md)
  — judge identity + calibration behind the cross-judge guard.
- [`../lib/progress-events.ts`](../lib/progress-events.ts) — `TestEvent` schema the SSE
  stream emits and `app.js` switches on.
- [`../types/results.ts`](../types/results.ts) / [`../types/holdout.ts`](../types/holdout.ts)
  / [`../types/query.ts`](../types/query.ts) — the result + tier schemas `reader.ts`
  unifies.
