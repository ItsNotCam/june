// author: Claude
import { describe, expect, test } from "bun:test";
import { assembleHoldout, type RealDoc } from "@/lib/holdout-build";
import { CorpusValidationError } from "@/lib/errors";

/**
 * Holdout label assembly (Phase 4) — the validity gate. An answerable label must
 * name an EXISTING expected doc and carry a gold answer; an unanswerable label
 * must name no docs. Failures throw so the orchestrator re-labels the item.
 */

const docs: RealDoc[] = [
  { slug: "app-routing", title: "Routing", url: "https://x/docs/app/routing", markdown: "# Routing\n\nRoutes." },
  { slug: "app-caching", title: "Caching", url: "https://x/docs/app/caching", markdown: "# Caching\n\nCaches." },
];

const assemble = (labels: Parameters<typeof assembleHoldout>[0]["labels"]) =>
  assembleHoldout({
    docs,
    labels,
    corpusDir: "/tmp/corpus",
    label_author: { provider: "claude-code-agent", model: "claude-opus-4-8" },
  });

describe("assembleHoldout", () => {
  test("assembles a valid mix of answerable + unanswerable labels", () => {
    const { manifest, queries, files } = assemble([
      { text: "How do routes work?", expected_doc_filenames: ["app-routing.md"], gold_answer: "Folders map to routes." },
      { text: "Tell me about caching.", expected_doc_filenames: ["app-caching.md"], gold_answer: "It caches." },
      { text: "What is the airspeed of a swallow?", expected_doc_filenames: [], gold_answer: "" },
    ]);
    expect(files).toHaveLength(2);
    expect(manifest.documents.every((d) => d.planted_fact_ids.length === 0)).toBe(true);
    expect(queries.queries.map((q) => q.id)).toEqual(["q-0001", "q-0002", "q-0003"]);
    expect(queries.queries[2]!.unanswerable).toBe(true);
    expect(queries.queries[0]!.source_urls).toEqual(["https://x/docs/app/routing"]);
    expect(queries.holdout_id).toMatch(/^holdout-/);
  });

  test("rejects an answerable label referencing an unknown doc", () => {
    expect(() =>
      assemble([{ text: "q", expected_doc_filenames: ["nope.md"], gold_answer: "a" }]),
    ).toThrow(CorpusValidationError);
  });

  test("rejects an answerable label with no gold answer", () => {
    expect(() =>
      assemble([{ text: "q", expected_doc_filenames: ["app-routing.md"], gold_answer: "  " }]),
    ).toThrow(/no gold_answer/);
  });

  test("rejects an unanswerable label that names expected docs", () => {
    expect(() =>
      assemble([{ text: "q", expected_doc_filenames: ["app-routing.md"], gold_answer: "", unanswerable: true }]),
    ).toThrow(/unanswerable .* names/);
  });

  test("rejects an empty question", () => {
    expect(() =>
      assemble([{ text: "   ", expected_doc_filenames: ["app-routing.md"], gold_answer: "a" }]),
    ).toThrow(/no question text/);
  });

  test("infers unanswerable from an empty expected list", () => {
    const { queries } = assemble([{ text: "unknown?", expected_doc_filenames: [], gold_answer: "" }]);
    expect(queries.queries[0]!.unanswerable).toBe(true);
    expect(queries.queries[0]!.gold_answer).toBe("");
  });
});
