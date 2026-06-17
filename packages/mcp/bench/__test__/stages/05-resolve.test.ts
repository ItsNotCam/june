// author: Claude
import { describe, expect, test } from "bun:test";
import type { Fact } from "@/types/facts";
import type { JuneChunkRow } from "@/lib/sqlite";
import { resolveTier1 } from "@/stages/05-resolve";

/**
 * Tier-1 ground-truth resolution determinism (Phase 3). The frozen fixture +
 * pinned ingest give a reproducible ground truth ONLY if resolution is
 * deterministic. Tier-1 substring matching is the deterministic core: it must
 * be order-independent and break ties by the earliest chunk_index. (Tier-2
 * embedding is deterministic given a pinned ingest + fixed threshold; only the
 * resolution logic's determinism is unit-testable without a live store.)
 */

const fact = (hint: string): Fact => ({
  kind: "atomic",
  id: "f1",
  entity: "E",
  attribute: "a",
  value: "v",
  surface_hint: hint,
});

const chunk = (chunk_index: number, raw_content: string): JuneChunkRow => ({
  chunk_id: `c-${chunk_index}`,
  doc_id: "d1",
  chunk_index,
  raw_content,
  embedding_model_name: "m",
  embedding_model_version: "1",
});

describe("resolveTier1 — deterministic substring resolution", () => {
  test("matches the chunk whose content contains the surface hint", () => {
    const chunks = [chunk(0, "intro text"), chunk(1, "The relay threshold is 9 units.")];
    expect(resolveTier1(fact("The relay threshold is 9"), chunks)?.chunk_id).toBe("c-1");
  });

  test("returns null when no chunk contains the hint", () => {
    expect(resolveTier1(fact("nonexistent fact"), [chunk(0, "unrelated")])).toBeNull();
  });

  test("ORDER-INDEPENDENT: same chunks in any order resolve to the same chunk_id", () => {
    const hint = "the relay threshold is 9";
    const a = [chunk(0, "x"), chunk(1, "the relay threshold is 9"), chunk(2, "y")];
    const b = [chunk(2, "y"), chunk(1, "the relay threshold is 9"), chunk(0, "x")];
    const ra = resolveTier1(fact(hint), a);
    const rb = resolveTier1(fact(hint), b);
    expect(ra?.chunk_id).toBe(rb?.chunk_id);
    expect(ra?.chunk_id).toBe("c-1");
  });

  test("TIE-BREAK: when multiple chunks match, the earliest chunk_index wins (regardless of input order)", () => {
    const hint = "shared phrase";
    const matchHigh = chunk(5, "... shared phrase ...");
    const matchLow = chunk(2, "... shared phrase ...");
    expect(resolveTier1(fact(hint), [matchHigh, matchLow])?.chunk_id).toBe("c-2");
    expect(resolveTier1(fact(hint), [matchLow, matchHigh])?.chunk_id).toBe("c-2");
  });

  test("normalizes whitespace symmetrically (multi-space corpus still matches a clean hint)", () => {
    const chunks = [chunk(0, "The   relay    threshold\nis 9.")];
    expect(resolveTier1(fact("The relay threshold is 9."), chunks)?.chunk_id).toBe("c-0");
  });

  test("empty/whitespace-only hint resolves to null (no degenerate match)", () => {
    expect(resolveTier1(fact("   "), [chunk(0, "anything")])).toBeNull();
  });
});
