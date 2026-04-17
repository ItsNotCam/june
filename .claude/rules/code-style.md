## Code Style

### Semicolons

Always end statements with a semicolon. The only exception is the closing `}` of conditional blocks and loops — no semicolon after `if`/`else`, `for`, `while`, `do...while`, `switch`, or `try/catch/finally` blocks.

```ts
const x = 1;
doSomething();
const fn = () => 42;

if (x > 0) {
  doSomething();
} else {
  doSomethingElse();
}

for (const item of items) {
  process(item);
}
```

### Variables

Always `const`. Use `let` only when the variable is explicitly reassigned. Never `var`.

### Types vs interfaces

Use `type` for everything. Only use `interface` when you specifically need declaration merging or `implements` in a class context.

```ts
// good
type User = { id: string; email: string };
type GetUser = (id: string) => Promise<User>;

// only when declaration merging is the point
interface Window { myExtension: string }
```

### Imports

Type-only imports must use `import type`. The `verbatimModuleSyntax` compiler flag enforces this, but be explicit:

```ts
import { logger } from "@/lib/logger";
import type { User } from "@/types/user";
```

### Exports

No default exports except in Next.js page and layout files (where the framework requires them). Always use named exports — they survive refactors and give IDEs accurate rename targets.

```ts
// bad
export default function UserCard() { ... }

// good
export function UserCard() { ... }

// Next.js pages/layouts — default required by the framework
export default function Page() { ... }
```

### Naming conventions

| Thing | Convention |
|---|---|
| Variables, functions, methods | `camelCase` |
| Types, interfaces, classes, components | `PascalCase` |
| Module-level constants | `SCREAMING_SNAKE_CASE` |
| Files | `kebab-case.ts` |
| React component files | `PascalCase.tsx` |
| Zod schemas | `PascalCase` + `Schema` suffix — e.g. `UserSchema` |

### Null vs undefined

Use `undefined` as the canonical "absent value" in TypeScript code. Only use `null` when an external API contract (REST response, database column) explicitly returns it — parse it at the boundary with Zod and convert to `undefined` if needed internally.

### Async

Always `async/await`. Never `.then()` chaining. This applies everywhere — API calls, file I/O, database queries.

```ts
// bad
fetchUser(id).then(user => process(user)).catch(handleError);

// good
const user = await fetchUser(id);
```

### Error handling

Never silently swallow errors. Every `catch` block must either rethrow, log + rethrow, or return a typed error result — empty catch blocks are banned.

If an error represents a distinct failure mode in the domain, define a typed error class for it. Don't throw plain `Error` with a magic string message when the caller needs to distinguish the case.

```ts
export class UserNotFoundError extends Error {
  constructor(readonly userId: string) {
    super(`User not found: ${userId}`);
    this.name = "UserNotFoundError";
  }
}

// caller can instanceof-check reliably
if (error instanceof UserNotFoundError) { ... }
```

Standard errors (`TypeError`, `RangeError`, etc.) are fine when they're actually the right semantic fit.

### No magic values

If you're writing a bare string or number literal more than once, or one whose meaning isn't self-evident from context, it's wrong. Extract it to a named `const`. If it varies by environment, it belongs in `env.ts`. If it's a tunable setting, it belongs in `config.ts`.

### Environment variables and configuration

Shared primitive types (`NodeEnv`, `LogLevel`) and the base env schema live in `@june/shared`. `LogLevel` is derived from Winston's npm levels — no custom subset. Every package's `lib/env.ts` must extend `BaseEnvSchema` from `@june/shared` and use `createEnv()` to produce its `getEnv` — never write the lazy singleton boilerplate by hand.

```ts
// packages/shared/src/types.ts

/** All valid NODE_ENV values. Zod enum sources from this array. */
export const NODE_ENV_VALUES = ["development", "production", "test"] as const;
export type NodeEnv = (typeof NODE_ENV_VALUES)[number];

/** Derived directly from Winston's npm levels — single source of truth. */
export type LogLevel = Extract<keyof typeof config.npm.levels, string>;

/** Runtime array of Winston npm level names for Zod enum construction. */
export const LOG_LEVEL_VALUES = Object.keys(config.npm.levels) as [LogLevel, ...LogLevel[]];
```

```ts
// packages/shared/src/env.ts

/**
 * Base Zod schema every package's env must extend via BaseEnvSchema.extend({...}).
 * Contains the three fields required by all packages: NODE_ENV, LOG_LEVEL, CONFIG_PATH.
 * Never instantiate this directly — use createEnv() with an extended schema.
 */
export const BaseEnvSchema = z.object({
  NODE_ENV: z.enum(NODE_ENV_VALUES).default("development"),
  LOG_LEVEL: z.enum(LOG_LEVEL_VALUES).default("info"),
  // CONFIG_PATH is always present — used by the startup sequence to call loadConfig()
  CONFIG_PATH: z.string(),
});

export type BaseEnv = z.infer<typeof BaseEnvSchema>;

/**
 * Creates a lazy singleton getEnv() for the given Zod schema.
 *
 * The schema must be produced via BaseEnvSchema.extend({...}) to guarantee
 * NODE_ENV, LOG_LEVEL, and CONFIG_PATH are always present.
 * Parses process.env on first call and caches the result — safe to import at module level.
 * Throws a Zod error on first call if any required variable is missing or invalid.
 * Never call process.env directly — always go through the returned getEnv().
 */
export const createEnv = <T extends z.ZodObject<z.ZodRawShape>>(schema: T): () => z.infer<T> => {
  let _env: z.infer<T> | null = null;
  return (): z.infer<T> => {
    if (_env) return _env;
    _env = schema.parse(process.env);
    return _env;
  };
};
```

