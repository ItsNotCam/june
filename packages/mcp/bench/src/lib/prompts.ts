// author: Claude
import { readFile } from "fs/promises";
import { join } from "path";
import { PromptTemplateError } from "@/lib/errors";
import { sha256Hex } from "@/lib/artifacts";

/**
 * Reads a prompt template from `packages/mcp/bench/prompts/<name>.md` and
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
 * Reads a prompt template's raw text (no `{{var}}` substitution).
 *
 * Used when the bench needs the verbatim template — e.g. shipping the judge
 * prompt to an external judge runner, or hashing it for drift detection.
 */
export const loadPromptTemplate = async (name: string): Promise<string> =>
  readFile(join(PROMPTS_DIR, `${name}.md`), "utf-8");

/**
 * SHA-256 (hex) of a prompt template's raw bytes.
 *
 * Stamped into `judge_tasks.json` / `verdicts.json` / the run manifest so a
 * change to `prompts/judge.md` is detectable: the regression gate refuses to
 * compare verdicts produced under a different judge prompt (the cross-judge
 * guard), and calibration can pin the prompt a κ was measured against.
 */
export const promptTemplateHash = async (name: string): Promise<string> =>
  sha256Hex(await loadPromptTemplate(name));

/**
 * Absolute path to `packages/mcp/bench/prompts/`.
 *
 * Resolved from `import.meta.dir` so the bench finds its prompts regardless
 * of `cwd` — the bench is invoked via `bun link` or `bun run cli/bench.ts`,
 * and relative paths off `process.cwd()` would break under `bun link`.
 */
const PROMPTS_DIR = join(import.meta.dir, "..", "..", "prompts");
