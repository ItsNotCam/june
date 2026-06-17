// author: Claude
import type { CorpusDocument, CorpusManifest } from "@/types/corpus";
import type { HoldoutQuery, HoldoutQueriesFile } from "@/types/holdout";
import { sha256Hex } from "@/lib/artifacts";
import { CorpusValidationError } from "@/lib/errors";

/**
 * No-API real-document holdout build path (§ RSI Phase 4).
 *
 * Mirrors the synthetic authoring seam (`authoring.ts`), but the corpus is REAL
 * (no model authors it), so the only creative role is LABELING:
 *   1. `splitDocs(fullText)` — deterministically slice a big `llms-full.txt`
 *      into self-contained real documents on its frontmatter boundaries. No API.
 *   2. `buildLabelingPlan(docs)` — the inventory the orchestrator's agents read
 *      to write questions + the expected document(s) + a gold answer. No API.
 *   3. `assembleHoldout({ plan, labels })` — validate the agent labels (every
 *      expected filename exists; answerable ⇒ a gold answer; unanswerable ⇒ no
 *      expected docs) and emit `corpus_manifest.json` + `holdout_queries.json`.
 *
 * The corpus is never rewritten — `splitDocs` is the only thing that touches the
 * real bytes, and it only slices them. See `HOLDOUT.md` for the agent protocol.
 */

/** One real document sliced out of an `llms-full.txt`. */
export type RealDoc = {
  /** Stable, unique, filesystem-safe id derived from the source URL path. */
  slug: string;
  /** Human title from the doc's frontmatter. */
  title: string;
  /** Canonical source URL from the doc's frontmatter. */
  url: string;
  /** The document body (the real markdown ingested as-is). */
  markdown: string;
};

/** What `holdout-split` writes for the agents to label against. */
export type LabelingPlan = {
  holdout_id: string;
  source: { name: string; url: string; doc_count: number };
  documents: Array<{
    slug: string;
    title: string;
    url: string;
    filename: string;
    char_count: number;
  }>;
};

/** One agent-authored label (the creative output of the holdout build). */
export type HoldoutLabel = {
  /** The question. */
  text: string;
  /** Filenames of the document(s) that answer it — EMPTY for an unanswerable query. */
  expected_doc_filenames: string[];
  /** Short reference answer for the judge — "" for an unanswerable query. */
  gold_answer: string;
  /** Optional explicit negative flag; inferred from an empty expected list when omitted. */
  unanswerable?: boolean;
};

/** On-disk shape of the agent-produced `labels.json`. */
export type HoldoutLabelsFile = {
  holdout_id: string;
  labels: HoldoutLabel[];
};

const DOCS_URL_INFIX = "/docs/";

/** `https://nextjs.org/docs/app/getting-started/installation` → `app-getting-started-installation`. */
const slugFromUrl = (url: string): string => {
  const idx = url.indexOf(DOCS_URL_INFIX);
  const tail = idx >= 0 ? url.slice(idx + DOCS_URL_INFIX.length) : url;
  return (
    tail
      .replace(/^https?:\/\//, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "doc"
  );
};

/** The URL path (after the domain) — used for prefix filtering. */
const urlPath = (url: string): string => {
  const m = /^https?:\/\/[^/]+(\/.*)$/.exec(url);
  return m ? m[1]! : url;
};

/**
 * Deterministically splits a concatenated docs file (Next.js `llms-full.txt`
 * shape) into real documents. A document begins at a `---` line immediately
 * followed by a `title:` line (the frontmatter signal — reliable because bodies
 * use `---` only as thematic breaks, never followed by `title:`), and runs until
 * the next such boundary. The frontmatter's `title`/`url` become the doc's
 * metadata; the body after the closing `---` is the ingested markdown.
 *
 * `urlPrefix` keeps only docs whose URL path starts with it (a COHERENT subset,
 * e.g. `/docs/app/getting-started`); `maxDocs` caps the count in document order.
 * Same input + options → byte-identical output (no randomness, no clock).
 */
export const splitDocs = (
  fullText: string,
  opts: { urlPrefix?: string; maxDocs?: number } = {},
): RealDoc[] => {
  const lines = fullText.split("\n");
  // Doc-start markers: a `---` line whose next line is a `title:` field.
  const starts: number[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i]!.trim() === "---" && /^title:\s/.test(lines[i + 1]!)) {
      starts.push(i);
    }
  }

  const docs: RealDoc[] = [];
  const seenSlug = new Map<string, number>();
  for (let s = 0; s < starts.length; s++) {
    const start = starts[s]!;
    const end = s + 1 < starts.length ? starts[s + 1]! : lines.length;
    // Frontmatter: from start+1 until the closing `---`.
    let fmEnd = start + 1;
    while (fmEnd < end && lines[fmEnd]!.trim() !== "---") fmEnd++;
    const fm = parseFrontmatter(lines.slice(start + 1, fmEnd));
    const url = fm.url ?? "";
    if (!url) continue; // a frontmatter block with no URL isn't a real doc page
    const body = lines.slice(fmEnd + 1, end).join("\n").trim();
    if (body.length === 0) continue;

    let slug = slugFromUrl(url);
    const dup = seenSlug.get(slug) ?? 0;
    seenSlug.set(slug, dup + 1);
    if (dup > 0) slug = `${slug}-${dup}`;

    docs.push({ slug, title: fm.title ?? slug, url, markdown: body });
  }

  let filtered = opts.urlPrefix
    ? docs.filter((d) => urlPath(d.url).startsWith(opts.urlPrefix!))
    : docs;
  if (opts.maxDocs !== undefined && opts.maxDocs >= 0) {
    filtered = filtered.slice(0, opts.maxDocs);
  }
  return filtered;
};

