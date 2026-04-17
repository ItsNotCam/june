# @june/mcp

MCP (Model Context Protocol) server for the June project. Runs over stdio and exposes tools to MCP clients.

## Tools

| Tool | Description |
|---|---|
| `hello-world` | Smoke-test tool — takes a name and returns a greeting. |
| `embed` | Embeds a string using the configured Ollama model and returns the raw embedding as JSON. |

## Configuration

The server reads a YAML config file at the path specified by `CONFIG_PATH`. Required fields:

```yaml
mcp_server:
  name: june-mcp
  version: 0.1.0

ollama_embedding_model: nomic-embed-text
```

See [src/config.ts](src/config.ts) for the full schema.

## Environment variables

| Variable | Description |
|---|---|
| `CONFIG_PATH` | Path to the YAML config file |
| `OLLAMA_URL` | Base URL of the Ollama instance |
| `NODE_ENV` | `development` \| `production` \| `test` (default: `development`) |
| `LOG_LEVEL` | Winston log level (default: `info`) |

## Running

```bash
bun run src/index.ts
```
