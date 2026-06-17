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

### READMEs
After every commit, update the README for any package whose files were changed. If no README exists for that package yet, create one. The root README should also be updated if the change affects the overall project structure or public API.

### Engineering log (mandatory)
After completing a **large action** — a plan phase, a feature, or a non-trivial fix that has been verified (compiles + tests pass) and committed — you **must** record an engineering-log entry, exactly as directed by the `engineering-log` skill (`.claude/skills/engineering-log/SKILL.md`). This is not optional. Entries live in the **Obsidian vault** under `engineering-log/<feature-name>/<slug>.md` (one folder per feature/initiative) and are written via the `obsidian-notes` MCP (`mcp__obsidian-notes__vault_write`) — they are **not committed to the repo** and are **not** loose files under `.claude/`. An entry **never contains secrets** (no keys, tokens, `.env` values, or credentialed URLs). It opens with YAML frontmatter (`feature`, `sequence`, `status`, `prev_commit`/`new_commit`, `summary`, …), cites the previous → new commit hashes, and has, in order: a clear heading, a one-paragraph summary, a plain-English high-level section, the steps performed, and an action-items / next-steps section — so the log forms a coherent, searchable history of progress on this tool.

### Telegram notifications (tg-send)

A `tg-send` helper exists at `~/.local/bin/tg-send` — use it to push a Telegram message to the user (e.g. "long task finished", "needs input", build/bench results). Call it with the full path since `~/.local/bin` may not be on PATH in non-interactive shells:

```bash
~/.local/bin/tg-send "bench run finished: gemma control passed"
echo "multi-line or piped body" | ~/.local/bin/tg-send
~/.local/bin/tg-send --chat <CHAT_ID> "message to a different chat"
```

Credentials (bot token + default chat id) live in `~/.config/tg-send/credentials` (chmod 600) and must **never** be printed, committed, or echoed. The script prints `sent` on success and a non-zero error otherwise.

### Bench reader-by-purpose (flash iterates, gemma4:26b is the bar)

Running `@june/mcp-bench`? The reader model is chosen **by purpose — you know which, you don't ask**:

- **Iterating / fast loop** → `june-eval run … --mode iterate` (reader = `deepseek-v4-flash`). **Directional scratchpad ONLY — never "expected results."**
- **Benchmarking / certifying / "is this actually good?"** → `june-eval run … --mode control` (reader = `gemma4:26b`, the BYO-AI 24GB reference). **The authoritative bar.**
- Ad-hoc reader (bake-off) → explicit `--reader-provider/--reader-model` (`freeform`; never a baseline).

Every run must declare intent (no `--mode`/`--reader-*` → hard error). Flash deltas are hypotheses; the gemma `control` run is the verdict — a change that helps flash but regresses gemma is overfit. Gate batches with `june-eval control-check`. Full rules + the failure-class discipline: `packages/mcp/bench/CLAUDE.md` (reader-by-purpose) and `src/lib/modes.ts`.

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
