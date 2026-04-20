import { z } from "zod";

/**
 * Validates the parsed YAML frontmatter block at the top of an ingested
 * markdown file. Only `title` and `version` are consumed by the pipeline in
 * v1 ([§14.7](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#147-frontmatter-parsing-for-version--title)); other keys pass through untouched so later phases can read them
 * without a schema bump.
 *
 * `.looseObject` keeps unknown keys instead of stripping them, which matches
 * the Pillar-2 "frontmatter snapshot" field on `Document`.
 */
export const FrontmatterSchema = z.looseObject({
  title: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  audience: z.union([z.string(), z.array(z.string())]).optional(),
});

export type Frontmatter = z.infer<typeof FrontmatterSchema>;
