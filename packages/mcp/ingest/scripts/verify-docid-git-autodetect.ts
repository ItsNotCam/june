// author: Claude
//
// Verifies the ONE doc_id path the unit suite can't cover hermetically: the
// `source_root` GIT-TOPLEVEL AUTODETECT (no --source-root flag), end to end, and
// the real git-worktree portability it exists for.
//
// It git-inits a temp repo, ingests a file through the REAL pipeline with NO
// source_root (forcing autodetect), then adds a linked worktree and ingests the
// same file from there — asserting both store the identical repo-relative doc_id.
//
// Offline: stub summarizer/embedder + in-memory vector + temp SQLite (no Ollama/
// Qdrant). Run: `bun scripts/verify-docid-git-autodetect.ts` (or `bun run verify:docid`).
// Exit 0 = PASS, 1 = FAIL, 2 = SKIP (git unavailable).

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "#internal/lib/config";
import { createStubEmbedder } from "#internal/lib/embedder/stub";
import { createStubSummarizer } from "#internal/lib/summarizer/stub";
import { createSqliteSidecar } from "#internal/lib/storage/sqlite";
import { ingestPath } from "#internal/pipeline/ingest";
import {
  canonicalizeRelativePath,
  deriveDocIdFromRelPath,
} from "#internal/lib/ids";
import type { PipelineDeps } from "#internal/pipeline/factory";
import type { VectorPoint, VectorStorage } from "#internal/lib/storage/types";

const REL = "docs/note.md";
const BODY = "# Note\n\nA body with enough text to chunk and store.\n";

const git = (args: string[], cwd: string): { ok: boolean; out: string } => {
  const res = Bun.spawnSync(["git", ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "verify",
      GIT_AUTHOR_EMAIL: "verify@example.com",
      GIT_COMMITTER_NAME: "verify",
      GIT_COMMITTER_EMAIL: "verify@example.com",
    },
  });
  return {
    ok: res.exitCode === 0,
    out: new TextDecoder().decode(res.stdout).trim(),
  };
};

const inMemoryVector = (): VectorStorage => {
  const points = new Map<string, Map<string, VectorPoint>>();
  return {
    name: "memory",
    ensureCollections: async () => {},
    search: async () => [],
    upsert: async (toWrite) => {
      for (const p of toWrite) {
        const m = points.get(p.collection) ?? new Map<string, VectorPoint>();
        m.set(p.point_id, p);
        points.set(p.collection, m);
      }
    },
    flipIsLatest: async () => 0,
    deletePointsByChunkIds: async (_c, ids) => ids.length,
    deletePointsByDocId: async () => 0,
    scrollAllChunkIds: async function* () {},
    swapEmbedAlias: async () => {},
    probeReachable: async () => true,
  };
};

const makeDeps = async (dbDir: string): Promise<PipelineDeps> => ({
  summarizer: createStubSummarizer(),
  embedder: createStubEmbedder(32),
  storage: {
    sidecar: await createSqliteSidecar(join(dbDir, "june.db")),
    vector: inMemoryVector(),
  },
});

/** Ingest a single file with NO source_root (autodetect) and return the stored doc_id. */
const ingestAndReadDocId = async (
  filePath: string,
  dbDir: string,
): Promise<string> => {
  const deps = await makeDeps(dbDir);
  try {
    const res = await ingestPath({ path: filePath, deps });
    if (res.processed !== 1) {
      throw new Error(`expected processed=1, got ${res.processed}`);
    }
    const doc = await deps.storage.sidecar.getLatestDocumentByUri(
      pathToFileURL(filePath).toString(),
    );
    if (!doc) throw new Error(`no stored document for ${filePath}`);
    return doc.doc_id as string;
  } finally {
    await deps.storage.sidecar.close();
  }
};

const main = async (): Promise<number> => {
  if (!git(["--version"], tmpdir()).ok) {
    console.log("SKIP: git not available");
    return 2;
  }
  await loadConfig(undefined);

  const repo = await mkdtemp(join(tmpdir(), "docid-git-repo-"));
  const dbMain = await mkdtemp(join(tmpdir(), "docid-db-main-"));
  const dbWt = await mkdtemp(join(tmpdir(), "docid-db-wt-"));
  const worktree = `${repo}-wt`;

  try {
    // 1. A real git repo with the file committed (commit needed for `worktree add`).
    if (!git(["init", "-q"], repo).ok) throw new Error("git init failed");
    await mkdir(join(repo, "docs"), { recursive: true });
    await writeFile(join(repo, REL), BODY);
    git(["add", "-A"], repo);
    if (!git(["commit", "-q", "-m", "fixture"], repo).ok) {
      throw new Error("git commit failed");
    }

    // 2. Ingest from the main checkout with NO --source-root → git autodetect.
    const idMain = await ingestAndReadDocId(join(repo, REL), dbMain);

    // 3. The id we EXPECT: relpath relative to the repo's own git toplevel.
    const rel = await canonicalizeRelativePath(join(repo, REL), repo);
    if (rel !== REL) {
      throw new Error(`canonicalize gave "${rel}", expected "${REL}"`);
    }
    const expected = deriveDocIdFromRelPath(rel) as string;

    // 4. A real linked worktree of the same commit → ingest from it (autodetect).
    if (!git(["worktree", "add", "-q", "--detach", worktree, "HEAD"], repo).ok) {
      throw new Error("git worktree add failed");
    }
    const idWt = await ingestAndReadDocId(join(worktree, REL), dbWt);

    // ---- assertions ----
    const autodetectOk = idMain === expected;
    const portableOk = idWt === idMain;
    console.log(`repo root      : ${repo}`);
    console.log(`worktree root  : ${worktree}`);
    console.log(`relpath        : ${rel}`);
    console.log(`doc_id (main)  : ${idMain}`);
    console.log(`doc_id (wt)    : ${idWt}`);
    console.log(`expected       : ${expected}`);
    console.log(
      `\n[${autodetectOk ? "PASS" : "FAIL"}] git autodetect → stored id is the repo-relative id`,
    );
    console.log(
      `[${portableOk ? "PASS" : "FAIL"}] worktree stores the SAME id (portability via autodetect)`,
    );

    if (autodetectOk && portableOk) {
      console.log("\n✅ doc_id git-toplevel autodetect + worktree portability verified");
      return 0;
    }
    console.log("\n❌ verification FAILED");
    return 1;
  } finally {
    git(["worktree", "remove", "--force", worktree], repo);
    for (const d of [repo, worktree, dbMain, dbWt]) {
      await rm(d, { recursive: true, force: true });
    }
  }
};

process.exit(await main());
