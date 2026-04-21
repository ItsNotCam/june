<!-- author: Claude -->
## Working conventions

### Git commits

Commit messages must always start with a conventional commit type in parentheses:

```
(feat) add user authentication
(fix) resolve null pointer in payment flow
(chore) remove .claude/settings.json from version control
```

Valid types: `(feat)`, `(fix)`, `(chore)`, `(refactor)`, `(docs)`, `(test)`, `(style)`, `(perf)`, `(ci)`, `(build)`

### Authorship tracking and commit workflow

A PostToolUse hook automatically records Claude's file contributions to `.claude/scratch/authorship.jsonl` after every `Write` or `Edit`. Before writing any commit message, run:

```bash
bash /home/cam/june/scripts/check-authorship.sh
```

This prints a per-file table with Claude's `+` line count vs total lines, and two groups:

- **Claude-primary** (Claude > 50% of file): commit with trailer `Co-authored-by: Claude <claude@anthropic.com>`
- **Cam-primary** (Claude ≤ 50%): commit without trailer

**Split case (files in both groups):**
1. `git restore --staged .`
2. `git add <claude-primary files>` → commit with `Co-authored-by: Claude <claude@anthropic.com>`
3. `git add <cam-primary files>` → commit without trailer

**All same group:** single commit, with or without trailer as appropriate.

**No tracking data for a file** (Cam edited it directly): treat as Cam-primary.

The percentage is `claude_adds / total_lines` where `claude_adds` = lines Claude has added since the last `git commit`. It measures per-session contribution, not lifetime authorship.

### READMEs
After every commit, update the README for any package whose files were changed. If no README exists for that package yet, create one. The root README should also be updated if the change affects the overall project structure or public API.

## Current Repo State (as of April 2026)

### Monorepo layout

```
june/                          ← Bun workspace root
  packages/
    next/                      ← @june/next — Next.js 16 frontend
    shared/                    ← @june/shared — shared types, env/config/logger scaffolding
    mcp/                       ← umbrella (no package.json at this level)
      ingest/                  ← @june/mcp-ingest — markdown ingestion pipeline + `june` CLI
      bench/                   ← @june/mcp-bench — synthetic-corpus RAG-quality eval (`june-eval` CLI)
      server/                  ← @june/mcp-server — MCP server (Hono HTTP + JSON-RPC, scaffold)
```

Root `package.json` declares `"workspaces": ["packages/*", "packages/mcp/*"]`. All packages are `"type": "module"`, TypeScript strict, Bun runtime.

### packages/next

- **Next.js 16.2.4**, React 19, Tailwind v4, TypeScript strict
- **shadcn/ui** initialized (`components.json` present, Tailwind v4 compatible)
- Installed shadcn components: `Button` (`components/ui/button.tsx`), `lib/utils.ts`
- App router, no `src/` dir, no import alias (`@/` maps to root)
- Fonts: Geist Sans + Geist Mono via `next/font/google`
- `page.tsx` is a clean june-branded placeholder using shadcn `Button` — no Next.js boilerplate
- `packages/next` has its own nested `.git` repo (created by `create-next-app`) — be aware when running git commands from repo root

### packages/mcp/ingest

The markdown ingestion pipeline. Ships the `june` CLI (`init`, `ingest`, `status`, `resume`, `reindex`, `purge`, `reconcile`, `re-embed`, `health`, `bench`). Tests under `__test__/`, pipeline perf harness under `benchmark/`. SQLite sidecar + Qdrant vector store.

### packages/mcp/bench

RAG-quality evaluation. Ships the `june-eval` CLI (`generate`, `run`, `report`, `compare`, `health`). Generates a synthetic corpus, ingests it via the `june` CLI, runs retrieval + reader + LLM judge, and scores recall/MRR/answer correctness. Uses Anthropic, OpenAI, and Ollama providers.

### packages/mcp/server

Scaffold only. Will host the MCP JSON-RPC server that exposes `@june/mcp-ingest` pipeline entry points as MCP tools.

### packages/shared

`@june/shared` provides `BaseEnvSchema`, `createEnv`, and shared types used across all packages.

### Notes for future work

- `packages/next` runs with `bun dev` from inside `packages/next/`
- Node.js on this machine is 18.x; Next.js 16 requires >=20.9.0 — use Bun to run Next.js directly, not Node
- shadcn components are added with `bunx shadcn@latest add <component>` from inside `packages/next/`
- Root `tsconfig.json` is set to strict TypeScript — all packages should inherit or match this
