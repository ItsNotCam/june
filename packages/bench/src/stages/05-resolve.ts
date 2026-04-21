// author: Claude
import { join } from "path";
import type { FactsFile, Fact } from "@/types/facts";
import type { CorpusManifest } from "@/types/corpus";
import type { IngestManifestFile } from "@/types/ingest";
import type { FactResolution, GroundTruthFile } from "@/types/ground-truth";
import {
  openJuneDatabase,
  chunksForDoc,
  type JuneChunkRow,
} from "@/lib/sqlite";
import { normalizeForResolution } from "@/lib/normalize";
import { juneDocId } from "@/lib/ids";
import { writeJsonAtomic } from "@/lib/artifacts";
import {
  GroundTruthResolutionError,
  IntegrityViolationError,
} from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getConfig } from "@/lib/config";
import { getEnv } from "@/lib/env";
import { embedViaOllama } from "@/providers/ollama";
import { qdrantQuery, filterByDocId } from "@/retriever/qdrant";

/**
 * Stage 5 — two-tier ground-truth resolution (§19).
 *
 * For each planted fact:
 * 1. **Tier 1** — normalize the surface hint and substring-match against
 *    normalized `chunks.raw_content` for the fact's doc. In-memory rather
 *    than SQL LIKE because mcp doesn't whitespace-collapse and the bench's
 *    normalizer does (asymmetry would miss otherwise).
 * 2. **Tier 2** — on Tier-1 miss, embed the hint with mcp's exact embedder
 *    (read from `ingest_manifest.json`) and query Qdrant filtered to the
 *    fact's planted doc. Accept top-1 above `embedding_threshold`.
 *
 * Integrity: if `unresolved_pct > 2%` OR `embedding_pct > 20%` the run
 * aborts with `IntegrityViolationError` (exit 3) and stages 6–9 don't run.
 */
export const runStage5 = async (args: {
  facts: FactsFile;
  corpus: CorpusManifest;
  ingest: IngestManifestFile;
  out_path: string;
}): Promise<GroundTruthFile> => {
  const cfg = getConfig();
  const env = getEnv();

  const factIdToDocPath = buildFactToDocMap(args.facts.facts, args.corpus);
  const db = openJuneDatabase(join(args.ingest.scratch_path, "june.db"));

  // Assertion: every doc path in the manifest resolves to a doc_id present in
  // the ingested SQLite. Catches "the corpus path the bench passed to june
  // differs from what june actually ingested" up front.
  try {
    assertDocsIngested(args.corpus, db);
  } catch (err) {
    db.close();
    throw err;
  }

  const chunksByDocCache = new Map<string, JuneChunkRow[]>();
  const resolutions: FactResolution[] = [];

  try {
    for (const fact of args.facts.facts) {
      const docPath = factIdToDocPath.get(fact.id);
      if (!docPath) {
        resolutions.push(unresolved(fact.id));
        continue;
      }
      const doc_id = juneDocId(docPath);
      let chunks = chunksByDocCache.get(doc_id);
      if (!chunks) {
        chunks = chunksForDoc(db, doc_id);
        chunksByDocCache.set(doc_id, chunks);
      }

      const tier1 = resolveTier1(fact, chunks);
      if (tier1) {
        resolutions.push({
          fact_id: fact.id,
          status: "resolved_substring",
          doc_id,
          chunk_id: tier1.chunk_id,
          similarity: null,
        });
        continue;
      }

      const tier2 = await resolveTier2({
        fact,
        doc_id,
        ingest: args.ingest,
        ollamaUrl: env.OLLAMA_URL,
        qdrantUrl: env.QDRANT_URL,
        qdrantApiKey: env.QDRANT_API_KEY,
        embedding_threshold: cfg.resolution.embedding_threshold,
      });
      if (tier2) {
        resolutions.push({
          fact_id: fact.id,
          status: "resolved_embedding",
          doc_id,
          chunk_id: tier2.chunk_id,
          similarity: tier2.similarity,
        });
      } else {
        resolutions.push(unresolved(fact.id));
      }
    }
  } finally {
    db.close();
  }

  const total = resolutions.length;
  const unresolved_count = resolutions.filter((r) => r.status === "unresolved").length;
  const embedding_count = resolutions.filter(
    (r) => r.status === "resolved_embedding",
  ).length;
  const unresolved_pct = total > 0 ? unresolved_count / total : 0;
  const embedding_pct = total > 0 ? embedding_count / total : 0;

  const aborted_over_threshold =
    unresolved_pct > cfg.resolution.max_unresolved_pct ||
    embedding_pct > cfg.resolution.max_embedding_pct;

  const file: GroundTruthFile = {
    fixture_id: args.facts.fixture_id,
    schema_version: 1,
    ingest_run_id: args.ingest.ingest_run_id,
    ingest_schema_version: args.ingest.ingest_schema_version,
    ingest_embedding_model: args.ingest.embedding_model,
    resolutions,
    integrity: { unresolved_pct, embedding_pct, aborted_over_threshold },
  };
  await writeJsonAtomic(args.out_path, file);

  logger.info("stage.5.complete", {
    fixture_id: args.facts.fixture_id,
    resolved_substring: resolutions.filter((r) => r.status === "resolved_substring").length,
    resolved_embedding: embedding_count,
    unresolved: unresolved_count,
    unresolved_pct,
    embedding_pct,
  });

  if (aborted_over_threshold) {
    throw new IntegrityViolationError(
      `Ground-truth integrity thresholds exceeded: unresolved=${(unresolved_pct * 100).toFixed(2)}% embedding=${(embedding_pct * 100).toFixed(2)}%`,
      unresolved_pct,
      embedding_pct,
    );
  }

  return file;
};

