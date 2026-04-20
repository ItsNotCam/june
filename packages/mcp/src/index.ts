/**
 * Public surface of the june ingestion-pipeline package ([§32.2](../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#322-public-exports)).
 *
 * CLI commands live under `cli/`; every other consumer imports from here.
 * Internal modules (specific stage implementations, SQLite queries, Ollama
 * HTTP shims) are not re-exported — if something needs to reach them, extend
 * this surface deliberately.
 */

// Types — records
export type {
  Chunk,
  ChunkClassification,
  ChunkRelationships,
  ChunkRuntimeSignals,
  ChunkSpan,
  ChunkStructuralFeatures,
  ChunkedDocument,
  ClassifierOutput,
  Document,
  EmbeddingResult,
  IngestionError,
  IngestionRun,
  ParsedDocument,
  ReconcileEvent,
  Section,
  SummarizerOutput,
  TypeSpecific,
  UnclassifiedChunk,
} from "@/types";

// Branded IDs + constructors
export { InvalidIdError } from "@/types";
export type { ChunkId, DocId, RunId, SectionId, Version } from "@/types";
export { asChunkId, asDocId, asRunId, asSectionId, asVersion } from "@/types";

// Vocabularies
export {
  ANSWER_SHAPE_VALUES,
  AUDIENCE_VALUES,
  CATEGORY_TO_FRESHNESS_DECAY,
  CATEGORY_VALUES,
  CHUNK_STATUS_VALUES,
  CONTENT_TYPE_VALUES,
  DOCUMENT_STATUS_VALUES,
  FRESHNESS_DECAY_VALUES,
  INGEST_STAGE_VALUES,
  LIFECYCLE_VALUES,
  RECONCILE_EVENT_TYPE_VALUES,
  RECONCILE_REASON_VALUES,
  RUN_TRIGGER_VALUES,
  SECTION_ROLE_VALUES,
  SENSITIVITY_VALUES,
  SOURCE_SYSTEM_TO_AUTHORITY_SCORE,
  SOURCE_SYSTEM_TO_SOURCE_TYPE,
  SOURCE_SYSTEM_VALUES,
  SOURCE_TYPE_VALUES,
  STABILITY_VALUES,
  TAGS_DEFAULT,
  TEMPORAL_VALUES,
  TRUST_TIER_VALUES,
} from "@/types";
export type {
  AnswerShape,
  Audience,
  Category,
  ChunkStatus,
  ContentType,
  DocumentStatus,
  FreshnessDecay,
  IngestStage,
  LifecycleStatus,
  ReconcileEventType,
  ReconcileReason,
  RunTrigger,
  SectionRole,
  Sensitivity,
  SourceSystem,
  SourceTrustTier,
  SourceType,
  Stability,
  TemporalScope,
} from "@/types";

// Schemas
export {
  ChunkSchema,
  ClassifierOutputSchema,
  DocumentOutlineSchema,
  DocumentSchema,
  FrontmatterSchema,
  SectionSchema,
  type ChunkJson,
  type ClassifierOutputJson,
  type DocumentJson,
  type DocumentOutline,
  type Frontmatter,
  type SectionJson,
} from "@/schemas";

// Errors (callers `instanceof`-check)
export {
  ChunkOverflowError,
  ClassifierJsonError,
  EmbeddingDimensionMismatchError,
  EncodingDetectionError,
  FileTooLargeError,
  OfflineWhitelistViolation,
  OllamaModelNotFoundError,
  OllamaTimeoutError,
  OllamaUnavailableError,
  ParseError,
  QdrantWriteError,
  SidecarLockHeldError,
} from "@/lib/errors";

// Canonical error_type vocabulary ([§25.6](../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#256-error-type-vocabulary))
export { ERROR_TYPE_VALUES, isErrorType, type ErrorType } from "@/lib/error-types";

// Config + env (singletons; callers that need to read go through these)
export { getEnv, type Env } from "@/lib/env";
export { getConfig, loadConfig, type Config } from "@/lib/config";

// Storage — types are exported so consumers can build their own adapters
export type {
  SidecarStorage,
  StorageInterface,
  Tx,
  VectorPoint,
  VectorStorage,
} from "@/lib/storage/types";
export { createQdrantStorage, baseCollectionName } from "@/lib/storage/qdrant";

// Offline guard
export { computeWhitelist, installOfflineGuard, verifyOffline } from "@/lib/offline-guard";

// Graceful shutdown ([§24.5](../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#245-graceful-shutdown-per-i8) / I8)
export {
  installSignalHandlers,
  isShutdownRequested,
  requestShutdown,
  signalReceived,
} from "@/lib/shutdown";

// Progress reporter ([§27.4](../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#274-progress-output))
export {
  createProgressReporter,
  createSilentReporter,
  type ProgressReporter,
  type Stage as ProgressStage,
} from "@/lib/progress";

// Logger type (value is module-scoped; callers inside the package import it directly)
export type { LogFields, Logger } from "@/lib/logger";

// Programmatic CLI entry point — same argv interface as the `june` binary
export { runCli } from "../cli/june";

// ID derivation
export {
  chunkIdToQdrantPointId,
  deriveChunkId,
  deriveContentHash,
  deriveContentHashBytes,
  deriveDocId,
  deriveSectionId,
} from "@/lib/ids";

// Embedder interface (implementation factories land in Part III; v1 ships Ollama only)
export type { Embedder } from "@/lib/embedder/types";
export { createOllamaEmbedder } from "@/lib/embedder/ollama";

// Health probe
export { health, type HealthReport } from "@/pipeline/health";

// Pipeline entry points
export { ingestPath, type IngestOptions, type IngestResult } from "@/pipeline/ingest";
export { resumeRun, type ResumeOptions, type ResumeResult } from "@/pipeline/resume";
export { reconcile, type ReconcileOptions, type ReconcileResult } from "@/pipeline/reconcile";
export { reembed, type ReembedOptions, type ReembedResult } from "@/pipeline/reembed";
export { purge, type PurgeOptions, type PurgeResult } from "@/pipeline/purge";
export { buildDeps, type PipelineDeps, type PipelineOptions } from "@/pipeline/factory";

// SQLite sidecar factory (Qdrant factory already exported above)
export { createSqliteSidecar } from "@/lib/storage/sqlite";

// Classifier + summarizer + embedder factories (Ollama prod, stub for tests)
export { createOllamaClassifier } from "@/lib/classifier/ollama";
export { createStubClassifier } from "@/lib/classifier/stub";
export { createOllamaSummarizer } from "@/lib/summarizer/ollama";
export { createStubSummarizer } from "@/lib/summarizer/stub";
export { createStubEmbedder } from "@/lib/embedder/stub";

// Interfaces
export type { Classifier, ClassifierInput } from "@/lib/classifier/types";
export type { Summarizer, SummarizerInput } from "@/lib/summarizer/types";
