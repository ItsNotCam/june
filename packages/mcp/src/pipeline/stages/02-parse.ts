// author: Claude
import { parse as parseYaml } from "yaml";
import { normalizeBytes } from "@/lib/encoding";
import type { ErrorType } from "@/lib/error-types";
import { parseMarkdown } from "@/lib/parser/markdown";
import { FrontmatterSchema, type Frontmatter } from "@/schemas/frontmatter";
import { logger } from "@/lib/logger";
import type { Document } from "@/types/document";
import type { ParsedDocument } from "@/types/pipeline";
import type { Root as MdastRoot } from "mdast";
import type { SidecarStorage, Tx } from "@/lib/storage/types";
import type { RunId } from "@/types/ids";

/**
 * Stage 2 — Parsing & Normalization ([§15](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#15-stage-2--parsing--normalization)).
 *
 * Output of Stage 1's rawBytes becomes a normalized UTF-8 string, a parsed
 * mdast tree, and a validated frontmatter snapshot. Degenerate files
 * short-circuit to a skipped_* status; mdast parse failures set status=failed.
 */

export type Stage2Input = {
  readonly document: Document;
  readonly rawBytes: Uint8Array;
  readonly runId: RunId;
  readonly sidecar: SidecarStorage;
  readonly tx: Tx;
};

export type Stage2Result =
  | { kind: "parsed"; parsed: ParsedDocument }
  | { kind: "skipped_empty" }
  | { kind: "skipped_metadata_only" }
  | { kind: "failed"; error_type: ErrorType; error_message: string };

const FM_OPEN = "---\n";

/**
 * Split a normalized markdown string into `(frontmatterBlock, body,
 * bodyOffset)`. `bodyOffset` is the char offset into `normalized` where the
 * body starts — all chunk char offsets reference the body.
 */
export const splitFrontmatter = (
  normalized: string,
): { frontmatter: string | undefined; body: string; bodyOffset: number } => {
  if (!normalized.startsWith(FM_OPEN)) {
    return { frontmatter: undefined, body: normalized, bodyOffset: 0 };
  }
  const closeIdx = normalized.indexOf("\n---", FM_OPEN.length);
  if (closeIdx === -1) {
    return { frontmatter: undefined, body: normalized, bodyOffset: 0 };
  }
  const afterClose = normalized.indexOf("\n", closeIdx + 1);
  const bodyStart = afterClose === -1 ? normalized.length : afterClose + 1;
  return {
    frontmatter: normalized.slice(FM_OPEN.length, closeIdx),
    body: normalized.slice(bodyStart),
    bodyOffset: bodyStart,
  };
};

/** Parse the frontmatter YAML block with zod. Returns `{}` on failure. */
const parseFrontmatterBlock = (
  block: string | undefined,
  onFail: () => Promise<void>,
): Frontmatter => {
  if (!block) return {};
  try {
    const raw = parseYaml(block) ?? {};
    const parsed = FrontmatterSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
    void onFail();
    return {};
  } catch {
    void onFail();
    return {};
  }
};

