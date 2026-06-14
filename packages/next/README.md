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

## Adding shadcn components

```bash
bunx shadcn@latest add <component>
```
