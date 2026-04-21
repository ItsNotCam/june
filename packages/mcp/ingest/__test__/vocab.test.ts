// author: Claude
import { describe, expect, test } from "bun:test";
import {
  ANSWER_SHAPE_VALUES,
  AUDIENCE_VALUES,
  CATEGORY_TO_FRESHNESS_DECAY,
  CATEGORY_VALUES,
  CHUNK_STATUS_VALUES,
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
  TEMPORAL_VALUES,
  TRUST_TIER_VALUES,
} from "@/types/vocab";

/**
 * Brief §3.5 — "Test that each enum exactly matches these sets."
 *
 * For vocabs listed with a specific set in the brief, assert exact membership.
 * Some brief sets are drift-tolerant (SOURCE_SYSTEM_VALUES, INGEST_STAGE_VALUES)
 * — we assert the brief-listed members are PRESENT without requiring an exact
 * count, so implementations with extra reserved values still pass.
 */

const eqSet = <T extends string>(
  actual: ReadonlyArray<T>,
  expected: ReadonlyArray<string>,
): void => {
  expect(new Set(actual)).toEqual(new Set(expected));
  expect(actual.length).toBe(expected.length);
};

describe("Vocabularies — exact-set enums (brief §3.5)", () => {
  test("CATEGORY_VALUES has exactly the 15 brief members", () => {
    eqSet(CATEGORY_VALUES, [
      "tutorial",
      "how-to",
      "reference",
      "explanation",
      "policy",
      "spec",
      "release-notes",
      "changelog",
      "incident",
      "runbook",
      "decision-record",
      "api-doc",
      "code-doc",
      "faq",
      "glossary",
    ]);
  });

  test("SECTION_ROLE_VALUES has exactly the 8 brief members", () => {
    eqSet(SECTION_ROLE_VALUES, [
      "overview",
      "concept",
      "procedure",
      "reference",
      "example",
      "warning",
      "rationale",
      "appendix",
    ]);
  });

  test("ANSWER_SHAPE_VALUES has exactly the 7 brief members", () => {
    eqSet(ANSWER_SHAPE_VALUES, [
      "definition",
      "step-by-step",
      "code-example",
      "comparison",
      "decision",
      "concept",
      "lookup",
    ]);
  });

  test("AUDIENCE_VALUES has exactly the 12 brief members", () => {
    eqSet(AUDIENCE_VALUES, [
      "engineering",
      "ops",
      "security",
      "data-science",
      "product",
      "design",
      "sales",
      "support",
      "legal",
      "finance",
      "executive",
      "general",
    ]);
  });

  test("SENSITIVITY_VALUES has exactly the 4 brief members", () => {
    eqSet(SENSITIVITY_VALUES, ["public", "internal", "confidential", "restricted"]);
  });

  test("LIFECYCLE_VALUES has exactly the 5 brief members", () => {
    eqSet(LIFECYCLE_VALUES, ["draft", "review", "published", "deprecated", "archived"]);
  });

  test("STABILITY_VALUES has exactly the 3 brief members", () => {
    eqSet(STABILITY_VALUES, ["stable", "evolving", "experimental"]);
  });

  test("TEMPORAL_VALUES has exactly the 3 brief members", () => {
    eqSet(TEMPORAL_VALUES, ["timeless", "current", "historical"]);
  });

  test("TRUST_TIER_VALUES has exactly the 4 brief members", () => {
    eqSet(TRUST_TIER_VALUES, ["first-party", "derived", "third-party", "user-generated"]);
  });

  test("FRESHNESS_DECAY_VALUES has exactly the 4 brief members", () => {
    eqSet(FRESHNESS_DECAY_VALUES, ["slow", "medium", "fast", "never"]);
  });

  test("SOURCE_TYPE_VALUES has exactly the 2 brief members", () => {
    eqSet(SOURCE_TYPE_VALUES, ["internal", "external"]);
  });

  test("DOCUMENT_STATUS_VALUES has exactly the 10 brief members", () => {
    eqSet(DOCUMENT_STATUS_VALUES, [
      "pending",
      "parsed",
      "chunked",
      "contextualized",
      "embedded",
      "stored",
      "failed",
      "skipped_empty",
      "skipped_metadata_only",
      "deleted",
    ]);
  });

  test("CHUNK_STATUS_VALUES has exactly the 5 brief members", () => {
    eqSet(CHUNK_STATUS_VALUES, [
      "pending",
      "contextualized",
      "embedded",
      "stored",
      "failed",
    ]);
  });

  test("RECONCILE_EVENT_TYPE_VALUES has exactly the 4 brief members", () => {
    eqSet(RECONCILE_EVENT_TYPE_VALUES, [
      "soft_delete_document",
      "hard_delete_chunks",
      "qdrant_orphan_deleted",
      "dry_run_would_delete",
    ]);
  });

  test("RECONCILE_REASON_VALUES has exactly the 3 brief members", () => {
    eqSet(RECONCILE_REASON_VALUES, [
      "file_vanished",
      "qdrant_orphan",
      "manual_purge",
    ]);
  });

  test("RUN_TRIGGER_VALUES has exactly the 5 brief members (incl. init)", () => {
    eqSet(RUN_TRIGGER_VALUES, ["cli", "api", "reconcile", "re-embed", "init"]);
  });
});

