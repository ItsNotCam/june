## Working conventions

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
