// author: Claude
import { expect, test } from "bun:test";
import { logger } from "@/lib/logger";

/**
 * Compile-time enforcement of I7: the logger interface forbids raw-content
 * fields at the type layer ([§26.2](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#262-the-type-level-content-block-per-i7), [§37.8](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#378-type-level-content-block-i7)).
 *
 * The `@ts-expect-error` directives below assert that these calls FAIL
 * typechecking. If any of them ever compiles clean, the directive itself
 * becomes an error — which is the tripwire. A runtime test would be too
 * late; this is the tripwire at build time.
 */

test("logger forbids `content` field (I7)", () => {
  // @ts-expect-error — I7: 'content' is not a permitted LogFields key
  logger.info("bad", { content: "raw markdown should never reach here" });
  expect(true).toBe(true);
});

test("logger forbids `text` field (I7)", () => {
  // @ts-expect-error — I7: 'text' is not a permitted LogFields key
  logger.info("bad", { text: "raw chunk body" });
  expect(true).toBe(true);
});

test("logger forbids `body` field (I7)", () => {
  // @ts-expect-error — I7: 'body' is not a permitted LogFields key
  logger.warn("bad", { body: "raw document body" });
  expect(true).toBe(true);
});

test("logger forbids `markdown` field (I7)", () => {
  // @ts-expect-error — I7: 'markdown' is not a permitted LogFields key
  logger.error("bad", { markdown: "# Header\n\nparagraph" });
  expect(true).toBe(true);
});

test("logger forbids `chunk` field (I7)", () => {
  // @ts-expect-error — I7: 'chunk' is not a permitted LogFields key
  logger.debug("bad", { chunk: { content: "anything" } });
  expect(true).toBe(true);
});

test("logger accepts permitted keys", () => {
  logger.info("doc.ingested", {
    doc_id: "a".repeat(64),
    chunk_id: "b".repeat(64),
    stage: "1",
    duration_ms: 42,
    error_type: "none",
  });
  expect(true).toBe(true);
});
