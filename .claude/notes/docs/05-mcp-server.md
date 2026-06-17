---
title: MCP Server — @june/mcp-server
type: reference
status: active
tags: [project/june, area/research, tech/mcp]
project: june
area: research
created: 2026-06-17
summary: MCP server that will expose june's ingestion pipeline as tools — currently a stdio scaffold with demo tools.
keywords: [mcp server, model context protocol, stdio, scaffold, tools, alpha]
aliases: [mcp-server]
---

# MCP Server — `@june/mcp-server`

> The Model Context Protocol server that will expose june's ingestion pipeline as MCP
> tools. **Currently a working scaffold** — stdio transport with two demo tools. The
> pipeline integration and HTTP transport are designed but not yet wired.

Status: **v0.1.0, alpha.** Track its intended shape against
[02 — Ingestion pipeline](./02-ingestion-pipeline.md) §6 (programmatic entry points).

---

## 1. What's implemented

The server (`src/index.ts`) uses the **`@modelcontextprotocol/sdk`** over **stdio**:

```ts
const server = new McpServer(config.mcp_server);

const register = <T extends ZodRawShape>(tool: McpTool<T>) =>
  server.registerTool(tool.name, tool.tool_definition, tool.function);

register(createHelloTool());
register(createEmbedTool(config, env));

const transport = new StdioServerTransport();
await server.connect(transport);
```

**Two tools, both functional:**

- **`hello-world`** (`src/tools/hello.ts`) — input `{ name }`, returns a greeting.
  Smoke test.
- **`embed`** (`src/tools/embed.ts`) — input `{ input }`, calls Ollama
  (`config.ollama_embedding_model`, e.g. `nomic-embed-text`) via the thin wrapper in
  `src/lib/ollama.ts`, returns the raw `EmbedResponse` JSON.

**Config & env** follow the shared factory pattern ([06 — Shared layer](./06-shared-and-conventions.md)):

- `src/config.ts` validates `mcp_server.{name,version}` (semver, optional letter
  suffix like `0.1.0a`) and `ollama_embedding_model`.
- `src/env.ts` extends `BaseEnvSchema` with required `QDRANT_URL` + `OLLAMA_URL`.

**Tool typing** (`src/types.ts`): `McpTool<TInput> = { name, tool_definition, function }`
gives every tool a uniform, Zod-typed registration shape. Tool factories capture
`config`/`env` in a closure (DI without globals).

---

## 2. What's scaffold / TODO

- **HTTP / Hono transport** — planned ("Hono HTTP + JSON-RPC"), not wired. No Hono
  dependency, no routes. Only stdio is live today.
- **Pipeline integration** — `@june/mcp-ingest` is a declared `workspace:*` dependency
  but **no ingest entry point is exposed as a tool yet**. The intended wiring: an
  `ingestContent` tool that accepts markdown + a virtual URI
  (`mcp://session/<id>/<name>.md`) and calls
  [`ingestContent(opts)`](./02-ingestion-pipeline.md#6-dependency-injection) — the
  string-input, no-filesystem-I/O entry point that's safe for untrusted callers.
  (`ingestPath` must **not** be exposed — it reads arbitrary file paths.) Likely
  further tools: `health`, and read-only retrieval once `june` ships a retrieval API.

| Component | Status |
|---|---|
| MCP stdio transport | ✅ working |
| `hello-world`, `embed` tools | ✅ working |
| Config / env / Ollama client | ✅ working |
| Dockerfile.dev (watch mode) | ✅ working |
| HTTP / Hono / JSON-RPC | ❌ planned |
| `@june/mcp-ingest` tools | ❌ scaffold (dep declared, unused) |

---

## 3. `packages/server` (note)

`packages/server/` is an **empty placeholder** — caught by the `packages/*` workspace
glob but with no `package.json` and no files. It is *not* the MCP server (that's
`packages/mcp/server`). Reserved for future use.

---

## 4. Dependencies

`@modelcontextprotocol/sdk ^1.29.0`, `@june/mcp-ingest` (workspace, unused so far),
`@june/shared` (config/env/logger), `ollama ^0.6.3`, `zod ^4.3.6`. Bun runtime,
`bun run --watch src/index.ts` in dev.
