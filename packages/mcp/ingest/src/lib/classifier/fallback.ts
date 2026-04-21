// author: Claude
import { getConfig } from "@/lib/config";
import { TAGS_DEFAULT } from "@/types/vocab";
import type { ChunkClassification } from "@/types/chunk";
import type { ClassifierOutputJson } from "@/schemas/classifier";

/**
 * Build the fallback classification struct from `config.classifier.fallbacks`.
 * Used when the classifier fails or a field fails zod validation ([§18.6](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#186-failure-handling-and-fallbacks)–7).
 *
 * `namespace` / `project` are not classifier-driven — Stage 5 merges them in
 * from the per-source binding ([§17.1](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#171-document-level-fields-computed-once-per-document-applied-to-every-chunk)) after the classifier or fallback runs.
 */

export const buildFallbackClassifierJson = (): ClassifierOutputJson => {
  const fb = getConfig().classifier.fallbacks;
  return {
    category: fb.category,
    section_role: fb.section_role,
    answer_shape: fb.answer_shape,
    audience: fb.audience,
    audience_technicality: fb.audience_technicality,
    sensitivity: fb.sensitivity,
    lifecycle_status: fb.lifecycle_status,
    stability: fb.stability,
    temporal_scope: fb.temporal_scope,
    source_trust_tier: fb.source_trust_tier,
    prerequisites: fb.prerequisites,
    self_contained: fb.self_contained,
    negation_heavy: fb.negation_heavy,
    tags: fb.tags,
  };
};

/**
 * Filter classifier-proposed `tags` against `TAGS_DEFAULT ∪ config.classifier.tag_extensions`.
 * Unknown tags are dropped silently ([§18.5](../../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#185-vocab-filtering-for-tags)); the caller records the drop in
 * `ingestion_errors` if any were filtered out.
 */
export const filterTags = (
  proposed: ReadonlyArray<string>,
): { kept: ReadonlyArray<string>; dropped: ReadonlyArray<string> } => {
  const allowed = new Set<string>([
    ...TAGS_DEFAULT,
    ...getConfig().classifier.tag_extensions,
  ]);
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const t of proposed) {
    if (allowed.has(t)) kept.push(t);
    else dropped.push(t);
  }
  return { kept, dropped };
};

/**
 * Merge a parsed classifier JSON with `namespace` + `project` from the
 * source binding, producing the in-memory `ChunkClassification`.
 */
export const toChunkClassification = (
  parsed: ClassifierOutputJson,
  binding: { namespace: string; project: string | undefined },
): ChunkClassification => {
  const { kept } = filterTags(parsed.tags);
  return {
    namespace: binding.namespace,
    project: binding.project,
    category: parsed.category,
    section_role: parsed.section_role,
    answer_shape: parsed.answer_shape,
    audience: parsed.audience,
    audience_technicality: Math.min(
      5,
      Math.max(1, parsed.audience_technicality),
    ) as 1 | 2 | 3 | 4 | 5,
    sensitivity: parsed.sensitivity,
    lifecycle_status: parsed.lifecycle_status,
    stability: parsed.stability,
    temporal_scope: parsed.temporal_scope,
    source_trust_tier: parsed.source_trust_tier,
    prerequisites: parsed.prerequisites,
    self_contained: parsed.self_contained,
    negation_heavy: parsed.negation_heavy,
    tags: kept,
  };
};
