// author: Claude
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The repo/source root that june `doc_id`s are derived relative to. This single
 * value is BOTH passed to `june ingest --source-root` (Stage 4) AND used by the
 * `juneDocId` mirror, so the two can never disagree (a mismatch silently scores
 * 0% recall). Resolved ONCE per process.
 *
 * Precedence: env `JUNE_SOURCE_ROOT` > git toplevel of this package > the package
 * root inferred from this file's location. In a git worktree the toplevel is the
 * worktree's own dir, so a fixture's repo-relative path matches `main` ⇒ same id.
 */
let cached: string | undefined;

const gitToplevel = (startDir: string): string | undefined => {
  try {
    const res = Bun.spawnSync([
      "git",
      "-C",
      startDir,
      "rev-parse",
      "--show-toplevel",
    ]);
    if (res.exitCode !== 0) return undefined;
    const out = new TextDecoder().decode(res.stdout).trim();
    return out.length > 0 ? resolvePath(out) : undefined;
  } catch {
    return undefined;
  }
};

export const juneSourceRoot = (): string => {
  if (cached !== undefined) return cached;
  const here = dirname(fileURLToPath(import.meta.url)); // …/packages/mcp/bench/src/lib
  const envRoot = process.env["JUNE_SOURCE_ROOT"];
  cached = envRoot
    ? resolvePath(envRoot)
    : (gitToplevel(here) ?? resolvePath(here, "../../../../..")); // …/<repo root>
  return cached;
};
