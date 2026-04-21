// author: Claude
import { afterEach, describe, expect, test } from "bun:test";
import { ERROR_TYPE_VALUES, isErrorType } from "@/lib/error-types";
import {
  _resetShutdown,
  installSignalHandlers,
  isShutdownRequested,
  requestShutdown,
  signalReceived,
} from "@/lib/shutdown";
import {
  createProgressReporter,
  createSilentReporter,
} from "@/lib/progress";

/**
 * Part IV coverage:
 *   [§25.6](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#256-error-type-vocabulary) canonical error-type vocabulary
 *   [§24.5](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#245-graceful-shutdown-per-i8) / I8 SIGINT/SIGTERM graceful shutdown
 *   [§27.4](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#274-progress-output) progress output
 */

describe("Error-type vocabulary (§25.6)", () => {
  test("includes all stage families", () => {
    // Spot-check representatives from every stage bucket.
    expect(ERROR_TYPE_VALUES).toContain("file_too_large");
    expect(ERROR_TYPE_VALUES).toContain("encoding_undetectable");
    expect(ERROR_TYPE_VALUES).toContain("mdast_parse_failed");
    expect(ERROR_TYPE_VALUES).toContain("classifier_invalid_json");
    expect(ERROR_TYPE_VALUES).toContain("classifier_fallback");
    expect(ERROR_TYPE_VALUES).toContain("summarizer_unreachable");
    expect(ERROR_TYPE_VALUES).toContain("embed_text_truncated");
    expect(ERROR_TYPE_VALUES).toContain("embedder_dimension_mismatch");
    expect(ERROR_TYPE_VALUES).toContain("qdrant_dimension_mismatch");
    expect(ERROR_TYPE_VALUES).toContain("sqlite_busy");
    expect(ERROR_TYPE_VALUES).toContain("shutdown_during_stage");
    expect(ERROR_TYPE_VALUES).toContain("lock_broken_stale");
    expect(ERROR_TYPE_VALUES).toContain("embedding_model_mismatch");
    expect(ERROR_TYPE_VALUES).toContain("catastrophic");
  });

  test("isErrorType narrows string → ErrorType", () => {
    expect(isErrorType("file_too_large")).toBe(true);
    expect(isErrorType("not-a-known-type")).toBe(false);
  });
});

describe("Graceful shutdown (§24.5 / I8)", () => {
  afterEach(() => {
    _resetShutdown();
  });

  test("isShutdownRequested starts false", () => {
    expect(isShutdownRequested()).toBe(false);
    expect(signalReceived()).toBeUndefined();
  });

  test("requestShutdown flips the flag and records signal", () => {
    requestShutdown("SIGINT");
    expect(isShutdownRequested()).toBe(true);
    expect(signalReceived()).toBe("SIGINT");
  });

  test("installSignalHandlers registers handlers that flip the flag", () => {
    const restore = installSignalHandlers();
    try {
      process.emit("SIGTERM");
      expect(isShutdownRequested()).toBe(true);
      expect(signalReceived()).toBe("SIGTERM");
    } finally {
      restore();
    }
  });

  test("requestShutdown is idempotent — second signal ignored", () => {
    requestShutdown("SIGINT");
    requestShutdown("SIGTERM");
    expect(signalReceived()).toBe("SIGINT");
  });
});

describe("Progress reporter (§27.4)", () => {
  test("silent reporter exposes the full surface as no-ops", () => {
    const r = createSilentReporter();
    r.start(10);
    r.tick("file:///x.md", "parsed");
    r.doc_done("file:///x.md", 42);
    r.doc_skipped("file:///x.md", "skipped_empty");
    r.doc_errored("file:///x.md", "boom");
    r.close();
    expect(true).toBe(true);
  });

  test("default reporter writes to stderr without throwing", () => {
    const r = createProgressReporter();
    r.start(2);
    r.tick("file:///a.md", "parsed");
    r.tick("file:///a.md", "chunked", "3 chunks");
    r.doc_done("file:///a.md", 100);
    r.tick("file:///b.md", "parsed");
    r.doc_done("file:///b.md", 120);
    r.close();
    expect(true).toBe(true);
  });
});
