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
    next/                      ← Frontend (Next.js 16, React 19, Tailwind v4, shadcn/ui)
    server/                    ← Hono API server (stub — Hello World only)
    mcp/                       ← MCP package (stub — Hello World only)
```

Root `package.json` declares `"workspaces": ["packages/*"]`. All packages are `"type": "module"`, TypeScript strict, Bun runtime.

### packages/next

- **Next.js 16.2.4**, React 19, Tailwind v4, TypeScript strict
- **shadcn/ui** initialized (`components.json` present, Tailwind v4 compatible)
- Installed shadcn components: `Button` (`components/ui/button.tsx`), `lib/utils.ts`
- App router, no `src/` dir, no import alias (`@/` maps to root)
- Fonts: Geist Sans + Geist Mono via `next/font/google`
- `page.tsx` is a clean june-branded placeholder using shadcn `Button` — no Next.js boilerplate
- `packages/next` has its own nested `.git` repo (created by `create-next-app`) — be aware when running git commands from repo root

### packages/server + packages/mcp

Both are empty Bun stubs (`console.log("Hello via Bun!")`). No dependencies installed yet. These are the next things to build out.

### Notes for future work

- `packages/next` runs with `bun dev` from inside `packages/next/`
- Node.js on this machine is 18.x; Next.js 16 requires >=20.9.0 — use Bun to run Next.js directly, not Node
- shadcn components are added with `bunx shadcn@latest add <component>` from inside `packages/next/`
- Root `tsconfig.json` is set to strict TypeScript — all packages should inherit or match this
