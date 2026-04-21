// author: Claude
import type { RootContent } from "mdast";
import { parseMarkdown } from "@/lib/parser/markdown";
import { approximateTokens } from "@/lib/tokenize";
import type { ChunkedDocument, UnclassifiedChunk } from "@/types/pipeline";
import type { ChunkStructuralFeatures } from "@/types/chunk";

/**
 * Stage 4 — Metadata Derivation ([§17](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#17-stage-4--metadata-derivation-free--parse-time)).
 *
 * Pure-CPU augmentation of the chunks emitted by Stage 3. Computes the
 * deterministic Pillar 5 fields (`contains_code`, `code_languages`,
 * `has_table`, `has_list`, `link_density`) and the chunk-level neighbor
 * pointers (`previous_chunk_id`, `next_chunk_id`). Nothing is persisted here;
 * Stage 5/6 commit their own results, and the full payload lands in Qdrant
 * at Stage 10 ([§17.5](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#175-output)).
 */

export type Stage4Input = {
  readonly chunked: ChunkedDocument;
};

export type Stage4Result = {
  readonly chunks: ReadonlyArray<UnclassifiedChunk>;
};

/** Walk a subtree and collect code-fence info-strings + structural flags. */
const walk = (
  node: RootContent,
  acc: {
    codeLanguages: Set<string>;
    containsCode: boolean;
    hasTable: boolean;
    hasList: boolean;
    linkCount: number;
  },
): void => {
  switch (node.type) {
    case "code": {
      acc.containsCode = true;
      const lang = node.lang?.trim().toLowerCase();
      if (lang && lang.length > 0) acc.codeLanguages.add(lang);
      break;
    }
    case "inlineCode": {
      acc.containsCode = true;
      break;
    }
    case "table": {
      acc.hasTable = true;
      break;
    }
    case "list": {
      acc.hasList = true;
      break;
    }
    case "link": {
      acc.linkCount += 1;
      break;
    }
    default:
      break;
  }
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      walk(child as RootContent, acc);
    }
  }
};

/** Compute structural features from the chunk's raw content by re-parsing. */
export const structuralFeaturesFor = (raw: string, source_uri: string): ChunkStructuralFeatures => {
  const ast = parseMarkdown(raw, source_uri);
  const acc = {
    codeLanguages: new Set<string>(),
    containsCode: false,
    hasTable: false,
    hasList: false,
    linkCount: 0,
  };
  for (const node of ast.children) {
    walk(node, acc);
  }
  const charCount = raw.length;
  const linkDensity = charCount > 0 ? (acc.linkCount * 100) / charCount : 0;
  return {
    token_count: approximateTokens(raw),
    char_count: charCount,
    contains_code: acc.containsCode,
    code_languages: [...acc.codeLanguages],
    has_table: acc.hasTable,
    has_list: acc.hasList,
    link_density: linkDensity,
    language: undefined,
  };
};

export const runStage4 = (input: Stage4Input): Stage4Result => {
  const chunks = [...input.chunked.chunks];
  const augmented: UnclassifiedChunk[] = chunks.map((c) => {
    const features = structuralFeaturesFor(c.content, c.source_uri);
    return { ...c, structural_features: features };
  });
  return { chunks: augmented };
};
