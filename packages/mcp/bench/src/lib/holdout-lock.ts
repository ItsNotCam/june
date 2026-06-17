// author: Claude
import { join, relative } from "path";
import { z } from "zod";
import type { CorpusManifest } from "@/types/corpus";
import type { HoldoutQueriesFile } from "@/types/holdout";
import {
  readJson,
  sha256Hex,
  sha256File,
  listMarkdownFiles,
  fileExists,
} from "@/lib/artifacts";
import { FixtureTamperedError } from "@/lib/errors";

/**
 * Holdout freezing + tamper detection (§ RSI Phase 4) — the doc-native sibling
 * of `fixture-lock.ts`. A frozen holdout is an immutable, hash-locked artifact:
 * its corpus is real markdown and its ground truth is hand-labeled expected
 * documents, both pinned so an RSI loop can't tell signal from input drift. The
 * lock records the canonical holdout hash, a per-file SHA-256 manifest, and the
 * labeling provenance. Unlike a fixture, a holdout has NO authoring-collusion
 * dimension (the corpus is real, not model-authored) — its only "author" is the
 * labeler.
 */

export const HOLDOUT_LOCK_FILENAME = "holdout.lock.json";

/**
 * Canonical holdout hash — corpus by its sorted per-document content hashes,
 * plus the labeled queries whole. Distinct from the synthetic `fixture_hash`
 * (which folds in `facts.json`), so a holdout can never collide with a fixture.
 */
export const computeHoldoutHash = (
  corpus: CorpusManifest,
  queries: HoldoutQueriesFile,
): string => {
  const sortedCorpusHashes = corpus.documents
    .map((d) => d.content_hash)
    .sort()
    .join("|");
  return sha256Hex(`holdout:${sortedCorpusHashes}:${JSON.stringify(queries)}`);
};

const FileHashSchema = z.object({ path: z.string(), sha256: z.string() });

export const HoldoutLockSchema = z.object({
  schema_version: z.literal(1),
  /** Marks this lock as a SEALED holdout — never pinned, never gated, never tuned. */
  sealed: z.literal(true),
  name: z.string(),
  holdout_id: z.string(),
  /** The canonical holdout hash — what holdout runs key on. */
  holdout_hash: z.string(),
  source: z.object({ name: z.string(), url: z.string(), doc_count: z.number().int() }),
  label_author: z.object({ provider: z.string(), model: z.string() }),
  doc_count: z.number().int().nonnegative(),
  query_count: z.number().int().nonnegative(),
  answerable_count: z.number().int().nonnegative(),
  unanswerable_count: z.number().int().nonnegative(),
  /** Per-file SHA-256 of every holdout artifact, relative to the holdout dir. */
  files: z.array(FileHashSchema),
  frozen_at: z.string(),
  human_signoff: z.string().nullable(),
  note: z.string().optional(),
});
export type HoldoutLock = z.infer<typeof HoldoutLockSchema>;

/** Reads the two holdout artifacts from a holdout directory. */
export const readHoldoutArtifacts = async (
  holdoutDir: string,
): Promise<{ corpus: CorpusManifest; queries: HoldoutQueriesFile }> => {
  const [corpus, queries] = await Promise.all([
    readJson(join(holdoutDir, "corpus_manifest.json")) as Promise<CorpusManifest>,
    readJson(join(holdoutDir, "holdout_queries.json")) as Promise<HoldoutQueriesFile>,
  ]);
  return { corpus, queries };
};

/** Hashes every committed holdout file (JSON artifacts + every corpus `.md`), sorted by relative path. */
export const hashHoldoutFiles = async (
  holdoutDir: string,
): Promise<Array<{ path: string; sha256: string }>> => {
  const jsonFiles = ["corpus_manifest.json", "holdout_queries.json"];
  const mdFiles = (await listMarkdownFiles(join(holdoutDir, "corpus"))).map((p) =>
    relative(holdoutDir, p),
  );
  const all = [...jsonFiles, ...mdFiles].sort();
  return Promise.all(
    all.map(async (rel) => ({ path: rel, sha256: await sha256File(join(holdoutDir, rel)) })),
  );
};

/** Builds the `HoldoutLock` for a holdout directory (pure description of disk). */
export const buildHoldoutLock = async (args: {
  holdoutDir: string;
  name: string;
  source: { name: string; url: string; doc_count: number };
  human_signoff: string | null;
  frozen_at: string;
  note?: string;
}): Promise<HoldoutLock> => {
  const { corpus, queries } = await readHoldoutArtifacts(args.holdoutDir);
  const files = await hashHoldoutFiles(args.holdoutDir);
  const answerable_count = queries.queries.filter((q) => !q.unanswerable).length;
  return {
    schema_version: 1,
    sealed: true,
    name: args.name,
    holdout_id: queries.holdout_id,
    holdout_hash: computeHoldoutHash(corpus, queries),
    source: args.source,
    label_author: queries.label_author,
    doc_count: corpus.documents.length,
    query_count: queries.queries.length,
    answerable_count,
    unanswerable_count: queries.queries.length - answerable_count,
    files,
    frozen_at: args.frozen_at,
    human_signoff: args.human_signoff,
    ...(args.note !== undefined ? { note: args.note } : {}),
  };
};

export type HoldoutVerification = {
  ok: boolean;
  lock: HoldoutLock;
  divergences: string[];
};

/** Re-derives a frozen holdout's hashes from disk and compares them to its lock. */
export const verifyHoldoutLock = async (
  holdoutDir: string,
): Promise<HoldoutVerification> => {
  const lock = HoldoutLockSchema.parse(
    await readJson(join(holdoutDir, HOLDOUT_LOCK_FILENAME)),
  );
  const divergences: string[] = [];

  const current = await hashHoldoutFiles(holdoutDir);
  const currentByPath = new Map(current.map((f) => [f.path, f.sha256]));
  const lockedByPath = new Map(lock.files.map((f) => [f.path, f.sha256]));
  for (const [path, sha] of lockedByPath) {
    const now = currentByPath.get(path);
    if (now === undefined) divergences.push(`missing file: ${path}`);
    else if (now !== sha) divergences.push(`content changed: ${path}`);
  }
  for (const path of currentByPath.keys()) {
    if (!lockedByPath.has(path)) divergences.push(`unexpected new file: ${path}`);
  }

  const { corpus, queries } = await readHoldoutArtifacts(holdoutDir);
  const canonical = computeHoldoutHash(corpus, queries);
  if (canonical !== lock.holdout_hash) {
    divergences.push(
      `canonical holdout_hash drift: lock ${lock.holdout_hash.slice(0, 12)}… vs current ${canonical.slice(0, 12)}…`,
    );
  }

  return { ok: divergences.length === 0, lock, divergences };
};

/**
 * Run-time guard: if `holdoutDir` is a FROZEN holdout, verify it and throw
 * `FixtureTamperedError` on any drift; a non-frozen dir (no lock) is a no-op.
 * `run-holdout` calls this before ingest.
 */
export const assertFrozenHoldoutIntact = async (holdoutDir: string): Promise<void> => {
  if (!(await fileExists(join(holdoutDir, HOLDOUT_LOCK_FILENAME)))) return;
  const { ok, divergences, lock } = await verifyHoldoutLock(holdoutDir);
  if (!ok) {
    throw new FixtureTamperedError(
      `Frozen holdout "${lock.name}" diverged from its ${HOLDOUT_LOCK_FILENAME} ` +
        `(${divergences.length} issue(s)):\n  ${divergences.join("\n  ")}\n` +
        `A sealed holdout is immutable — restore it from git, or re-freeze deliberately.`,
      divergences,
    );
  }
};
