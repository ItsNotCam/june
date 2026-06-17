// author: Claude
import { describe, expect, test } from "bun:test";
import {
  splitDocs,
  computeHoldoutId,
  buildLabelingPlan,
  docFilename,
} from "@/lib/holdout-build";

/**
 * Real-doc holdout splitting (Phase 4). The split is deterministic and keyed on
 * frontmatter boundaries — `---` followed by `title:` — so a `---` thematic
 * break inside a body is never mistaken for a doc boundary. URL-prefix + max-docs
 * carve a COHERENT subset; the holdout id is content-derived (no clock, no seed).
 */

// A miniature llms-full.txt: a preamble with a bare `---`, three real docs (one
// with an in-body `---` thematic break), spanning two URL areas.
const SAMPLE = [
  "# Next.js Documentation",
  "",
  "---",
  "",
  "---",
  'title: Getting Started',
  'description: intro',
  'url: "https://nextjs.org/docs/app/getting-started"',
  "version: 16.2.9",
  "---",
  "",
  "# Getting Started",
  "",
  "Welcome to the docs.",
  "",
  "---",
  "",
  "More prose after a thematic break.",
  "",
  "---",
  'title: Installation',
  'url: "https://nextjs.org/docs/app/getting-started/installation"',
  "---",
  "",
  "# Installation",
  "",
  "Run the installer.",
  "",
  "---",
  'title: Other Area',
  'url: "https://nextjs.org/docs/pages/other"',
  "---",
  "",
  "# Other",
  "",
  "Unrelated section.",
].join("\n");

describe("splitDocs", () => {
  test("splits on frontmatter boundaries, ignoring in-body thematic breaks", () => {
    const docs = splitDocs(SAMPLE);
    expect(docs.map((d) => d.slug)).toEqual([
      "app-getting-started",
      "app-getting-started-installation",
      "pages-other",
    ]);
    // The first doc keeps its in-body `---` + the prose after it.
    expect(docs[0]!.markdown).toContain("Welcome to the docs.");
    expect(docs[0]!.markdown).toContain("More prose after a thematic break.");
    expect(docs[0]!.title).toBe("Getting Started");
    expect(docs[0]!.url).toBe("https://nextjs.org/docs/app/getting-started");
  });

  test("url-prefix keeps only the coherent subset", () => {
    const docs = splitDocs(SAMPLE, { urlPrefix: "/docs/app/getting-started" });
    expect(docs.map((d) => d.slug)).toEqual([
      "app-getting-started",
      "app-getting-started-installation",
    ]);
  });

  test("max-docs caps the count in document order", () => {
    const docs = splitDocs(SAMPLE, { maxDocs: 1 });
    expect(docs).toHaveLength(1);
    expect(docs[0]!.slug).toBe("app-getting-started");
  });

  test("returns nothing when the prefix matches no doc", () => {
    expect(splitDocs(SAMPLE, { urlPrefix: "/docs/nope" })).toHaveLength(0);
  });

  test("deduplicates slugs deterministically", () => {
    const dupe = [
      "---",
      'title: A',
      'url: "https://x.dev/docs/app/page"',
      "---",
      "body a",
      "---",
      'title: B',
      'url: "https://x.dev/docs/app/page"',
      "---",
      "body b",
    ].join("\n");
    const docs = splitDocs(dupe);
    expect(docs.map((d) => d.slug)).toEqual(["app-page", "app-page-1"]);
  });
});

describe("computeHoldoutId", () => {
  test("is content-derived and stable", () => {
    const docs = splitDocs(SAMPLE);
    expect(computeHoldoutId(docs)).toBe(computeHoldoutId([...docs].reverse()));
    expect(computeHoldoutId(docs)).toMatch(/^holdout-[0-9a-f]{12}$/);
  });

  test("changes when a doc body changes", () => {
    const docs = splitDocs(SAMPLE);
    const mutated = [{ ...docs[0]!, markdown: docs[0]!.markdown + " edit" }, ...docs.slice(1)];
    expect(computeHoldoutId(mutated)).not.toBe(computeHoldoutId(docs));
  });
});

describe("buildLabelingPlan", () => {
  test("inventories every doc with its filename + char count", () => {
    const docs = splitDocs(SAMPLE);
    const plan = buildLabelingPlan(docs, { name: "Next.js docs", url: "https://nextjs.org/docs/llms-full.txt" });
    expect(plan.source.doc_count).toBe(3);
    expect(plan.documents[0]!.filename).toBe(docFilename(docs[0]!));
    expect(plan.documents[0]!.char_count).toBe(docs[0]!.markdown.length);
    expect(plan.holdout_id).toBe(computeHoldoutId(docs));
  });
});