export const runStage2 = async (input: Stage2Input): Promise<Stage2Result> => {
  let normalized: string;
  try {
    normalized = normalizeBytes(input.rawBytes, input.document.source_uri);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("encoding_undetectable", {
      event: "encoding_undetectable",
      doc_id: input.document.doc_id as string,
      error_message: message,
    });
    await input.sidecar.setDocumentStatus(
      input.tx,
      input.document.doc_id,
      input.document.version,
      "failed",
    );
    await input.sidecar.recordError({
      run_id: input.runId,
      doc_id: input.document.doc_id,
      version: input.document.version,
      chunk_id: undefined,
      stage: "2",
      error_type: "encoding_undetectable",
      error_message: message,
      occurred_at: new Date().toISOString(),
    });
    return { kind: "failed", error_type: "encoding_undetectable", error_message: message };
  }

  const { frontmatter: fmBlock, body, bodyOffset } = splitFrontmatter(normalized);

  const frontmatter = parseFrontmatterBlock(fmBlock, async () => {
    await input.sidecar.recordError({
      run_id: input.runId,
      doc_id: input.document.doc_id,
      version: input.document.version,
      chunk_id: undefined,
      stage: "2",
      error_type: "frontmatter_parse_failed",
      error_message: "Frontmatter YAML failed validation; using empty defaults",
      occurred_at: new Date().toISOString(),
    });
  });

  // Degenerate-file gating ([§15.5](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#155-degenerate-files)). Evaluated in order: empty body → empty;
  // empty body + frontmatter → metadata-only; otherwise proceed.
  if (body.length === 0 || body.trim().length === 0) {
    const kind: "skipped_empty" | "skipped_metadata_only" =
      fmBlock && Object.keys(frontmatter).length > 0
        ? "skipped_metadata_only"
        : "skipped_empty";
    await input.sidecar.setDocumentStatus(
      input.tx,
      input.document.doc_id,
      input.document.version,
      kind,
    );
    logger.info(kind, {
      event: kind,
      doc_id: input.document.doc_id as string,
      source_uri: input.document.source_uri,
    });
    return { kind };
  }

  let ast: MdastRoot;
  try {
    ast = parseMarkdown(body, input.document.source_uri);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await input.sidecar.setDocumentStatus(
      input.tx,
      input.document.doc_id,
      input.document.version,
      "failed",
    );
    await input.sidecar.recordError({
      run_id: input.runId,
      doc_id: input.document.doc_id,
      version: input.document.version,
      chunk_id: undefined,
      stage: "2",
      error_type: "mdast_parse_failed",
      error_message: message,
      occurred_at: new Date().toISOString(),
    });
    return { kind: "failed", error_type: "mdast_parse_failed", error_message: message };
  }

  // A tree with no block children is degenerate — treat as empty.
  if (ast.children.length === 0) {
    await input.sidecar.setDocumentStatus(
      input.tx,
      input.document.doc_id,
      input.document.version,
      "skipped_empty",
    );
    return { kind: "skipped_empty" };
  }

  // Title resolution: frontmatter.title > first H1 > filename ([§17.2](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#172-document_title-resolution)).
  const documentTitle = resolveDocumentTitle(
    frontmatter.title,
    ast,
    input.document.source_uri,
  );

  const mergedDocument: Document = {
    ...input.document,
    status: "parsed",
    document_title: documentTitle,
    frontmatter: frontmatter as Record<string, unknown>,
  };

  await input.sidecar.setDocumentStatus(
    input.tx,
    input.document.doc_id,
    input.document.version,
    "parsed",
  );

  return {
    kind: "parsed",
    parsed: {
      document: mergedDocument,
      ast,
      raw_normalized: bodyOffset === 0 ? body : body,
    },
  };
  // Note: we don't need the frontmatter prefix in `raw_normalized` — Stage 3
  // chunks the body only; offsets index into `body`.
};

const titleCaseFromFilename = (source_uri: string): string => {
  // file:///path/to/hello-world.md → "Hello World"
  const last = source_uri.split("/").pop() ?? source_uri;
  const noExt = last.replace(/\.[^.]+$/, "");
  const decoded = decodeURIComponent(noExt);
  const cleaned = decoded.replace(/[-_]+/g, " ").trim();
  if (cleaned.length === 0) return decoded;
  return cleaned
    .split(/\s+/)
    .map((word) => (word.length > 0 ? word[0]!.toUpperCase() + word.slice(1) : ""))
    .join(" ");
};

const findFirstH1 = (ast: MdastRoot): string | undefined => {
  for (const node of ast.children) {
    if (node.type === "heading" && node.depth === 1) {
      return node.children
        .map((c) => ("value" in c && typeof c.value === "string" ? c.value : ""))
        .join("")
        .trim();
    }
  }
  return undefined;
};

/**
 * Resolve `document_title` per [§17.2](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#172-document_title-resolution): `frontmatter.title` > first H1 >
 * filename-derived title case. Exposed for tests.
 */
export const resolveDocumentTitle = (
  frontmatterTitle: string | undefined,
  ast: MdastRoot,
  source_uri: string,
): string => {
  if (frontmatterTitle && frontmatterTitle.length > 0) return frontmatterTitle;
  const h1 = findFirstH1(ast);
  if (h1 && h1.length > 0) return h1;
  return titleCaseFromFilename(source_uri);
};
