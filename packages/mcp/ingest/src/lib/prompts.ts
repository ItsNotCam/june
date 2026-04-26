// author: Claude
import { readFile } from "fs/promises";
import { join } from "path";
import { PromptTemplateError } from "@/lib/errors";

/**
 * Reads a prompt template from `packages/mcp/ingest/prompts/<name>.md` and
 * substitutes every `{{key}}` with the corresponding value.
 *
 * Unfilled placeholders throw `PromptTemplateError` so a missing variable
 * fails loud rather than leaking `{{unfilled}}` into the LLM's context. String
 * values are substituted verbatim; non-string values are `JSON.stringify`-ed.
 *
 * Templates live on disk rather than as TypeScript string literals so they're
 * easy to diff and edit without recompiling. Mirrors the bench's helper at
 * `packages/mcp/bench/src/lib/prompts.ts`.
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
 * Absolute path to `packages/mcp/ingest/prompts/`.
 *
 * Resolved from `import.meta.dir` so the package finds its prompts regardless
 * of `cwd` — relative paths off `process.cwd()` would break under `bun link`
 * and when invoked from sibling packages (the bench runs ingest in-process).
 */
const PROMPTS_DIR = join(import.meta.dir, "..", "..", "prompts");
