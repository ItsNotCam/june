// author: Claude
import { join, relative } from "path";
import { z } from "zod";
import type { FactsFile } from "@/types/facts";
import type { CorpusManifest } from "@/types/corpus";
import type { QueriesFile } from "@/types/query";
import { QUERY_TIERS } from "@/types/query";
import { readJson, sha256Hex, sha256File, listMarkdownFiles, fileExists } from "@/lib/artifacts";
import { FixtureTamperedError } from "@/lib/errors";

/**
 * Fixture freezing + tamper detection (§ RSI Phase 3, audit gaps #5/#7).
 *
 * The bench's inputs (corpus + queries) are LLM-authored and non-deterministic,
 * so an RSI loop can't tell signal from input drift unless the fixture is
 * pinned. Phase 3 commits a canonical fixture as an immutable artifact and
 * proves it never changes: `fixture.lock.json` records the canonical fixture
 * hash, a per-file SHA-256 manifest, and the authoring provenance (which model
 * wrote the corpus vs. the queries — distinct models are the anti-collusion
 * guarantee). `verifyFixtureLock` recomputes everything and fails on any drift,
 * extending the Stage-4 corpus-bytes check to the WHOLE fixture (facts + queries
 * + manifest), which were previously unverified at load time.
 */

export const FIXTURE_LOCK_FILENAME = "fixture.lock.json";

/**
 * The canonical fixture hash — identical to what `run` stamps into
 * `results.json` and `control-pin` keys the golden on. Facts and queries are
 * hashed whole; the corpus is represented by its sorted per-document content
 * hashes (so a corpus file edit is caught by Stage 4's own check too). Moved
 * here from `cli/run.ts` so freeze, run, and verify share ONE definition.
 */
export const computeFixtureHash = (
  facts: FactsFile,
  corpus: CorpusManifest,
  queries: QueriesFile,
): string => {
  const sortedCorpusHashes = corpus.documents
    .map((d) => d.content_hash)
    .sort()
    .join("|");
  return sha256Hex(
    JSON.stringify(facts) + ":" + sortedCorpusHashes + ":" + JSON.stringify(queries),
  );
};

const FileHashSchema = z.object({
  path: z.string(),
  sha256: z.string(),
});

const AuthorSchema = z.object({ provider: z.string(), model: z.string() });

export const FixtureLockSchema = z.object({
  schema_version: z.literal(1),
  /** Human name of the frozen fixture — matches its `fixtures/<name>/` folder. */
  name: z.string(),
  fixture_id: z.string(),
  /** The canonical hash (`computeFixtureHash`) — what runs/goldens key on. */
  fixture_hash: z.string(),
  domain: z.string(),
  seed: z.number(),
  authoring: z.object({
    /** Facts are seeded + LLM-free, so always reproducible from the seed. */
    facts: z.literal("deterministic"),
    corpus_author: AuthorSchema,
    query_author: AuthorSchema,
    /**
     * True when the corpus and the queries were authored by DIFFERENT models —
     * the anti-collusion guarantee (audit gap #7). Same-model authorship lets
     * queries lexically echo the corpus and inflates recall.
     */
    anti_collusion: z.boolean(),
  }),
  query_count: z.number().int().nonnegative(),
  per_tier_counts: z.record(z.string(), z.number().int().nonnegative()),
  /** Observed anti-leakage spread across queries that carry a score (T2/T3/T4/T6/T7). */
  anti_leakage: z.object({
    threshold: z.number().nullable(),
    max_score: z.number().nullable(),
    mean_score: z.number().nullable(),
    scored_count: z.number().int().nonnegative(),
  }),
  /** Per-file SHA-256 of every fixture artifact, relative to the fixture dir. */
  files: z.array(FileHashSchema),
  frozen_at: z.string(),
  /** Who signed off on this fixture (human review gate); null if unattested. */
  human_signoff: z.string().nullable(),
  note: z.string().optional(),
});
export type FixtureLock = z.infer<typeof FixtureLockSchema>;

/** Reads the three fixture artifacts from a fixture directory. */
export const readFixtureArtifacts = async (
  fixtureDir: string,
): Promise<{ facts: FactsFile; corpus: CorpusManifest; queries: QueriesFile }> => {
  const [facts, corpus, queries] = await Promise.all([
    readJson(join(fixtureDir, "facts.json")) as Promise<FactsFile>,
    readJson(join(fixtureDir, "corpus_manifest.json")) as Promise<CorpusManifest>,
    readJson(join(fixtureDir, "queries.json")) as Promise<QueriesFile>,
  ]);
  return { facts, corpus, queries };
};

/**
 * Hashes every committed fixture file — the JSON artifacts plus every corpus
 * `.md` — returning `{path, sha256}` sorted by path. `path` is relative to the
 * fixture dir so the lock is location-independent (a frozen fixture can be moved
 * or checked out anywhere). The lock file itself is excluded.
 */