const parseFrontmatter = (
  fmLines: readonly string[],
): { title?: string; url?: string; description?: string; version?: string } => {
  const out: Record<string, string> = {};
  for (const line of fmLines) {
    const m = /^(\w+):\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2]!.trim();
    // Strip surrounding quotes (urls are quoted in the Next.js file).
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[m[1]!] = value;
  }
  return out;
};

/** Stable holdout id derived from the selected docs' content (no clock, no seed). */
export const computeHoldoutId = (docs: readonly RealDoc[]): string => {
  const joined = docs
    .map((d) => sha256Hex(d.markdown))
    .sort()
    .join("|");
  return `holdout-${sha256Hex(joined).slice(0, 12)}`;
};

/** `<slug>.md` — the corpus filename for a real doc. */
export const docFilename = (doc: RealDoc): string => `${doc.slug}.md`;

/** Builds the labeling plan the agents read (the doc inventory). */
export const buildLabelingPlan = (
  docs: readonly RealDoc[],
  source: { name: string; url: string },
): LabelingPlan => ({
  holdout_id: computeHoldoutId(docs),
  source: { name: source.name, url: source.url, doc_count: docs.length },
  documents: docs.map((d) => ({
    slug: d.slug,
    title: d.title,
    url: d.url,
    filename: docFilename(d),
    char_count: d.markdown.length,
  })),
});

/**
 * Validates agent labels and assembles them into a `CorpusManifest` (real docs,
 * empty `planted_fact_ids`) + a `HoldoutQueriesFile`. Fails loudly so the
 * orchestrator re-labels the offending item:
 *  - an answerable query must name ≥1 expected filename that EXISTS in the
 *    corpus and carry a non-empty gold answer;
 *  - an unanswerable query must name NO expected docs and carry no gold answer.
 */
export const assembleHoldout = (args: {
  docs: readonly RealDoc[];
  labels: readonly HoldoutLabel[];
  corpusDir: string;
  label_author: { provider: string; model: string };
}): {
  manifest: CorpusManifest;
  queries: HoldoutQueriesFile;
  files: Array<{ filename: string; markdown: string }>;
} => {
  const holdout_id = computeHoldoutId(args.docs);
  const byFilename = new Map(args.docs.map((d) => [docFilename(d), d]));

  const documents: CorpusDocument[] = [];
  const files: Array<{ filename: string; markdown: string }> = [];
  for (const doc of args.docs) {
    const filename = docFilename(doc);
    documents.push({
      filename,
      absolute_path: `${args.corpusDir}/${filename}`,
      document_title: doc.title,
      planted_fact_ids: [], // real docs — no synthetic facts
      validator_attempts: 1,
      validator_status: "pass",
      content_hash: sha256Hex(doc.markdown),
    });
    files.push({ filename, markdown: doc.markdown });
  }

  const queries: HoldoutQuery[] = [];
  let n = 0;
  for (const label of args.labels) {
    const id = `q-${String(++n).padStart(4, "0")}`;
    const text = label.text?.trim() ?? "";
    if (text.length === 0) {
      throw new CorpusValidationError(
        `assembleHoldout: label ${id} has no question text.`,
        id,
        [],
      );
    }
    const expected = label.expected_doc_filenames ?? [];
    const unanswerable = label.unanswerable ?? expected.length === 0;

    if (unanswerable) {
      if (expected.length > 0) {
        throw new CorpusValidationError(
          `assembleHoldout: label ${id} is unanswerable but names ${expected.length} expected doc(s). An unanswerable query must name none.`,
          id,
          expected,
        );
      }
    } else {
      if (expected.length === 0) {
        throw new CorpusValidationError(
          `assembleHoldout: answerable label ${id} names no expected document.`,
          id,
          [],
        );
      }
      const missing = expected.filter((f) => !byFilename.has(f));
      if (missing.length > 0) {
        throw new CorpusValidationError(
          `assembleHoldout: label ${id} references unknown doc(s): ${missing.join(", ")}. Use a filename from the labeling plan.`,
          id,
          missing,
        );
      }
      if ((label.gold_answer ?? "").trim().length === 0) {
        throw new CorpusValidationError(
          `assembleHoldout: answerable label ${id} has no gold_answer (the judge needs a reference answer).`,
          id,
          expected,
        );
      }
    }

    queries.push({
      id,
      text,
      expected_doc_filenames: expected,
      gold_answer: unanswerable ? "" : label.gold_answer.trim(),
      unanswerable,
      source_urls: expected.map((f) => byFilename.get(f)!.url),
    });
  }

  const manifest: CorpusManifest = {
    fixture_id: holdout_id,
    schema_version: 1,
    documents,
    corpus_author: { provider: "real", model: "nextjs-docs" },
  };
  const queriesFile: HoldoutQueriesFile = {
    holdout_id,
    schema_version: 1,
    label_author: args.label_author,
    queries,
  };
  return { manifest, queries: queriesFile, files };
};
