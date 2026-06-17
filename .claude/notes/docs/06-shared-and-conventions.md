---
title: Shared Layer & Project Conventions — @june/shared
type: reference
status: active
tags: [project/june, area/research, tech/architecture]
project: june
area: research
created: 2026-06-17
summary: The base @june/shared package (env, config, logging, types) plus the repo-wide coding conventions.
keywords: [shared, base layer, env, config, logger, zod, winston, conventions, coding standards]
aliases: [june shared, project conventions]
---

# Shared Layer & Project Conventions — `@june/shared`

> The base package every other package extends, plus the cross-cutting rules that make
> the codebase uniform: env, config, logging, and the coding standards enforced
> repo-wide.

---

## 1. `@june/shared` — the base layer

No build step; exports TypeScript directly from `src/index.ts`. Dependencies:
`winston`, `yaml`, `zod`. Consumed by `@june/mcp-ingest`, `@june/mcp-bench`,
`@june/mcp-server` (the frontend has its own equivalents).

### Types (`src/types.ts`)

Single sources of truth, derived not hand-written:

```ts
export const NODE_ENV_VALUES = ["development", "production", "test"] as const;
export type NodeEnv = (typeof NODE_ENV_VALUES)[number];

// LogLevel is derived directly from Winston's npm levels — not a custom subset.
export type LogLevel = Extract<keyof typeof config.npm.levels, string>;
export const LOG_LEVEL_VALUES = Object.keys(config.npm.levels) as [LogLevel, ...LogLevel[]];
```

### Env factory (`src/env.ts`)

```ts
export const BaseEnvSchema = z.object({
  NODE_ENV: z.enum(NODE_ENV_VALUES).default("development"),
  LOG_LEVEL: z.enum(LOG_LEVEL_VALUES).default("info"),
  CONFIG_PATH: z.string(),
});

export const createEnv = <T extends z.ZodObject<z.ZodRawShape>>(schema: T) => {
  let _env: z.infer<T> | null = null;
  return (): z.infer<T> => (_env ??= schema.parse(process.env));
};
```

Every package writes `lib/env.ts` as `BaseEnvSchema.extend({...})` + `createEnv(...)` —
a lazy singleton that parses `process.env` once and caches it. **Never touch
`process.env` outside `lib/env.ts`.**

### Config factory (`src/config.ts`)

`createConfig(schema)` returns `{ loadConfig(path), getConfig() }`: `loadConfig` reads
+ parses YAML + validates (always overwrites — safe for tests/hot-reload); `getConfig`
returns the cached value or throws `ConfigNotInitializedError`. Call
`loadConfig(getEnv().CONFIG_PATH)` once at startup; use `getConfig()` everywhere else.
**Never read config values any other way.**

### Logger factory (`src/logger.ts`)

`createLogger<F>(opts)` returns `{ logger, setLogLevel, setPrettyMode }`. The generic
`F` is the package's *closed set of allowed log fields*, so structured metadata is
type-checked (and raw content can't leak in). Pretty mode (TTY) gives colored,
emoji-prefixed, timestamped lines; otherwise JSON. Lazy Winston construction.

```ts
type LogFields = { retriever_id?: string; chunk_count?: number };
const { logger } = createLogger<LogFields>();
logger.info("query.processed", { retriever_id: "r123", chunk_count: 42 });
```

**Winston only — no `console.*` in production code.** Log an event name + structured
fields, never an interpolated string.

---

## 2. Coding conventions (repo-wide)

Enforced by `tsconfig.json` (strict + `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`,
`noImplicitOverride`, `noPropertyAccessFromIndexSignature`) and
[`.claude/rules/code-style.md`](../rules/code-style.md):

- **No `any`, ever.** Use `unknown` + Zod/type-guards to narrow.
- **Zod at every trust boundary** — HTTP bodies, external API responses, env, config,
  file/DB reads, MCP tool results. Infer types from schemas; never duplicate them.
  Schemas are `PascalCase` + `Schema` suffix.
- **`type` over `interface`** (interface only for declaration merging / `implements`).
- **Named exports only** (except Next.js pages/layouts, which require default).
- **`const` by default**, `let` only when reassigned, never `var`.
- **`import type`** for type-only imports (`verbatimModuleSyntax` is on).
- **`undefined` is the canonical absent value**; `null` only at external boundaries,
  converted on the way in.
- **`async/await` only** — no `.then()` chains.
- **No silent catches** — rethrow, log+rethrow, or return a typed error result. Define
  a typed error class when a failure is a distinct domain case.
- **No magic values** — extract repeated/opaque literals to a named `const`; if it
  varies by environment it belongs in `env.ts`, if it's a tunable it belongs in
  `config.ts`.
- **JSDoc every export** — explain *why*, not *what*.
- **Naming:** `camelCase` values, `PascalCase` types/components,
  `SCREAMING_SNAKE_CASE` module constants, `kebab-case.ts` files,
  `PascalCase.tsx` components.

### Concurrency (from the user's global rules)

Exploit independence. Independent async work runs concurrently — `Promise.all`
(fail-fast) or `Promise.allSettled` (collect all). For rate/resource-limited batches
(Ollama, paid APIs, file I/O), use a bounded helper (`mapConcurrent` / `p-limit`). A
serial `for (const x of xs) await f(x)` over **independent** inputs is a bug. Serial is
only correct when each iteration depends on the previous one (cursor pagination,
ordered transactions).

### UI conventions (`packages/next/**`)

[`.claude/rules/ui-style.md`](../rules/ui-style.md): shadcn → Tailwind utilities →
inline styles (computed only). Semantic color tokens only (`bg-background`,
`text-foreground`, …) — never raw oklch/hsl/rgba/hex unless computed at runtime.

### The parity rule

Whenever a new env var or config value is introduced — in code, a `.env` example, or
docs — update **both** the Zod schema (`lib/env.ts` / `lib/config.ts`) **and** the
inferred type in the same change. Schema and usage must never drift.

---

## 3. Root infrastructure

- **`tsconfig.json`** (root) — bundler resolution, ESNext, all strict flags; every
  package extends it.
- **`docker-compose.yml`** — qdrant, next, mcp-ingest, mcp-server (+ optional ollama);
  see [01 — Architecture](./01-architecture.md) §2.
- **`.gitleaks.toml`** — custom rules flag personal identifiers
  (`example.invalid`, `/home/cam/`, the email, the name); lock files allow-listed.
- **`.gitignore`** — excludes `qdrant_storage/*`, `.claude/scratch/`, the bench
  `state/`, and `.mcp.json` (local paths/secrets).
- **Lockfiles** — `bun.lock` is canonical (Bun is the runtime); a legacy `yarn.lock`
  lingers.
- **`scripts/`** — the authorship + reader-mode tooling, documented in
  [07 — Authorship & dev workflow](./07-authorship-and-workflow.md).
