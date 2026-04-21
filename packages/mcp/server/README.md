# @june/mcp-server

The june MCP server. Registers tools over `@modelcontextprotocol/sdk`'s stdio
transport. Hono HTTP transport is planned but not yet wired.

## Tools

- `hello-world` — greeting smoke test.
- `embed` — calls the Ollama embedding model named in `config.yaml` and returns
  the raw `EmbedResponse` as JSON.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.2
- [Ollama](https://ollama.com) running somewhere reachable with the embedding
  model from `config.yaml` pulled (e.g. `nomic-embed-text`).

## Setup

```bash
cp .env.example .env
# adjust OLLAMA_URL / QDRANT_URL as needed
bun install
bun run src/index.ts
```

## Config

`config.yaml` holds the non-secret tunables parsed against `ConfigSchema`:

```yaml
mcp_server:
  name: june-mcp
  version: 0.1.0
ollama_embedding_model: nomic-embed-text
```
