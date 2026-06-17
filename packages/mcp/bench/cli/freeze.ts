// author: Claude
import { resolve, join } from "path";
import { mkdir } from "fs/promises";
import type { CorpusManifest } from "@/types/corpus";
import {
  FIXTURE_LOCK_FILENAME,
  buildFixtureLock,
  verifyFixtureLock,
  readFixtureArtifacts,
} from "@/lib/fixture-lock";
import { readJson, writeJsonAtomic, fileExists, listMarkdownFiles } from "@/lib/artifacts";
import { UsageError, FixtureTamperedError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { bootstrap, getConfig, parseArgv, flagString, flagBool } from "./shared";

/**
 * Freeze + verify a canonical fixture (§ RSI Phase 3, audit gaps #5/#7).
 *
 * `freeze` copies a generated fixture into the COMMITTED `fixtures/<name>/`
 * directory and writes a `fixture.lock.json` (canonical hash + per-file hashes +
 * authoring provenance). Once committed the fixture is an immutable artifact:
 * `run` verifies the lock before ingest, and `verify-fixture` re-checks it on
 * demand. By default `freeze` REFUSES a colluded fixture (corpus and queries
 * authored by the same model) — that's the anti-collusion guarantee.
 */

/** Where committed fixtures live — package root, tracked in git (see .gitignore). */
const FIXTURES_ROOT = join(import.meta.dir, "..", "fixtures");

const FIXTURE_FILES = ["facts.json", "corpus_manifest.json", "queries.json"] as const;

/**
 * `june-eval freeze <fixture_dir> --name <name> [--signoff <who>] [--note <text>]
 *                   [--force] [--allow-collusion] [--out <dir>]`
 */
export const runFreeze = async (argv: readonly string[]): Promise<void> => {
  const { positionals, flags } = parseArgv(argv);
  if (positionals.includes("--help") || positionals.length < 1) {
    process.stderr.write(FREEZE_HELP);
    if (positionals.length < 1) throw new UsageError("Missing <fixture_dir>");
    return;
  }
  await bootstrap(flags);

  const src = resolve(positionals[0]!);
  const name = flagString(flags, "name");
  if (!name || !/^[a-z0-9][a-z0-9._-]*$/i.test(name)) {
    throw new UsageError(
      `--name <name> is required and must be a safe folder name (got ${JSON.stringify(name)}).`,
    );
  }
  const allowCollusion = flagBool(flags, "allow-collusion");
  const force = flagBool(flags, "force");
  const root = resolve(flagString(flags, "out") ?? FIXTURES_ROOT);
  const dest = join(root, name);

  for (const f of FIXTURE_FILES) {
    if (!(await fileExists(join(src, f)))) {
      throw new UsageError(`freeze: source ${src} is missing ${f} — not a complete fixture dir.`);
    }
  }
  if ((await fileExists(dest)) && !force) {
    throw new UsageError(
      `freeze: ${dest} already exists. A frozen fixture is immutable — pick a new --name, or pass --force to replace it (and re-pin any golden).`,
    );
  }

  // Inspect authoring provenance BEFORE copying — refuse a colluded fixture so
  // gap #7 can't be silently committed. (Same author model ⇒ queries can echo
  // the corpus ⇒ inflated recall.)
  const { corpus, queries } = await readFixtureArtifacts(src);
  const collusion = corpus.corpus_author.model === queries.query_author.model;
  if (collusion && !allowCollusion) {
    throw new UsageError(
      `freeze: corpus and queries were both authored by "${corpus.corpus_author.model}" — that's the ` +
        `anti-collusion gap (queries can lexically echo the corpus → inflated recall). Re-author the ` +
        `queries with a DIFFERENT model (sonnet corpus / opus queries), or pass --allow-collusion to ` +
        `freeze it anyway (the lock will record anti_collusion: false).`,
    );
  }

  await mkdir(join(dest, "corpus"), { recursive: true });
  // Copy the three JSON artifacts verbatim, then every corpus .md.
  for (const f of FIXTURE_FILES) {
    await Bun.write(join(dest, f), Bun.file(join(src, f)));
  }
  const mdFiles = await listMarkdownFiles(join(src, "corpus"));
  await Promise.all(
    mdFiles.map((p) => Bun.write(join(dest, "corpus", p.split("/").pop()!), Bun.file(p))),
  );
  // Rewrite each doc's absolute_path to its frozen location so Stage 4 ingests
  // the committed copy, not the (possibly pruned) source. content_hash is
  // unchanged, so the canonical fixture_hash is unaffected.
  const frozenManifest = (await readJson(join(dest, "corpus_manifest.json"))) as CorpusManifest;
  for (const doc of frozenManifest.documents) {
    doc.absolute_path = join(dest, "corpus", doc.filename);
  }
  await writeJsonAtomic(join(dest, "corpus_manifest.json"), frozenManifest);

  const lock = await buildFixtureLock({
    fixtureDir: dest,
    name,
    threshold: getConfig().anti_leakage.threshold,
    human_signoff: flagString(flags, "signoff") ?? null,
    frozen_at: new Date().toISOString(),
    ...(flagString(flags, "note") !== undefined ? { note: flagString(flags, "note")! } : {}),
  });
  await writeJsonAtomic(join(dest, FIXTURE_LOCK_FILENAME), lock);

  logger.info("freeze.complete", {
    fixture_hash: lock.fixture_hash,
    note: `${name} (anti_collusion: ${lock.authoring.anti_collusion})`,
  });
  process.stderr.write(
    `Froze fixture "${name}" → ${dest}\n` +
      `  fixture_hash: ${lock.fixture_hash}\n` +
      `  authoring: corpus ${lock.authoring.corpus_author.model} / queries ${lock.authoring.query_author.model} ` +
      `(anti_collusion: ${lock.authoring.anti_collusion}${collusion ? " — OVERRIDDEN" : ""})\n` +
      `  queries: ${lock.query_count} ${JSON.stringify(lock.per_tier_counts)}\n` +
      `  anti-leakage: max ${lock.anti_leakage.max_score?.toFixed(3) ?? "—"}, mean ${lock.anti_leakage.mean_score?.toFixed(3) ?? "—"} (threshold ${lock.anti_leakage.threshold ?? "—"})\n` +
      `  ${lock.files.length} files hashed into ${FIXTURE_LOCK_FILENAME}. Commit the ${name}/ dir.\n`,
  );
};

/** `june-eval verify-fixture <fixture_dir>` — recompute hashes vs the lock; exit 1 on drift. */
export const runVerifyFixture = async (argv: readonly string[]): Promise<void> => {
  const { positionals, flags } = parseArgv(argv);
  if (positionals.includes("--help") || positionals.length < 1) {
    process.stderr.write(VERIFY_FIXTURE_HELP);
    if (positionals.length < 1) throw new UsageError("Missing <fixture_dir>");
    return;
  }
  await bootstrap(flags);

  const dir = resolve(positionals[0]!);
  if (!(await fileExists(join(dir, FIXTURE_LOCK_FILENAME)))) {
    throw new UsageError(
      `verify-fixture: ${dir} has no ${FIXTURE_LOCK_FILENAME} — it isn't a frozen fixture. Freeze it first.`,
    );
  }
  const { ok, divergences, lock } = await verifyFixtureLock(dir);
  if (!ok) {
    throw new FixtureTamperedError(
      `Fixture "${lock.name}" diverged from its lock (${divergences.length} issue(s)):\n  ${divergences.join("\n  ")}`,
      divergences,
    );
  }
  process.stderr.write(
    `verify-fixture OK — "${lock.name}" matches its lock ` +
      `(fixture_hash ${lock.fixture_hash.slice(0, 12)}…, ${lock.files.length} files, ` +
      `anti_collusion ${lock.authoring.anti_collusion}).\n`,
  );
};

const FREEZE_HELP = `june-eval freeze — commit a generated fixture as an immutable, hash-locked artifact.

USAGE
  june-eval freeze <fixture_dir> --name <name> [--signoff <who>] [--note <text>]
                   [--force] [--allow-collusion] [--out <dir>] [--config <path>]

Copies facts.json + corpus/ + corpus_manifest.json + queries.json into the
committed fixtures/<name>/ dir and writes ${FIXTURE_LOCK_FILENAME} (canonical
hash + per-file hashes + authoring provenance). Refuses to overwrite an existing
frozen fixture (use --force) and refuses a colluded fixture — corpus and queries
authored by the SAME model — unless --allow-collusion. \`run\` verifies the lock
before ingest; re-check any time with \`verify-fixture\`.
`;

const VERIFY_FIXTURE_HELP = `june-eval verify-fixture — re-check a frozen fixture against its lock.

USAGE
  june-eval verify-fixture <fixture_dir> [--config <path>]

Recomputes every file's SHA-256 and the canonical fixture hash and compares them
to ${FIXTURE_LOCK_FILENAME}. Exits 1 (tampered) on any drift, 0 when intact.
`;
