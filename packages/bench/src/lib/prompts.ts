// author: Claude
import { readFile } from "fs/promises";
import { join } from "path";
import { PromptTemplateError } from "@/lib/errors";

/**
 * Reads a prompt template from `packages/bench/prompts/<name>.md` and
 * substitutes every `{{key}}` with the corresponding value (§36).
 *
 * Unfilled placeholders throw `PromptTemplateError` so a missing variable
 * fails loud rather than leaking `{{unfilled}}` into the LLM's context. String
 * values are substituted verbatim; non-string values are `JSON.stringify`-ed.
 *
 * Template files live on disk rather than as TypeScript string literals so
 * they're easy to diff and edit without recompiling.
 */
export const renderPrompt = async (
  name: string,
  vars: Record<string, unknown>,
): Promise<string> => {
  const path = join(PROMPTS_DIR, `${name}.md`);
  const raw = await readFile(path, "utf-8");
  const rendered = raw.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (!(key in vars)) return `{{${key}}}`;
    const value = vars[key];
    return typeof value === "string" ? value : JSON.stringify(value);
  });

  const unfilled = [...rendered.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!);
  if (unfilled.length > 0) {
    throw new PromptTemplateError(name, [...new Set(unfilled)]);
  }
  return rendered;
};

/**
 * Absolute path to `packages/bench/prompts/`.
 *
 * Resolved from `import.meta.dir` so the bench finds its prompts regardless
 * of `cwd` — the bench is invoked via `bun link` or `bun run cli/bench.ts`,
 * and relative paths off `process.cwd()` would break under `bun link`.
 */
const PROMPTS_DIR = join(import.meta.dir, "..", "..", "prompts");
