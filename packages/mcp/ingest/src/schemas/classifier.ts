// author: Claude
import { z } from "zod";

/**
 * Stage 6 long-doc outline prompt output (Appendix C.2 pass 1). Used as
 * background context for per-chunk summaries in the two-pass long-document
 * variant.
 *
 * (File name retained for git history continuity; the classifier schema this
 * file used to host was deleted with Stage 5.)
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
