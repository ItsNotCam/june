// author: Claude
/**
 * Mirrors mcp's parse-stage normalizer (`packages/mcp/src/lib/encoding.ts`)
 * per R1 (§41).
 *
 * mcp applies these transforms before writing `chunks.raw_content`:
 * - Line endings: `\r\n` / `\r` → `\n`
 * - Zero-width characters stripped: U+200B, U+200C, U+200D, U+FEFF, U+2060
 *
 * mcp does NOT apply: whitespace collapse, Unicode NFC/NFD, case folding,
 * trimming. Ground-truth resolver Tier-1 adds a whitespace collapse on top
 * (§19) because corpus authors may write multi-space runs that a clean
 * template-generated surface hint does not contain — the collapse is applied
 * symmetrically to both sides of the substring match.
 *
 * **Load-bearing.** Drift between this module and mcp's Stage 2 normalizer is
 * L5's entire failure mode — recall denominator shrinks silently and scores
 * look worse for no real reason.
 */

const ZERO_WIDTH_CHARS = /[\u200B\u200C\u200D\uFEFF\u2060]/g;
const CR_OR_CRLF = /\r\n?/g;

/**
 * Applies mcp's exact normalizations (line-ending LF, zero-width strip).
 * Use when reading `chunks.raw_content` into memory for further matching.
 */
export const normalizeLikeMcp = (s: string): string => {
  return s.replace(CR_OR_CRLF, "\n").replace(ZERO_WIDTH_CHARS, "");
};

/**
 * mcp normalization + whitespace collapse. Used on both the `surface_hint`
 * pattern and each candidate chunk's `raw_content` before substring match.
 *
 * The collapse applies after mcp-normalization so runs of `\n`, `\t`, and
 * spaces all reduce to a single space. Safe to apply symmetrically because
 * it's idempotent — `normalize(normalize(x)) === normalize(x)`.
 */
export const normalizeForResolution = (s: string): string => {
  return normalizeLikeMcp(s).replace(/\s+/g, " ").trim();
};