**Environment variables** (secrets, service URLs, feature flags that change per deployment) live in `.env` and are accessed exclusively through a singleton `lib/env.ts`.

```ts
// lib/env.ts
import { z } from "zod";
import { BaseEnvSchema, createEnv } from "@june/shared";

const EnvSchema = BaseEnvSchema.extend({
  // Add package-specific vars here
  MY_SERVICE_URL: z.url(),
});

/** Inferred from EnvSchema — never define manually. */
export type Env = z.infer<typeof EnvSchema>;

/**
 * Returns the validated environment, parsing process.env on first call.
 *
 * Extends BaseEnvSchema from @june/shared — NODE_ENV, LOG_LEVEL, and CONFIG_PATH
 * are always present. Add package-specific vars above via BaseEnvSchema.extend().
 * Never call process.env directly — always go through getEnv().
 */
export const getEnv = createEnv(EnvSchema);
```

**Configuration** (non-secret tunables — timeouts, limits, feature behaviour) lives in `config.yaml` and is accessed through a singleton `lib/config.ts`. Call `loadConfig(path)` once at startup using `getEnv().CONFIG_PATH`; everywhere else use `getConfig()`.

`loadConfig` always overwrites — calling it a second time reloads from the new path (safe for tests and hot-reload).

```ts
// lib/config.ts
import { z } from "zod";
import { readFile } from "fs/promises";
import { parse } from "yaml";

const ConfigSchema = z.object({
  // Add non-secret tunables here — timeouts, limits, feature flags, etc.
  requestTimeoutMs: z.number().int().positive(),
  maxRetries: z.number().int().min(0),
});

/** Inferred from ConfigSchema — never define manually. */
export type Config = z.infer<typeof ConfigSchema>;

/**
 * Thrown by getConfig() when called before loadConfig().
 * Catch this at the top level to give a clear startup error.
 */
export class ConfigNotInitializedError extends Error {
  constructor() {
    super("Config has not been loaded — call loadConfig(path) before getConfig()");
    this.name = "ConfigNotInitializedError";
  }
}

let _config: Config | null = null;

/**
 * Reads and validates a YAML config file at the given path.
 *
 * Always overwrites any previously loaded config — safe to call again for hot-reload or test reset.
 * Path should come from getEnv().CONFIG_PATH at startup.
 * Throws a Zod error if the file is present but fails validation.
 */
export const loadConfig = async (path: string): Promise<Config> => {
  const raw = await readFile(path, "utf-8");
  _config = ConfigSchema.parse(parse(raw));
  return _config;
};

/**
 * Returns the loaded config.
 *
 * Throws ConfigNotInitializedError if loadConfig() has not been called yet.
 * Call loadConfig(getEnv().CONFIG_PATH) once at startup before using this anywhere.
 * Never access config values directly — always go through getConfig().
 */
export const getConfig = (): Config => {
  if (!_config) throw new ConfigNotInitializedError();
  return _config;
};
```

Never read `process.env` directly outside of `lib/env.ts`. Never access config values without going through `getConfig()`.

**Parity rule:** whenever a new environment variable or config value is introduced — whether in code, a `.env` example, or documentation — immediately update both the Zod schema in `lib/env.ts` / `lib/config.ts` and the corresponding TypeScript type. Schema and usage must never drift apart.

### TypeScript

**No `any`. Ever.**
Use `unknown` for values whose shape is not yet known, then narrow with Zod or type guards before use. If you feel the urge to write `any`, reach for `unknown`, a generic, or a Zod schema instead.

```ts
// bad
function parse(data: any) { ... }

// good
function parse(data: unknown): MyType {
  return MySchema.parse(data);
}
```

All strict compiler flags are enabled in `tsconfig.json`:
- `strict: true` (covers noImplicitAny, strictNullChecks, etc.)
- `noUncheckedIndexedAccess: true`
- `noUnusedLocals: true`
- `noUnusedParameters: true`
- `noImplicitOverride: true`
- `noPropertyAccessFromIndexSignature: true`

### JSDoc

Add JSDoc to every exported function, class, type alias, and interface. Describe *why*, not *what* — the signature already says what. Internal helpers don't need JSDoc unless the behaviour is non-obvious.

```ts
/**
 * Fetches a user record by ID.
 * Returns undefined when the user does not exist rather than throwing.
 *
 * @param id - UUID of the user
 */
export async function getUserById(id: string): Promise<User | undefined> { ... }
```

### Zod — boundary enforcement

Everything that crosses a trust boundary **must** go through a Zod schema. Boundaries include:
- HTTP request bodies, query params, headers
- External API responses
- Environment variables (`lib/env.ts`)
- Configuration files (`lib/config.ts`)
- File / database reads where schema is not guaranteed
- WebSocket messages, MCP tool results

Define schemas in a collocated `*.schema.ts` file or alongside the route. Infer types from schemas — never duplicate them manually:

```ts
// user.schema.ts
import { z } from "zod";

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(["admin", "member"]),
});

export type User = z.infer<typeof UserSchema>;
```

Use `.parse()` when a bad value should throw (request handlers, startup). Use `.safeParse()` when you need to return structured feedback to a caller.

### Winston — logging

All logging goes through Winston. No `console.log`, `console.warn`, or `console.error` anywhere in production code. Import the shared logger instance from `lib/logger.ts`.

```ts
// lib/logger.ts
import winston from "winston";
import { getEnv } from "@/lib/env";

export const logger = winston.createLogger({
  level: getEnv().LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()],
});
```

Log levels: `error` for unrecoverable failures, `warn` for degraded-but-continuing states, `info` for significant lifecycle events, `debug` for developer tracing. Always pass structured metadata — never interpolate into the message string:

```ts
// bad
logger.info(`User ${userId} logged in`);

// good
logger.info("user.login", { userId });
```
