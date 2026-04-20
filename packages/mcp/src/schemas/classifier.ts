import { z } from "zod";
import {
  ANSWER_SHAPE_VALUES,
  AUDIENCE_VALUES,
  CATEGORY_VALUES,
  LIFECYCLE_VALUES,
  SECTION_ROLE_VALUES,
  SENSITIVITY_VALUES,
  STABILITY_VALUES,
  TEMPORAL_VALUES,
  TRUST_TIER_VALUES,
} from "@/types/vocab";

/**
 * Stage 5 classifier output ([§18.4](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#184-output-schema-zod-validated-per-i14)). The model is prompted (Appendix B) to
 * return exactly this shape. Parsed with `.safeParse` at the boundary; on
 * failure Stage 5 falls back per-field to `config.classifier.fallbacks` ([§18.7](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#187-defaults-per-configyaml-with-shipped-values))
 * and writes an `ingestion_errors` row.
 */
export const ClassifierOutputSchema = z.object({
  category: z.enum(CATEGORY_VALUES),
  section_role: z.enum(SECTION_ROLE_VALUES),
  answer_shape: z.enum(ANSWER_SHAPE_VALUES),
  audience: z.array(z.enum(AUDIENCE_VALUES)).min(1).max(3),
  audience_technicality: z.number().int().min(1).max(5),
  sensitivity: z.enum(SENSITIVITY_VALUES),
  lifecycle_status: z.enum(LIFECYCLE_VALUES),
  stability: z.enum(STABILITY_VALUES),
  temporal_scope: z.enum(TEMPORAL_VALUES),
  source_trust_tier: z.enum(TRUST_TIER_VALUES),
  prerequisites: z.array(z.string().min(1)).max(10),
  self_contained: z.boolean(),
  negation_heavy: z.boolean(),
  tags: z.array(z.string().min(1)).max(10),
});

export type ClassifierOutputJson = z.infer<typeof ClassifierOutputSchema>;

/**
 * Stage 6 long-doc outline prompt output (Appendix C.2 pass 1). Used as
 * background context for per-chunk summaries in the two-pass long-document
 * variant.
 */
export const DocumentOutlineSchema = z.object({
  title: z.string().min(1),
  purpose: z.string().min(1),
  sections: z
    .array(
      z.object({
        heading_path: z.array(z.string()).min(1),
        one_line: z.string().min(1),
      }),
    )
    .min(1),
});

export type DocumentOutline = z.infer<typeof DocumentOutlineSchema>;
