# @june/mcp-server

The june MCP server. Registers tools over `@modelcontextprotocol/sdk`'s stdio
transport. Hono HTTP transport is planned but not yet wired.

It wraps the `@june/mcp-ingest` pipeline: the MCP client (e.g. Claude) issues
tool calls, the server runs retrieval/ingestion against Qdrant + Ollama, and
returns the results **raw**. The server does not synthesize answers — the
calling model is the reader.

## Tools

- `search` — hybrid semantic + keyword retrieval (dense + BM25 → RRF) over the
  ingested corpus. Returns the top-k chunks as raw content + citation metadata +
  relevance score. Args: `query` (string), `k` (optional int).
- `ingest` — chunk, embed, and store a markdown document so it becomes
  searchable. Args: `content` (markdown), `sourceUri` (stable virtual URI, not a
  filesystem path). Calls are serialized server-side to respect the pipeline's
  single-writer lock. Returns a run summary.
- `health` — probe reachability of the SQLite sidecar, Qdrant, and Ollama.
- `hello-world` — greeting smoke test.
- `embed` — calls the Ollama embedding model named in `config.yaml` and returns
  the raw `EmbedResponse` as JSON.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.2
- [Ollama](https://ollama.com) reachable, with the ingest models pulled
  (`OLLAMA_EMBED_MODEL`, `OLLAMA_CLASSIFIER_MODEL`, `OLLAMA_SUMMARIZER_MODEL`).
- [Qdrant](https://qdrant.tech) reachable and initialized by `june init`
  (from `@june/mcp-ingest`). `search` returns nothing until documents are
  ingested — via the `ingest` tool or the `june` CLI.

`OLLAMA_EMBED_MODEL` **must** match the model used at ingest time, or query and
document vectors won't line up and recall collapses.

## Setup

```bash
cp .env.example .env
# set OLLAMA_URL / QDRANT_URL and the ingest model vars (see .env.example)
bun install
bun run src/index.ts
```

On startup the server loads `@june/mcp-ingest`'s config and builds the pipeline
deps once (`buildDeps()`). That makes a live Ollama probe, so it fails fast with
a clear error if Ollama/Qdrant are unreachable.

## Config

`config.yaml` holds the server's own non-secret tunables (MCP identity + the
demo `embed` tool's model):

```yaml
mcp_server:
  name: june-mcp
  version: 0.1.0
ollama_embedding_model: nomic-embed-text
```

Retrieval tunables (`default_k`, `dense_weight`, `bm25_weight`, `rank_constant`,
`query_prefix`, `collections`) live in **`@june/mcp-ingest`'s** config under the
`retrieval:` block, loaded from `INGEST_CONFIG_PATH`.
