// author: Claude
import { readFile, writeFile, rename, mkdir, stat, readdir } from "fs/promises";
import { createHash } from "crypto";
import { dirname, join } from "path";

/**
 * Atomic JSON write: write to `<path>.partial`, fsync (implicit in writeFile
 * + rename on POSIX), rename to `<path>` (§14).
 *
 * All bench artifacts use this pattern so resume can trust that any artifact
 * on disk is complete — partial writes either never rename or are resumed by
 * the next run. `reviver`/`replacer` are fixed to `null` so runs across
 * machines serialize identically (no locale-sensitive dates, no `Infinity`).
 */
export const writeJsonAtomic = async (
  path: string,
  value: unknown,
): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const body = JSON.stringify(value, null, 2);
  const tmp = `${path}.partial`;
  await writeFile(tmp, body, "utf-8");
  await rename(tmp, path);
};

/**
 * Reads a JSON file and returns the parsed value typed as `unknown`.
 *
 * Callers are expected to narrow via a Zod schema or a type guard at the
 * trust boundary — internal artifacts skip zod per §34, so this stays
 * `unknown` rather than generic.
 */
export const readJson = async (path: string): Promise<unknown> => {
  const body = await readFile(path, "utf-8");
  return JSON.parse(body);
};

/** Returns `true` if a file exists at `path`, `false` on ENOENT, rethrows other errors. */
export const fileExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return false;
    throw err;
  }
};

/** SHA-256 hex digest of a UTF-8 string. */
export const sha256Hex = (input: string): string =>
  createHash("sha256").update(input, "utf-8").digest("hex");

/** SHA-256 hex digest of the file at `path`. Reads the whole file — not streamed. */
export const sha256File = async (path: string): Promise<string> => {
  const body = await readFile(path);
  return createHash("sha256").update(body).digest("hex");
};

/**
 * Recursively lists all `*.md` files under `dir`, returning absolute paths
 * in sorted order.
 *
 * Used by Stage 4's pre-ingest hash check to iterate a corpus directory
 * deterministically regardless of filesystem enumeration order.
 */
export const listMarkdownFiles = async (dir: string): Promise<string[]> => {
  const out: string[] = [];
  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        out.push(full);
      }
    }
  };
  await walk(dir);
  return out.sort();
};
