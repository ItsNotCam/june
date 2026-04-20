/**
 * Branded primitive types for june's deterministic identifiers.
 *
 * Branding prevents ID confusion at compile time — passing a `ChunkId` where a
 * `DocId` is expected is a type error. The brand is a phantom type tag with no
 * runtime cost; the wire shape is always `string`.
 *
 * All hash IDs are 64-char lowercase hex SHA-256 digests ([§11](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#11-deterministic-id-scheme)). Run IDs are
 * 26-char Crockford-base32 ULIDs. Versions are free-form (CLI > frontmatter >
 * ISO-8601 UTC timestamp, per [§14.6](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#146-version-resolution)).
 */

declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type DocId = Brand<string, "DocId">;
export type SectionId = Brand<string, "SectionId">;
export type ChunkId = Brand<string, "ChunkId">;
export type RunId = Brand<string, "RunId">;
export type Version = Brand<string, "Version">;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Thrown by the `as*Id` constructors when the underlying string does not
 * match the expected shape. Catch this at trust boundaries (CLI args,
 * SQLite reads, Qdrant payloads) and surface a clear operator error.
 */
export class InvalidIdError extends Error {
  constructor(readonly value: string, readonly expected: "sha256" | "ulid") {
    super(`Invalid ${expected} ID: ${value}`);
    this.name = "InvalidIdError";
  }
}

const assertSha256 = (s: string): void => {
  if (!SHA256_HEX.test(s)) throw new InvalidIdError(s, "sha256");
};

const assertUlid = (s: string): void => {
  if (!ULID.test(s)) throw new InvalidIdError(s, "ulid");
};

/** Brand a 64-char lowercase hex string as a DocId. Throws InvalidIdError on shape mismatch. */
export const asDocId = (s: string): DocId => {
  assertSha256(s);
  return s as DocId;
};

/** Brand a 64-char lowercase hex string as a SectionId. Throws InvalidIdError on shape mismatch. */
export const asSectionId = (s: string): SectionId => {
  assertSha256(s);
  return s as SectionId;
};

/** Brand a 64-char lowercase hex string as a ChunkId. Throws InvalidIdError on shape mismatch. */
export const asChunkId = (s: string): ChunkId => {
  assertSha256(s);
  return s as ChunkId;
};

/** Brand a 26-char Crockford-base32 ULID as a RunId. Throws InvalidIdError on shape mismatch. */
export const asRunId = (s: string): RunId => {
  assertUlid(s);
  return s as RunId;
};

/** Brand a free-form version string. No shape validation — CLI / frontmatter / timestamp forms all permitted. */
export const asVersion = (s: string): Version => s as Version;
