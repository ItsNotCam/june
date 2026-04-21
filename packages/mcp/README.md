# packages/mcp/

Umbrella directory for the three MCP-related workspace packages. `packages/mcp/`
itself has no `package.json` — it's just a container.

| Package            | Directory    | Purpose                                                                       |
| ------------------ | ------------ | ----------------------------------------------------------------------------- |
| `@june/mcp-ingest` | `./ingest/`  | Markdown ingestion pipeline, its `june` CLI, and the pipeline perf benchmark. |
| `@june/mcp-bench`  | `./bench/`   | Synthetic-corpus RAG-quality evaluation harness (`june-eval` CLI).            |
| `@june/mcp-server` | `./server/`  | MCP JSON-RPC server (scaffold — exposes ingest as MCP tools, TBD).            |

Each is an independent workspace member with its own `package.json`, `tsconfig.json`,
dependencies, and tests. `@june/mcp-server` depends on `@june/mcp-ingest` and will
serve the MCP protocol over HTTP via Hono.
