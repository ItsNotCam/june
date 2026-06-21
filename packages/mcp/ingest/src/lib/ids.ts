// author: Claude
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative as pathRelative, sep as pathSep } from "node:path";
import {
  asChunkId,
  asDocId,
  asSectionId,
  type ChunkId,
  type DocId,
  type SectionId,
} from "#internal/types/ids";

/**
 * Deterministic ID derivation per [§11](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#11-deterministic-id-scheme). Every identity hash uses SHA-256 and
 * produces a 64-char lowercase hex string. Inputs are joined with `|` to
 * prevent collisions across fields with similar-but-not-identical shapes.
 */

const HASH_SEP = "|";

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

// `doc_id` hash domains — tag the input so a relative path can never collide
// with a URI-derived id, keeping the two id namespaces unambiguous.
const DOCID_DOMAIN_RELPATH = "relpath";
const DOCID_DOMAIN_URI = "uri";

/**
 * `doc_id` from a **source-root-relative POSIX path** — the portable, content-stable
 * identity. The same file ingested from `main` or from a git worktree relativizes to
 * the same path ⇒ the same `doc_id`; editing the file's content does NOT change it
 * (that's what `version` + `content_hash` are for). Input must already be canonical
 * (see {@link canonicalizeRelativePath}). Domain-tagged (see above).
 */
export const deriveDocIdFromRelPath = (canonical_rel_path: string): DocId =>
  asDocId(sha256Hex([DOCID_DOMAIN_RELPATH, canonical_rel_path].join(HASH_SEP)));

/**
 * `doc_id` from a source URI — the **fallback** when a path is outside any
 * `source_root`, or the origin is a non-`file://` URI (e.g. `mcp://…` from the
 * content/MCP ingest path). Domain-tagged (see above).
 */
export const deriveDocIdFromUri = (source_uri: string): DocId =>
  asDocId(sha256Hex([DOCID_DOMAIN_URI, source_uri].join(HASH_SEP)));

/**
 * Pure relative-path normalizer (no IO): the POSIX, NFC-normalized path of
 * `realAbs` relative to `realRoot`, or `null` if `realAbs` is not strictly under
 * `realRoot`. Both inputs MUST already be realpath-resolved absolute paths.
 * No case-folding (POSIX is case-sensitive).
 */
export const relativizeAndNormalize = (
  realAbs: string,
  realRoot: string,
): string | null => {
  const rel = pathRelative(realRoot, realAbs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(pathSep).join("/").normalize("NFC");
};

/**
 * Canonical source-root-relative path for `doc_id` derivation: realpath BOTH the
 * file and the root (so a symlinked worktree dir and its real target agree), then
 * {@link relativizeAndNormalize}. Returns `null` when the file is outside the root.
 */
export const canonicalizeRelativePath = async (
  absPath: string,
  sourceRoot: string,
): Promise<string | null> => {
  const [realAbs, realRoot] = await Promise.all([
    realpath(absPath),
    realpath(sourceRoot),
  ]);
  return relativizeAndNormalize(realAbs, realRoot);
};

/** Sync mirror of {@link canonicalizeRelativePath} (used by the bench id mirror). */
export const canonicalizeRelativePathSync = (
  absPath: string,
  sourceRoot: string,
): string | null =>
  relativizeAndNormalize(realpathSync(absPath), realpathSync(sourceRoot));

/**
 * `section_id = sha256(doc_id|heading_path_joined|char_offset_start)` ([§11](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#11-deterministic-id-scheme)).
 * `heading_path_joined` is the trimmed segments joined with ` > `; empty
 * heading path is the empty string.
 */
export const deriveSectionId = (
  doc_id: DocId,
  heading_path: ReadonlyArray<string>,
  char_offset_start: number,
): SectionId => {
  const joined = heading_path.map((h) => h.trim()).join(" > ");
  return asSectionId(
    sha256Hex([doc_id, joined, String(char_offset_start)].join(HASH_SEP)),
  );
};

/**
 * `chunk_id = sha256(doc_id|version|char_offset_start|char_offset_end|schema_version)`
 * ([§11](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#11-deterministic-id-scheme)). `embedding_model_name` deliberately does NOT enter the hash — re-embed
 * must keep chunk identity stable.
 */
export const deriveChunkId = (
  doc_id: DocId,
  version: string,
  char_offset_start: number,
  char_offset_end: number,
  schema_version: number,
): ChunkId =>
  asChunkId(
    sha256Hex(
      [
        doc_id,
        version,
        String(char_offset_start),
        String(char_offset_end),
        String(schema_version),
      ].join(HASH_SEP),
    ),
  );

/**
 * `content_hash = sha256(utf8_bytes)` — used for both document-level raw-byte
 * hashing (Stage 1) and chunk-level post-normalization text hashing (Stage 3).
 */
export const deriveContentHash = (content: string): string => sha256Hex(content);

/** Same as `deriveContentHash` but for raw bytes (Stage 1 pre-normalization). */
export const deriveContentHashBytes = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/**
 * Converts a `chunk_id` into the Qdrant point UUID form ([§11](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#11-deterministic-id-scheme)). Takes the first
 * 128 bits of the SHA-256 digest and formats as a standard `8-4-4-4-12` UUID.
 * The full `chunk_id` is still stored in the Qdrant payload for round-tripping
 * back to SQLite.
 */
export const chunkIdToQdrantPointId = (chunk_id: ChunkId): string => {
  const hex = chunk_id as string;
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-" +
    hex.slice(12, 16) +
    "-" +
    hex.slice(16, 20) +
    "-" +
    hex.slice(20, 32)
  );
};
