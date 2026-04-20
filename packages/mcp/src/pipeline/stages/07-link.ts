import { dirname, isAbsolute, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseMarkdown } from "@/lib/parser/markdown";
import { deriveSectionId } from "@/lib/ids";
import type { SidecarStorage } from "@/lib/storage/types";
import type { RootContent } from "mdast";
import type { ChunkRelationships } from "@/types/chunk";
import type { DocId, SectionId } from "@/types/ids";
import type { SummarizedChunk } from "./06-summarize";

/**
 * Stage 7 — Relationship & Reference Extraction ([§20](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#20-stage-7--relationship--reference-extraction)).
 *
 * Re-parses each chunk's content for `link` nodes, classifies each URL as
 * internal / external / ignored, and resolves internal hits to `doc_id` /
 * `section_id` via the SQLite `documents` + `sections` snapshot.
 */

export type Stage7Input = {
  readonly chunks: ReadonlyArray<SummarizedChunk>;
  readonly sidecar: SidecarStorage;
};

export type LinkedChunk = SummarizedChunk & { relationships: ChunkRelationships };

export type Stage7Result = {
  readonly chunks: ReadonlyArray<LinkedChunk>;
};

type Link = {
  url: string;
  fragment: string | undefined;
};

const collectLinks = (node: RootContent, out: Link[]): void => {
  if (node.type === "link") {
    const raw = node.url ?? "";
    const hashIdx = raw.indexOf("#");
    const url = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
    const fragment = hashIdx >= 0 ? raw.slice(hashIdx + 1) : undefined;
    out.push({ url, fragment });
  }
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      collectLinks(child as RootContent, out);
    }
  }
};

const IGNORED_SCHEMES = new Set(["mailto", "tel", "javascript", "data"]);

const isHttp = (url: string): boolean =>
  /^https?:\/\//i.test(url);

const isIgnored = (url: string): boolean => {
  const m = url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (!m) return false;
  return IGNORED_SCHEMES.has((m[1] ?? "").toLowerCase());
};

const resolveInternalUri = (
  raw: string,
  source_uri: string,
): string | undefined => {
  if (raw.length === 0) return undefined;
  if (raw.startsWith("file://")) return raw;
  if (isAbsolute(raw)) {
    return pathToFileURL(raw).toString();
  }
  // Relative — resolve against the source doc's directory.
  try {
    const sourceFsPath = fileURLToPath(source_uri);
    const resolved = resolvePath(dirname(sourceFsPath), raw);
    return pathToFileURL(resolved).toString();
  } catch {
    return undefined;
  }
};

const githubSlug = (heading: string): string =>
  heading
    .toLowerCase()
    .replace(/[^\w\s-]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");

const findSectionByFragment = (
  sections: ReadonlyArray<{ section_id: SectionId; heading_path: ReadonlyArray<string> }>,
  fragment: string,
): SectionId | undefined => {
  const target = fragment.toLowerCase();
  // Preserve document order for dedupe-by-suffix semantics.
  const counts = new Map<string, number>();
  for (const s of sections) {
    const last = s.heading_path[s.heading_path.length - 1] ?? "";
    const base = githubSlug(last);
    if (base.length === 0) continue;
    const n = counts.get(base) ?? 0;
    const slug = n === 0 ? base : `${base}-${n}`;
    counts.set(base, n + 1);
    if (slug === target) return s.section_id;
  }
  return undefined;
};

export const runStage7 = async (input: Stage7Input): Promise<Stage7Result> => {
  const out: LinkedChunk[] = [];

  // Cache resolved document lookups within a run to cut SQLite calls.
  const docCache = new Map<string, DocId | undefined>();

  for (const c of input.chunks) {
    const ast = parseMarkdown(c.content, c.source_uri);
    const links: Link[] = [];
    for (const node of ast.children) collectLinks(node, links);

    const references: ChunkRelationships["references"][number][] = [];
    const external_links: string[] = [];
    const unresolved_links: string[] = [];

    for (const l of links) {
      if (l.url.length === 0 && l.fragment) {
        // Pure in-document fragment — we can't resolve without an anchor map
        // to the chunk's own sections; leave unresolved for now.
        unresolved_links.push(`#${l.fragment}`);
        continue;
      }
      if (isHttp(l.url)) {
        external_links.push(l.fragment ? `${l.url}#${l.fragment}` : l.url);
        continue;
      }
      if (isIgnored(l.url)) continue;

      const resolvedUri = resolveInternalUri(l.url, c.source_uri);
      if (!resolvedUri) {
        unresolved_links.push(l.fragment ? `${l.url}#${l.fragment}` : l.url);
        continue;
      }

      let doc_id = docCache.get(resolvedUri);
      if (!docCache.has(resolvedUri)) {
        const doc = await input.sidecar.getLatestDocumentByUri(resolvedUri);
        doc_id = doc && !doc.deleted_at ? doc.doc_id : undefined;
        docCache.set(resolvedUri, doc_id);
      }
      if (!doc_id) {
        unresolved_links.push(l.fragment ? `${l.url}#${l.fragment}` : l.url);
        continue;
      }
      if (!l.fragment) {
        references.push({ doc_id });
        continue;
      }
      // Need section lookup for the resolved doc. Re-use the doc's own
      // version — pick the latest.
      const latest = await input.sidecar.getLatestDocument(doc_id);
      if (!latest) {
        unresolved_links.push(`${l.url}#${l.fragment}`);
        continue;
      }
      const sections = await input.sidecar.getSectionsForDoc(
        latest.doc_id,
        latest.version,
      );
      const sec = findSectionByFragment(
        sections.map((s) => ({
          section_id: s.section_id,
          heading_path: s.heading_path,
        })),
        l.fragment,
      );
      if (!sec) {
        unresolved_links.push(`${l.url}#${l.fragment}`);
      } else {
        references.push({ section_id: sec });
      }
    }

    const relationships: ChunkRelationships = {
      references,
      external_links,
      unresolved_links,
      canonical_for: [],
      siblings: [],
      previous_chunk_id: undefined,
      next_chunk_id: undefined,
      supersedes: undefined,
      superseded_by: undefined,
    };
    out.push({ ...c, relationships });
  }

  return { chunks: out };
};

export const _internal = { githubSlug, deriveSectionId } as const;
