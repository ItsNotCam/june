// author: Claude
import { createHash } from "crypto";
import { realpathSync } from "fs";
import { pathToFileURL } from "url";

/** Crockford base32 alphabet (no I, L, O, U) — same choice as ULID for readability. */
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Encodes the first 130 bits of `bytes` as 26 Crockford-base32 characters.
 *
 * Used for deterministic `fixture_id` generation (§15): same seed + domain
 * produce the same 26-char id forever. The shape reads like a ULID but has
 * no timestamp component — a regenerated fixture from seed `42` last year
 * yields the same id as one regenerated today.
 */
const base32Encode130 = (bytes: Uint8Array): string => {
  let bits = "";
  for (let i = 0; i < 17; i++) {
    bits += bytes[i]!.toString(2).padStart(8, "0");
  }
  bits = bits.slice(0, 130);

  let out = "";
  for (let i = 0; i < 130; i += 5) {
    const chunk = bits.slice(i, i + 5);
    const idx = parseInt(chunk, 2);
    out += CROCKFORD_ALPHABET[idx]!;
  }
  return out;
};

/**
 * Deterministic fixture id derived from seed + domain_name (§15).
 *
 * `sha256("fixture:" + seed + ":" + domain_name)`, first 130 bits, base32.
 * Stable across fact-generation runs with the same inputs.
 */
export const fixtureId = (seed: number, domain_name: string): string => {
  const digest = createHash("sha256")
    .update(`fixture:${seed}:${domain_name}`, "utf-8")
    .digest();
  return base32Encode130(new Uint8Array(digest));
};

/**
 * Derives a human-readable run id from the current timestamp and the fixture
 * id — prefix with the ISO minute for sortability, append 8 base32 chars of
 * entropy for uniqueness within a minute.
 *
 * Not derived from a seed — each `june-eval run` invocation produces a new
 * id so concurrent runs don't collide.
 */
export const newRunId = (fixture_id: string): string => {
  const now = new Date();
  const date = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const digest = createHash("sha256")
    .update(`run:${fixture_id}:${now.toISOString()}:${Math.random()}`, "utf-8")
    .digest();
  return `${date}-${base32Encode130(new Uint8Array(digest)).slice(0, 8)}`;
};

/**
 * june's per-document id — `sha256_hex(canonical_file_uri)` per `SPEC.md §11`
 * and `packages/mcp/src/pipeline/stages/01-discover.ts:toCanonicalFileUri`.
 *
 * mcp doesn't hash the bare path — it first resolves symlinks via `realpath`
 * then converts to a `file://` URI via Node's `pathToFileURL`. The bench
 * mirrors both transforms exactly; otherwise `doc_id` lookup misses.
 */
export const juneDocId = (absolute_path: string): string => {
  const real = realpathSync(absolute_path);
  const sourceUri = pathToFileURL(real).toString();
  return createHash("sha256").update(sourceUri, "utf-8").digest("hex");
};
