// author: Claude
import { createHash } from "crypto";
import { realpathSync } from "fs";
import { pathToFileURL } from "url";
import {
  canonicalizeRelativePathSync,
  deriveDocIdFromRelPath,
  deriveDocIdFromUri,
} from "@june/mcp-ingest";
import { juneSourceRoot } from "@/lib/source-root";

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

/** The default domain entity count (the 10 hardcoded protocols). */
export const DEFAULT_ENTITY_COUNT = 10;

/**
 * Deterministic fixture id derived from seed + domain_name (+ entity count) (§15).
 *
 * `sha256("fixture:" + seed + ":" + domain_name)`, first 130 bits, base32.
 * Stable across fact-generation runs with the same inputs.
 *
 * `entityCount` discriminates corpora of different sizes built from the same
 * seed + domain (e.g. the 10-entity v1/v2 vs the 100-entity v3). It is folded
 * into the hash **only when it differs from the default 10**, so existing
 * frozen fixtures keep their byte-identical ids — the legacy id IS the
 * 10-entity id.
 */
export const fixtureId = (
  seed: number,
  domain_name: string,
  entityCount: number = DEFAULT_ENTITY_COUNT,
): string => {
  const suffix = entityCount === DEFAULT_ENTITY_COUNT ? "" : `:e${entityCount}`;
  const digest = createHash("sha256")
    .update(`fixture:${seed}:${domain_name}${suffix}`, "utf-8")
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
 * june's per-document id — the PORTABLE, source-root-relative id (Phase 1). Mirrors
 * ingest exactly by delegating to the SAME shared helpers from `@june/mcp-ingest`
 * (a divergent reimplementation here is the classic 0%-recall footgun):
 *   - under `sourceRoot` ⇒ `sha256("relpath|" + canonical-relative-posix-path)`
 *   - outside the root ⇒ URI fallback (`sha256("uri|" + file://realpath)`), matching
 *     ingest's `toCanonicalFileUri` → `deriveDocIdFromUri`.
 *
 * `sourceRoot` defaults to {@link juneSourceRoot} — the SAME value Stage 4 passes to
 * `june ingest --source-root`, so the bench mirror and the stored ids always agree.
 */
export const juneDocId = (
  absolute_path: string,
  sourceRoot: string = juneSourceRoot(),
): string => {
  const rel = canonicalizeRelativePathSync(absolute_path, sourceRoot);
  if (rel !== null) return deriveDocIdFromRelPath(rel) as string;
  const sourceUri = pathToFileURL(realpathSync(absolute_path)).toString();
  return deriveDocIdFromUri(sourceUri) as string;
};
