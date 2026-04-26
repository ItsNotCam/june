// author: Claude
/**
 * Typed error classes used across the pipeline.
 *
 * Per CLAUDE.md, each distinct domain failure mode gets its own class so
 * callers can `instanceof`-check reliably. [§30.6](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#306-errors) lists the full taxonomy.
 * `InvalidIdError` lives in `src/types/ids.ts` to avoid a runtime cycle with
 * the branded ID constructors.
 */

import type { ChunkId, RunId, SectionId } from "@/types/ids";

/**
 * Stage 2 encoding detection failed (BOM absent, UTF-8 strict decode threw,
 * and the Windows-1252 fallback also threw). Terminal for the document.
 */
export class EncodingDetectionError extends Error {
  constructor(readonly source_uri: string) {
    super(`Could not detect encoding for ${source_uri}`);
    this.name = "EncodingDetectionError";
  }
}

/** Stage 2 mdast parse threw. Very rare given mdast's tolerance; terminal for the document. */
export class ParseError extends Error {
  constructor(
    readonly source_uri: string,
    readonly cause_message: string,
  ) {
    super(`Failed to parse markdown at ${source_uri}: ${cause_message}`);
    this.name = "ParseError";
  }
}

/**
 * Stage 3 produced a chunk over the hard ceiling after all splitter options
 * exhausted. Typically an oversize protected region ([§16.2](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#162-within-section-chunking-3b--the-recursive-overflow-splitter)).
 */
export class ChunkOverflowError extends Error {
  constructor(
    readonly section_id: SectionId,
    readonly token_count: number,
  ) {
    super(`Chunk in section ${section_id} exceeds hard ceiling: ${token_count} tokens`);
    this.name = "ChunkOverflowError";
  }
}

/** Ollama host unreachable after max retries ([§25.3](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#253-ollama-failure-modes-dedicated-subsection)). Document stalls at its current status; resume retries. */
export class OllamaUnavailableError extends Error {
  constructor(
    readonly url: string,
    readonly attempts: number,
  ) {
    super(`Ollama unreachable at ${url} after ${attempts} attempts`);
    this.name = "OllamaUnavailableError";
  }
}

/** Ollama call exceeded timeout ([§25.3](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#253-ollama-failure-modes-dedicated-subsection)). Retryable per the service's backoff schedule. */
export class OllamaTimeoutError extends Error {
  constructor(
    readonly url: string,
    readonly timeout_ms: number,
  ) {
    super(`Ollama call timed out at ${url} after ${timeout_ms}ms`);
    this.name = "OllamaTimeoutError";
  }
}

/** Ollama responded 404 for the model tag. Fatal-fast ([§25.3](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#253-ollama-failure-modes-dedicated-subsection)). */
export class OllamaModelNotFoundError extends Error {
  constructor(readonly model: string) {
    super(`Ollama model '${model}' not found. Run 'ollama pull ${model}' on the Ollama host.`);
    this.name = "OllamaModelNotFoundError";
  }
}

/**
 * Classifier returned output that could not be parsed or validated against
 * `ClassifierOutputSchema`. Triggers the fallback path ([§18.6](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#186-failure-handling-and-fallbacks)).
 */
export class ClassifierJsonError extends Error {
  constructor(
    readonly chunk_id: ChunkId,
    readonly raw_preview: string,
  ) {
    super(`Classifier returned invalid JSON for chunk ${chunk_id}`);
    this.name = "ClassifierJsonError";
  }
}

/** Qdrant upsert / setPayload / delete failed. May be transient (retryable) or fatal (validation). */
export class QdrantWriteError extends Error {
  constructor(
    readonly chunk_ids: ReadonlyArray<ChunkId>,
    readonly cause_message: string,
  ) {
    super(`Qdrant upsert failed for ${chunk_ids.length} chunks: ${cause_message}`);
    this.name = "QdrantWriteError";
  }
}

/**
 * Another ingest run holds the single-writer lock and its heartbeat is fresh.
 * CLI exits code 2 ([§27.3](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#273-exit-codes)).
 */
export class SidecarLockHeldError extends Error {
  constructor(
    readonly held_by_run: RunId,
    readonly heartbeat_age_s: number,
  ) {
    super(`Sidecar lock held by run ${held_by_run} (heartbeat age: ${heartbeat_age_s}s)`);
    this.name = "SidecarLockHeldError";
  }
}

/**
 * Outbound connection attempted to a host outside the startup-computed
 * whitelist ([§25.5](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#255-offline-invariant-enforcement)). The offline guard throws this at the call site so the
 * violation surfaces architecturally rather than in an audit log.
 */
export class OfflineWhitelistViolation extends Error {
  constructor(
    readonly attempted_host: string,
    readonly whitelist: ReadonlyArray<string>,
  ) {
    super(
      `Outbound connection to '${attempted_host}' is not in offline whitelist: ${whitelist.join(", ")}`,
    );
    this.name = "OfflineWhitelistViolation";
  }
}

/** File larger than `config.ingest.max_file_bytes` ([§14.3](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#143-reading-bytes)). Document is not ingested. */
export class FileTooLargeError extends Error {
  constructor(
    readonly source_uri: string,
    readonly bytes: number,
    readonly limit: number,
  ) {
    super(`File too large: ${source_uri} (${bytes} bytes, limit ${limit})`);
    this.name = "FileTooLargeError";
  }
}

/** Embedding dimension doesn't match the Qdrant collection's configured size. Fatal-fast ([§22.2](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#222-retry-timeout-and-ollama-specific-behavior)). */
export class EmbeddingDimensionMismatchError extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`Embedding dimension mismatch: collection expects ${expected}, model returned ${actual}`);
    this.name = "EmbeddingDimensionMismatchError";
  }
}

/**
 * `renderPrompt(name, vars)` was called with a template that has `{{key}}`
 * placeholders for which no value was supplied. Throwing fails loud rather
 * than letting `{{unfilled}}` leak into the LLM context.
 */
export class PromptTemplateError extends Error {
  constructor(
    readonly template_name: string,
    readonly unfilled_keys: ReadonlyArray<string>,
  ) {
    super(
      `Prompt template '${template_name}' has unfilled placeholders: ${unfilled_keys.join(", ")}`,
    );
    this.name = "PromptTemplateError";
  }
}