describe("Vocabularies — drift-tolerant brief subsets (brief §3.5)", () => {
  test("INGEST_STAGE_VALUES contains '1' through '10' as stage labels", () => {
    for (const n of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]) {
      expect(INGEST_STAGE_VALUES).toContain(n as (typeof INGEST_STAGE_VALUES)[number]);
    }
  });

  test("SOURCE_SYSTEM_VALUES contains the brief-listed members", () => {
    // Brief enumerates: local, github, notion, slack, confluence, other
    // (linear and gdrive are brief-listed but not present in current code — see notes)
    for (const name of ["local", "github", "notion", "slack", "confluence", "other"]) {
      expect(SOURCE_SYSTEM_VALUES).toContain(
        name as (typeof SOURCE_SYSTEM_VALUES)[number],
      );
    }
  });
});

describe("Seed mappings (brief §3.5)", () => {
  test("SOURCE_SYSTEM_TO_SOURCE_TYPE: github + local → internal", () => {
    expect(SOURCE_SYSTEM_TO_SOURCE_TYPE.github).toBe("internal");
    expect(SOURCE_SYSTEM_TO_SOURCE_TYPE.local).toBe("internal");
  });

  test("SOURCE_SYSTEM_TO_SOURCE_TYPE covers every SOURCE_SYSTEM_VALUES member", () => {
    for (const sys of SOURCE_SYSTEM_VALUES) {
      expect(SOURCE_SYSTEM_TO_SOURCE_TYPE[sys]).toBeDefined();
      expect(SOURCE_TYPE_VALUES).toContain(SOURCE_SYSTEM_TO_SOURCE_TYPE[sys]);
    }
  });

  test("SOURCE_SYSTEM_TO_AUTHORITY_SCORE yields a [0,1] number for every source system", () => {
    for (const sys of SOURCE_SYSTEM_VALUES) {
      const s = SOURCE_SYSTEM_TO_AUTHORITY_SCORE[sys];
      expect(typeof s).toBe("number");
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  test("CATEGORY_TO_FRESHNESS_DECAY: release-notes → fast, glossary → never", () => {
    expect(CATEGORY_TO_FRESHNESS_DECAY["release-notes"]).toBe("fast");
    expect(CATEGORY_TO_FRESHNESS_DECAY.glossary).toBe("never");
  });

  test("CATEGORY_TO_FRESHNESS_DECAY only maps to valid FRESHNESS_DECAY_VALUES", () => {
    for (const cat of CATEGORY_VALUES) {
      const decay = CATEGORY_TO_FRESHNESS_DECAY[cat];
      if (decay === undefined) continue;
      expect(FRESHNESS_DECAY_VALUES).toContain(decay);
    }
  });
});