export const hashFixtureFiles = async (
  fixtureDir: string,
): Promise<Array<{ path: string; sha256: string }>> => {
  const jsonFiles = ["facts.json", "corpus_manifest.json", "queries.json"];
  const mdFiles = (await listMarkdownFiles(join(fixtureDir, "corpus"))).map((p) =>
    relative(fixtureDir, p),
  );
  const all = [...jsonFiles, ...mdFiles].sort();
  return Promise.all(
    all.map(async (rel) => ({ path: rel, sha256: await sha256File(join(fixtureDir, rel)) })),
  );
};

/** Anti-leakage summary over the queries that carry a score (T1/T5 are null). */
const summarizeAntiLeakage = (
  queries: QueriesFile,
  threshold: number | null,
): FixtureLock["anti_leakage"] => {
  const scores = queries.queries
    .map((q) => q.anti_leakage_score)
    .filter((s): s is number => s !== null);
  if (scores.length === 0) {
    return { threshold, max_score: null, mean_score: null, scored_count: 0 };
  }
  const max_score = Math.max(...scores);
  const mean_score = scores.reduce((a, b) => a + b, 0) / scores.length;
  return { threshold, max_score, mean_score, scored_count: scores.length };
};

const perTierCounts = (queries: QueriesFile): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const tier of QUERY_TIERS) {
    const n = queries.queries.filter((q) => q.tier === tier).length;
    if (n > 0) out[tier] = n;
  }
  return out;
};

/**
 * Builds the `FixtureLock` for a fixture directory: canonical hash, per-file
 * hashes, authoring provenance (with the anti-collusion verdict), and the
 * anti-leakage summary. Pure description of the on-disk fixture — the caller
 * writes it to `<dir>/fixture.lock.json`.
 */
export const buildFixtureLock = async (args: {
  fixtureDir: string;
  name: string;
  threshold: number | null;
  human_signoff: string | null;
  frozen_at: string;
  note?: string;
}): Promise<FixtureLock> => {
  const { facts, corpus, queries } = await readFixtureArtifacts(args.fixtureDir);
  const files = await hashFixtureFiles(args.fixtureDir);
  const corpus_author = corpus.corpus_author;
  const query_author = queries.query_author;
  return {
    schema_version: 1,
    name: args.name,
    fixture_id: facts.fixture_id,
    fixture_hash: computeFixtureHash(facts, corpus, queries),
    domain: facts.domain_name,
    seed: facts.fixture_seed,
    authoring: {
      facts: "deterministic",
      corpus_author,
      query_author,
      anti_collusion: corpus_author.model !== query_author.model,
    },
    query_count: queries.queries.length,
    per_tier_counts: perTierCounts(queries),
    anti_leakage: summarizeAntiLeakage(queries, args.threshold),
    files,
    frozen_at: args.frozen_at,
    human_signoff: args.human_signoff,
    ...(args.note !== undefined ? { note: args.note } : {}),
  };
};

export type FixtureVerification = {
  ok: boolean;
  lock: FixtureLock;
  /** Human-readable descriptions of every divergence (empty when `ok`). */
  divergences: string[];
};

/**
 * Re-derives a frozen fixture's hashes from disk and compares them to its
 * committed `fixture.lock.json`. Catches any post-freeze edit to ANY fixture
 * file, a changed/missing file, or a canonical-hash mismatch. Throws if the
 * lock is absent or malformed (those are caller-level usage errors, not drift).
 */
export const verifyFixtureLock = async (
  fixtureDir: string,
): Promise<FixtureVerification> => {
  const lock = FixtureLockSchema.parse(await readJson(join(fixtureDir, FIXTURE_LOCK_FILENAME)));
  const divergences: string[] = [];

  // 1. Per-file hashes — the precise tamper signal.
  const current = await hashFixtureFiles(fixtureDir);
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

  // 2. Canonical hash — what runs + the golden gate key on.
  const { facts, corpus, queries } = await readFixtureArtifacts(fixtureDir);
  const canonical = computeFixtureHash(facts, corpus, queries);
  if (canonical !== lock.fixture_hash) {
    divergences.push(
      `canonical fixture_hash drift: lock ${lock.fixture_hash.slice(0, 12)}… vs current ${canonical.slice(0, 12)}…`,
    );
  }

  return { ok: divergences.length === 0, lock, divergences };
};

/**
 * Run-time guard: if `fixtureDir` is a FROZEN fixture (has a
 * `fixture.lock.json`), verify it and throw `FixtureTamperedError` on any drift;
 * a non-frozen fixture (no lock) is a silent no-op so ad-hoc generated fixtures
 * still run. This is what makes a committed fixture trustworthy — `run` calls it
 * before ingest, extending Stage 4's corpus-bytes check to the whole fixture.
 */
export const assertFrozenFixtureIntact = async (fixtureDir: string): Promise<void> => {
  if (!(await fileExists(join(fixtureDir, FIXTURE_LOCK_FILENAME)))) return;
  const { ok, divergences, lock } = await verifyFixtureLock(fixtureDir);
  if (!ok) {
    throw new FixtureTamperedError(
      `Frozen fixture "${lock.name}" diverged from its ${FIXTURE_LOCK_FILENAME} ` +
        `(${divergences.length} issue(s)):\n  ${divergences.join("\n  ")}\n` +
        `A frozen fixture is immutable — restore it from git, or re-freeze deliberately.`,
      divergences,
    );
  }
};
