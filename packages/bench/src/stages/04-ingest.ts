// author: Claude
import { spawn } from "child_process";
import { mkdir, writeFile } from "fs/promises";
import { dirname, isAbsolute, join, resolve } from "path";
import { stringify as yamlStringify } from "yaml";
import type { CorpusManifest } from "@/types/corpus";
import type { IngestManifestFile } from "@/types/ingest";
import {
  openJuneDatabase,
  latestIngestionRun,
  ingestMetadataSnapshot,
  countLatestChunks,
} from "@/lib/sqlite";
import { writeJsonAtomic, sha256File } from "@/lib/artifacts";
import { CorpusTamperedError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getConfig } from "@/lib/config";
import { getEnv } from "@/lib/env";

/**
 * Stage 4 — delegated ingest (§18).
 *
 * Pre-ingest: verifies every `.md` file's SHA-256 matches `corpus_manifest.json`
 * (the `CorpusTamperedError` guard closes the "operator edited corpus between
 * generate and run" gap, L5).
 *
 * Ingest: shells out to `${JUNE_BIN} ingest <absolute_corpus_path>` with a
 * temp `config.yaml` pointing mcp at a scratch SQLite path and
 * `CONFIG_PATH` + `QDRANT_URL` in env. mcp's offline invariant stays intact;
 * the bench runs june as a normal subprocess.
 *
 * Post-ingest: reads `ingestion_runs.run_id`, `documents.schema_version`,
 * and `chunks.embedding_model_*` into `ingest_manifest.json`. Later stages
 * consume the manifest instead of re-querying SQLite.
 */
export const runStage4 = async (args: {
  fixture_id: string;
  run_id: string;
  corpus_dir: string;
  manifest: CorpusManifest;
  ingest_manifest_path: string;
}): Promise<IngestManifestFile> => {
  const cfg = getConfig();
  const env = getEnv();

  await verifyCorpusHashes(args.manifest);

  const scratchRoot = env.BENCH_SCRATCH_ROOT ?? cfg.ingest.scratch_root;
  const scratchPath = resolve(scratchRoot, `${args.fixture_id}-${args.run_id}`);
  await mkdir(scratchPath, { recursive: true });

  const sqlitePath = join(scratchPath, "june.db");
  const mcpConfigPath = join(scratchPath, "config.yaml");
  await writeFile(mcpConfigPath, buildTempMcpConfig(sqlitePath), "utf-8");

  // `june init` is idempotent — applies SQLite DDL + ensures Qdrant collections.
  // Bench-dedicated Qdrant + scratch SQLite mean we always need it before ingest;
  // running it unconditionally avoids "did you remember to init?" footguns.
  await runJuneCommand({
    juneBin: env.JUNE_BIN,
    args: ["init"],
    configPath: mcpConfigPath,
    qdrantUrl: env.QDRANT_URL,
    label: "init",
  });

  await runJuneCommand({
    juneBin: env.JUNE_BIN,
    args: ["ingest", resolve(args.corpus_dir)],
    configPath: mcpConfigPath,
    qdrantUrl: env.QDRANT_URL,
    label: "ingest",
  });

  const db = openJuneDatabase(sqlitePath);
  try {
    const runRow = latestIngestionRun(db);
    if (!runRow) {
      throw new Error("june ingest completed but no ingestion_runs row exists");
    }
    const snapshot = ingestMetadataSnapshot(db);
    if (snapshot.schema_version !== 1) {
      throw new Error(
        `june.documents.schema_version = ${snapshot.schema_version}; bench requires 1`,
      );
    }
    if (!snapshot.embedding_model) {
      throw new Error("june ingest completed but no chunk has an embedding_model_name");
    }

    const file: IngestManifestFile = {
      fixture_id: args.fixture_id,
      run_id: args.run_id,
      schema_version: 1,
      ingest_run_id: runRow.run_id,
      ingest_schema_version: snapshot.schema_version,
      embedding_model: snapshot.embedding_model,
      embedding_model_version: snapshot.embedding_model_version ?? "",
      qdrant_url: env.QDRANT_URL,
      qdrant_collections: ["internal", "external"],
      scratch_path: scratchPath,
      config_path: mcpConfigPath,
      completed_at: new Date().toISOString(),
    };

    await writeJsonAtomic(args.ingest_manifest_path, file);
    logger.info("stage.4.complete", {
      fixture_id: args.fixture_id,
      run_id: args.run_id,
      ingest_run_id: runRow.run_id,
      chunk_count: countLatestChunks(db),
      embedding_model: snapshot.embedding_model,
    });
    return file;
  } finally {
    db.close();
  }
};

/** Verifies every .md in the corpus matches the hash recorded in `corpus_manifest.json`. */
const verifyCorpusHashes = async (manifest: CorpusManifest): Promise<void> => {
  const divergent: string[] = [];
  for (const doc of manifest.documents) {
    const hash = await sha256File(doc.absolute_path);
    if (hash !== doc.content_hash) divergent.push(doc.absolute_path);
  }
  if (divergent.length > 0) {
    throw new CorpusTamperedError(
      `${divergent.length} corpus file(s) diverged from the manifest content hashes`,
      divergent,
    );
  }
};

/**
 * Builds a minimal YAML mcp config pointing the sidecar SQLite at the bench's
 * scratch directory. Every other mcp field is absent — mcp falls back to its
 * shipped defaults (including `bm25.stopwords: []` which the bench's BM25
 * mirrors).
 */
const buildTempMcpConfig = (sqlitePath: string): string => {
  const obj = { sidecar: { path: sqlitePath } };
  return yamlStringify(obj);
};

/**
 * Shells out to june's CLI. Streams stdout/stderr through the bench's
 * logger so operators see progress. Non-zero exit throws — the bench
 * surfaces june's exit code and the subcommand label in the error message.
 *
 * cwd is set to the script's package root when JUNE_BIN is an absolute .ts
 * path (so bun's tsconfig-paths resolver finds mcp's `@/*` aliases).
 */
const runJuneCommand = async (args: {
  juneBin: string;
  args: string[];
  configPath: string;
  qdrantUrl: string;
  label: string;
}): Promise<void> => {
  const trimmedBin = args.juneBin.trim();
  const cwd =
    isAbsolute(trimmedBin) && trimmedBin.endsWith(".ts")
      ? dirname(dirname(trimmedBin))
      : undefined;
  logger.info("stage.4.spawn", {
    june_bin: trimmedBin,
    subcommand: args.label,
    cwd: cwd ?? "(inherited)",
  });

  return new Promise((res, rej) => {
    const proc = spawn(trimmedBin, args.args, {
      cwd,
      env: {
        ...process.env,
        CONFIG_PATH: args.configPath,
        QDRANT_URL: args.qdrantUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stdout?.on("data", (chunk: Buffer) => {
      logger.info(`stage.4.june.${args.label}.stdout`, {
        line: chunk.toString().trimEnd(),
      });
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      logger.warn(`stage.4.june.${args.label}.stderr`, {
        line: chunk.toString().trimEnd(),
      });
    });
    proc.on("error", rej);
    proc.on("close", (code) => {
      if (code === 0) res();
      else rej(new Error(`june ${args.label} exited with code ${code}`));
    });
  });
};