const unresolved = (fact_id: string): FactResolution => ({
  fact_id,
  status: "unresolved",
  doc_id: null,
  chunk_id: null,
  similarity: null,
});

const buildFactToDocMap = (
  facts: readonly Fact[],
  corpus: CorpusManifest,
): Map<string, string> => {
  const out = new Map<string, string>();
  for (const doc of corpus.documents) {
    for (const id of doc.planted_fact_ids) out.set(id, doc.absolute_path);
  }
  for (const fact of facts) {
    if (!out.has(fact.id)) {
      throw new GroundTruthResolutionError(
        `Fact ${fact.id} is not planted in any corpus document — manifest is malformed`,
      );
    }
  }
  return out;
};

const assertDocsIngested = (
  corpus: CorpusManifest,
  db: import("bun:sqlite").Database,
): void => {
  const stmt = db.query<{ count: number }, [string]>(
    `SELECT COUNT(*) AS count FROM documents WHERE doc_id = ?`,
  );
  for (const doc of corpus.documents) {
    const id = juneDocId(doc.absolute_path);
    const row = stmt.get(id);
    if (!row || row.count === 0) {
      throw new GroundTruthResolutionError(
        `Corpus doc ${doc.filename} (doc_id=${id}) not found in june's documents table`,
      );
    }
  }
};

const resolveTier1 = (
  fact: Fact,
  chunks: JuneChunkRow[],
): { chunk_id: string } | null => {
  const hintNorm = normalizeForResolution(fact.surface_hint);
  if (hintNorm.length === 0) return null;

  const matches: JuneChunkRow[] = [];
  for (const chunk of chunks) {
    if (normalizeForResolution(chunk.raw_content).includes(hintNorm)) {
      matches.push(chunk);
    }
  }
  if (matches.length === 0) return null;
  // Prefer the earliest chunk per §10 (facts planted in their canonical location).
  matches.sort((a, b) => a.chunk_index - b.chunk_index);
  return { chunk_id: matches[0]!.chunk_id };
};

const resolveTier2 = async (args: {
  fact: Fact;
  doc_id: string;
  ingest: IngestManifestFile;
  ollamaUrl: string;
  qdrantUrl: string;
  qdrantApiKey: string | undefined;
  embedding_threshold: number;
}): Promise<{ chunk_id: string; similarity: number } | null> => {
  const vector = await embedViaOllama({
    ollamaUrl: args.ollamaUrl,
    model: args.ingest.embedding_model,
    input: args.fact.surface_hint,
  });

  // Query every alias in the manifest — facts are usually in one collection,
  // but querying both is cheap and robust to classifier drift.
  const perCollection = await Promise.all(
    args.ingest.qdrant_collections.map((name) =>
      qdrantQuery({
        qdrantUrl: args.qdrantUrl,
        apiKey: args.qdrantApiKey,
        collection: name,
        body: {
          using: "dense",
          query: vector,
          limit: 1,
          with_payload: ["chunk_id"],
          filter: filterByDocId(args.doc_id),
        },
      }),
    ),
  );

  let best: { chunk_id: string; score: number } | null = null;
  for (const hits of perCollection) {
    for (const hit of hits) {
      const chunk_id = hit.payload["chunk_id"];
      if (typeof chunk_id !== "string") continue;
      if (!best || hit.score > best.score) {
        best = { chunk_id, score: hit.score };
      }
    }
  }
  if (!best || best.score < args.embedding_threshold) return null;
  return { chunk_id: best.chunk_id, similarity: best.score };
};
