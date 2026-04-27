<!-- author: Claude -->
# @june/mcp-ingest

June's ingestion pipeline: markdown → enriched, embedded chunks, persisted in Qdrant + SQLite. CLI-driven; one process per invocation.

#### AI Disclosure:
Benchmarking tool, ingestion pipeline, and ingestion pipeline database schema written entirely by Claude after 4 hours of planning and spec development.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.2
- [Ollama](https://ollama.com) running somewhere reachable; models pulled: embedder (e.g. `nomic-embed-text`), classifier + summarizer (e.g. `llama3.2:3b`).
- [Qdrant](https://qdrant.tech) running somewhere reachable.

## Environment

Copy `.env.example` → `.env` and fill in:

```bash
OLLAMA_URL=http://localhost:11434
QDRANT_URL=http://localhost:6333
OLLAMA_EMBED_MODEL=nomic-embed-text
OLLAMA_CLASSIFIER_MODEL=llama3.2:3b
OLLAMA_SUMMARIZER_MODEL=llama3.2:3b
# QDRANT_API_KEY=            # optional
# CONFIG_PATH=./config.yaml  # optional; defaults to discovery order (§29.2)
```

All five `OLLAMA_*` / `QDRANT_URL` vars are required — june hard-fails at startup if any is missing (I13).

## Config

Operational tunables (chunk sizes, retry policy, classifier fallbacks, etc.) live in `config.yaml`. Copy `config.example.yaml` → `config.yaml` and edit; or run with `--config <path>`. A fresh install with no `config.yaml` runs on shipped defaults.

## CLI

```bash
june init                                 # create Qdrant collections + apply SQLite DDL
june ingest ./docs                        # ingest a file or directory (recursive)
june status [<doc_id>]                    # read-only run + document status
june resume                               # replay non-terminal documents
june reindex <doc_id>                     # force full re-run for one doc
june purge <doc_id> [--all-versions] --yes
june reconcile [--dry-run] [--purge]      # detect vanished files + Qdrant orphans
june re-embed --embedding-model <name> --yes
june health
june bench <corpus-path>                  # throughput / latency harness (stubbed models)
```

Exit codes follow §27.3: `0` success, `1` fatal, `2` lock held, `3` health failed, `4` user aborted, `64` usage error.

## Programmatic API

The `june` CLI is one consumer; anything else in the workspace (the MCP server, tests, custom tooling) talks to the pipeline through the named exports of `@june/mcp-ingest` (re-exported from [`src/index.ts`](./src/index.ts)).

There are two pipeline entry points:

| Function | When to use |
| --- | --- |
| `ingestContent(opts)` | **Network-facing surfaces** (MCP tools, HTTP endpoints, anything that takes input from a model or external client). Caller hands over raw markdown bytes + a virtual URI; no filesystem read happens. |
| `ingestPath(opts)` | **Trusted callers only** — the `june` CLI, tests, scripts run by an operator. Reads from a filesystem path and would expose an arbitrary-file-read primitive if exposed to an untrusted client. |

If you're wiring this into the MCP server, reach for `ingestContent`. Pass the markdown along with a stable virtual URI like `mcp://session/<id>/<name>.md` so re-sending the same content is correctly recognized as unchanged on the second call.

### The 30-second version

```ts
import {
  loadConfig,
  installOfflineGuard,
  computeWhitelist,
  buildDeps,
  ingestContent,
  getEnv,
  createSilentReporter,
} from "@june/mcp-ingest";

const env = getEnv();
await loadConfig(env.CONFIG_PATH ?? "./config.yaml");
installOfflineGuard(computeWhitelist([env.OLLAMA_URL, env.QDRANT_URL]));
const deps = await buildDeps();

const result = await ingestContent({
  content: "# Hello\n\nSome markdown.",
  sourceUri: "mcp://session/abc123/hello.md",
  deps,
  trigger: "api",
  progress: createSilentReporter(),
});
// result.processed / result.skipped / result.errored
```

`buildDeps()` is heavy — it constructs Ollama clients, opens the SQLite sidecar, probes the embedder for its vector dimension, and ensures Qdrant collections + payload indexes. Build it **once per process** at startup and reuse the returned `PipelineDeps` for every ingest call.

### Required environment

The package's `getEnv()` validates these against a Zod schema on first call (`src/lib/env.ts`). Any missing required value throws synchronously — fail fast at boot.

| Var | Required | Purpose |
| --- | --- | --- |
| `OLLAMA_URL` | yes | Ollama HTTP endpoint. |
| `QDRANT_URL` | yes | Qdrant HTTP endpoint. |
| `OLLAMA_EMBED_MODEL` | yes | Embedding model name (must be pulled on the Ollama host). |
| `OLLAMA_CLASSIFIER_MODEL` | yes | Classifier model. |
| `OLLAMA_SUMMARIZER_MODEL` | yes | Summarizer model. |
| `QDRANT_API_KEY` | optional | For authenticated Qdrant deployments. |
| `CONFIG_PATH` | optional | Path to `config.yaml`. Pass directly to `loadConfig` if you'd rather not use this var. |

The schema also inherits `NODE_ENV`, `LOG_LEVEL`, and `CONFIG_PATH` from `BaseEnvSchema` in `@june/shared`. A consumer that defines its own env schema via `BaseEnvSchema.extend({...})` only needs to add the five `OLLAMA_*` / `QDRANT_*` fields above (plus the optional pair) — the base fields are already present.

### Bootstrap order

The order in the §30-second snippet matters; do not reorder:

1. **`getEnv()`** — every later step depends on validated env.
2. **`loadConfig(path)`** — `buildDeps()` reads `getConfig()` to choose between Ollama and stub summarizer implementations and to find the SQLite path.
3. **`installOfflineGuard(computeWhitelist([...]))`** — wraps `globalThis.fetch` so the package can only reach Ollama and Qdrant. This is the privacy guarantee (I10 in the spec). Skip this only if your process needs to make outbound HTTP calls of its own — but then you've broken the offline invariant for the whole workspace, so think twice.
4. **`buildDeps()`** — last; constructs Ollama clients, opens SQLite, ensures Qdrant collections.

### `ingestContent` — preferred for MCP / HTTP

Defined at [`src/pipeline/ingest.ts`](./src/pipeline/ingest.ts).

```ts
ingestContent(opts: IngestContentOptions): Promise<IngestResult>
```

`IngestContentOptions`:

| Field | Type | Notes |
| --- | --- | --- |
| `content` | `string \| Uint8Array` | The markdown. Strings are UTF-8 encoded internally. |
| `sourceUri` | `string` | Caller-supplied virtual URI. Participates in `doc_id` derivation, so the same URI + same content will dedupe on re-call. **Never opened as a file** — pick any stable scheme that fits your namespace (e.g. `mcp://session/<id>/<name>.md`). The pipeline does not validate this against a URI grammar; passing garbage produces a junk doc_id but no security risk. |
| `deps` | `PipelineDeps` | Value returned by `buildDeps()`. |
| `force` | `boolean?` | Re-ingest even if the content hash matches what's already stored. Default `false`. |
| `runId` | `RunId?` | Opaque ULID; auto-generated if omitted. |
| `cliVersion` | `Version?` | Per-run version label persisted with the run row. |
| `trigger` | `RunTrigger?` | One of `"cli" \| "api" \| "reconcile" \| "re-embed" \| "init"` (`src/types/vocab.ts`). Defaults to `"api"` for `ingestContent` (vs `"cli"` for `ingestPath`). |
| `progress` | `ProgressReporter?` | Pass `createSilentReporter()` for non-TTY callers. The default reporter writes a line per stage to stderr. |
| `source_modified_at` | `string?` | Optional ISO-8601 timestamp recorded with the document row. |

Returns the same `IngestResult` shape as `ingestPath` (see below); for a single-doc call exactly one of `processed` / `skipped` / `errored` is `1`.

#### Security note

`ingestContent` is the entry point that's safe to expose to a model. It performs no filesystem I/O during ingestion — the content is taken straight from the caller, and the `sourceUri` is treated as an opaque identifier (`deriveDocId` hashes it; `bindingFor` does a config-`sources` prefix match on it; nothing else reads or resolves it).

`ingestPath`, by contrast, accepts an arbitrary path and reads it. Exposing it through an MCP tool would let any caller exfiltrate the contents of any file the server can read.

### `ingestPath` — for trusted callers

Defined at [`src/pipeline/ingest.ts`](./src/pipeline/ingest.ts).

```ts
ingestPath(opts: IngestOptions): Promise<IngestResult>
```

`IngestOptions`:

| Field | Type | Notes |
| --- | --- | --- |
| `path` | `string` | File or directory. Directories are walked recursively; only `.md` and `.markdown` files are picked up. |
| `deps` | `PipelineDeps` | Value returned by `buildDeps()`. |
| `force` | `boolean?` | Re-ingest even if the content hash matches what's already stored. Default `false`. |
| `runId` | `RunId?` | Opaque ULID; auto-generated if omitted. |
| `cliVersion` | `Version?` | Per-run version label persisted with the run row. |
| `trigger` | `RunTrigger?` | One of `"cli" \| "api" \| "reconcile" \| "re-embed" \| "init"`. Default `"cli"`. |
| `progress` | `ProgressReporter?` | Pass `createSilentReporter()` for non-TTY callers. |

Use this in the `june` CLI, in tests, and in operator-run scripts — never in tool surfaces exposed to a model.

### `IngestResult` (both entry points)

```ts
type IngestResult = {
  run: IngestionRun;     // run_id, started_at, completed_at, trigger, counters
  processed: number;     // newly ingested docs
  skipped: number;       // unchanged hash, oversize, or empty
  errored: number;       // per-doc failures; details in the SQLite sidecar
};
```

### Concurrency

Both `ingestContent` and `ingestPath` acquire the SQLite single-writer lock for the duration of the call and start a heartbeat. A second concurrent call from anywhere — another tool invocation, the CLI in a separate process, a test — throws `SidecarLockHeldError`. The caller does not need to serialize itself, but does need to handle that error (see below). For an MCP server that may receive bursts of `ingestContent` calls, the right pattern is a mutex or queue at the tool layer so callers see "busy, please retry" instead of a hard error.

### Errors a caller must handle

Every class below is exported from `@june/mcp-ingest`. Recommend `instanceof` checks; let anything else propagate.

| Error | When | Caller response |
| --- | --- | --- |
| `SidecarLockHeldError` | Another ingest is running. | Surface as "busy"; safe to retry later. |
| `FileTooLargeError` | Input exceeds `ingest.max_file_bytes` from `config.yaml` (applies to both file and content callers). | Tell the caller to split the input or raise the limit. |
| `OllamaUnavailableError` | Ollama is unreachable. | Infrastructure error — surface and back off. |
| `OllamaTimeoutError` | Ollama call exceeded the configured timeout. | Same as above. |
| `OllamaModelNotFoundError` | A configured model isn't pulled on the Ollama host. | Tell the operator to `ollama pull <model>`. |
| `QdrantWriteError` | Qdrant rejected a write. | Infrastructure error. |
| `EncodingDetectionError` / `ParseError` | Markdown is malformed or non-UTF-8. | Per-doc failure; for `ingestPath` directory calls, other docs may have succeeded — read `result.errored`. |
| `EmbeddingDimensionMismatchError` | Embedder returned a different vector size than the existing Qdrant collection expects. | Operator must run `june re-embed` or recreate the collection. |
| `ChunkOverflowError` | Internal chunker invariant violated. | Bug — file an issue. |
| `OfflineWhitelistViolation` | A code path attempted a fetch to a non-whitelisted URL. | Bug — investigate. |
| `PromptTemplateError` | Prompt template missing or malformed. | Misconfiguration / packaging bug. |

### Health probe

`health(): Promise<HealthReport>` (`src/pipeline/health.ts`) checks SQLite, Qdrant, and Ollama reachability. Useful as a tool-side liveness probe before forwarding the first ingest call.

```ts
type HealthReport = {
  ok: boolean;
  sqlite: boolean;
  qdrant: boolean;
  ollama: boolean;
  errors: ReadonlyArray<string>;
};
```

`health` requires the same bootstrap (`getEnv` + `loadConfig`) as `ingestPath`, but does **not** require `buildDeps`.

### Config

`loadConfig` accepts any path string. Two patterns:

- **Default discovery:** set `CONFIG_PATH` env var, then `loadConfig(getEnv().CONFIG_PATH)`.
- **Explicit:** `loadConfig("./somewhere/config.yaml")` — useful for tests, hot-reload, or multi-tenant setups. The function always overwrites the cached value, so calling it again is safe.

The schema is enforced by Zod; see `config.example.yaml` for the full set of tunables and the `## Config` section above for the high-level rules.

### Where to look in the source

- Public surface — [`src/index.ts`](./src/index.ts)
- Pipeline orchestrator — [`src/pipeline/ingest.ts`](./src/pipeline/ingest.ts)
- Dependency factory — [`src/pipeline/factory.ts`](./src/pipeline/factory.ts)
- Env / config singletons — [`src/lib/env.ts`](./src/lib/env.ts), [`src/lib/config.ts`](./src/lib/config.ts)
- Errors — [`src/lib/errors.ts`](./src/lib/errors.ts), [`src/lib/error-types.ts`](./src/lib/error-types.ts)
- Trigger / status vocabularies — [`src/types/vocab.ts`](./src/types/vocab.ts)
- Spec (load-bearing) — [`.claude/plans/INGESTION_PIPELINE_SPEC.md`](../../../.claude/plans/INGESTION_PIPELINE_SPEC.md)

## Architecture

- `src/pipeline/stages/01-discover.ts` … `10-store.ts` — one file per stage.
- `src/lib/{parser,chunker,classifier,summarizer,embedder,storage}/` — swappable backends behind typed interfaces.
- `src/pipeline/ingest.ts` — orchestrator (stages 1 → 10 per doc).
- `src/lib/{env,config,logger,errors,error-types,offline-guard,lock,shutdown,progress,ids,encoding,tokenize,retry}.ts` — shared primitives.
- `cli/*.ts` — thin argv wrappers around the public API in `src/index.ts`.

### Operational surfaces (Part IV)

- `src/lib/error-types.ts` — canonical `error_type` vocabulary (§25.6); `IngestionError.error_type` is narrowed to this union.
- `src/lib/shutdown.ts` — SIGINT/SIGTERM handlers flip a process-level flag; pipeline workers drain at stage boundaries (§24.5 / I8).
- `src/lib/progress.ts` — stderr progress reporter with rolling-average ETA after 5 docs (§27.4). `--quiet` / `--json-log` swap in a silent reporter.
- `resumeRun` accepts an `embedder` to run the §24.6 mismatch check; persists `embedding_model_mismatch_count` on the result without re-embedding automatically.

Full spec: [`.claude/plan/SPEC.md`](../../.claude/plan/SPEC.md) (4300 lines; load-bearing).

## Tests

```bash
bun test
```

Covers §37 invariants: chunker structural invariants, idempotency, encoding normalization, lock/heartbeat, offline whitelist enforcement, typed logger, end-to-end pipeline with stub model backends.

## Running one-off

```bash
bun run cli/june.ts ingest ./some-docs --config ./config.yaml
```

The `june` bin is declared in `package.json`; `bun link` from this directory makes `june` available globally.
