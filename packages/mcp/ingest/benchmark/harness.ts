// author: Claude
#!/usr/bin/env bun
import { readdir, stat } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
import { getConfig, loadConfig } from "@/lib/config";
import { bindingFor } from "@/pipeline/stages/01-discover";
import { getEnv } from "@/lib/env";
import { logger, setLogLevel } from "@/lib/logger";
import { computeWhitelist, installOfflineGuard } from "@/lib/offline-guard";
import { asRunId, asVersion } from "@/types/ids";
import { ulid } from "ulid";
import { runStage2 } from "@/pipeline/stages/02-parse";
import { runStage3 } from "@/pipeline/stages/03-chunk";
import { runStage4 } from "@/pipeline/stages/04-derive";
import { runStage5 } from "@/pipeline/stages/05-classify";
import { runStage6 } from "@/pipeline/stages/06-summarize";
import { runStage7 } from "@/pipeline/stages/07-link";
import { runStage8 } from "@/pipeline/stages/08-embed-text";
import { runStage9 } from "@/pipeline/stages/09-embed";
import { createStubClassifier } from "@/lib/classifier/stub";
import { createStubSummarizer } from "@/lib/summarizer/stub";
import { createStubEmbedder } from "@/lib/embedder/stub";
import { createSqliteSidecar } from "@/lib/storage/sqlite";
import { deriveContentHashBytes, deriveDocId } from "@/lib/ids";
import { pathToFileURL } from "node:url";
import { realpath } from "node:fs/promises";
import type { Document } from "@/types/document";

/**
 * `june bench <corpus-path>` ([§28](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#28-benchmark-harness)). Times the pipeline end-to-end against a
 * directory of markdown. `--no-store` skips Stage 10 and writes metrics only.
 *
 * Uses stubbed model interfaces (no Ollama) to isolate pipeline overhead from
 * model latency. The harness is deliberately self-contained — not a public
 * CLI subcommand; invoked directly via `bun run benchmark/harness.ts`.
 */

type StageTimings = {
  parse_ms: number;
  chunk_ms: number;
  derive_ms: number;
  classify_ms: number;
  summarize_ms: number;
  link_ms: number;
  embed_text_ms: number;
  embed_ms: number;
};

type DocResult = StageTimings & {
  source_uri: string;
  n_chunks: number;
  n_sections: number;
  n_chars: number;
};

const now = () => performance.now();

const MD_EXTS = new Set([".md", ".markdown"]);
const walk = async (root: string): Promise<string[]> => {
  const out: string[] = [];
  const visit = async (p: string): Promise<void> => {
    const st = await stat(p);
    if (st.isFile()) {
      const dot = p.lastIndexOf(".");
      if (dot >= 0 && MD_EXTS.has(p.slice(dot).toLowerCase())) out.push(p);
      return;
    }
    if (st.isDirectory()) {
      const entries = await readdir(p);
      entries.sort();
      for (const e of entries) await visit(join(p, e));
    }
  };
  await visit(resolvePath(root));
  return out;
};

const percentile = (sorted: ReadonlyArray<number>, p: number): number => {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
};

const main = async (): Promise<void> => {
  const argv = Bun.argv.slice(2);
  let corpus = argv[0];
  let out: string | undefined;
  let noStore = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") out = argv[i + 1];
    if (argv[i] === "--no-store") noStore = true;
    if (argv[i] === "--corpus") corpus = argv[i + 1];
  }
  if (!corpus) {
    process.stderr.write("usage: bench.ts <corpus-path> [--out <file>] [--no-store]\n");
    process.exit(64);
  }
  void noStore; // Stage 10 is not wired into the bench harness

  const env = getEnv();
  await loadConfig(env.CONFIG_PATH);
  setLogLevel("warn");
  installOfflineGuard(computeWhitelist([env.OLLAMA_URL, env.QDRANT_URL]));

  const sidecar = await createSqliteSidecar(":memory:");
  const runId = asRunId(ulid());
  await sidecar.putRun({
    run_id: runId,
    started_at: new Date().toISOString(),
    completed_at: undefined,
    trigger: "init",
    doc_count: 0,
    chunk_count: 0,
    error_count: 0,
  });

  const classifier = createStubClassifier();
  const summarizer = createStubSummarizer();
  const embedder = createStubEmbedder(128);

  const files = await walk(corpus);
  const results: DocResult[] = [];
  const overallStart = now();

  for (const abs of files) {
    try {
      const file = Bun.file(abs);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const real = await realpath(abs);
      const source_uri = pathToFileURL(real).toString();
      const doc_id = deriveDocId(source_uri);
      const version = asVersion(new Date().toISOString());
      const binding = bindingFor(source_uri);
      const baseDoc: Document = {
        doc_id,
        version,
        schema_version: 1,
        source_uri,
        source_system: binding.source_system,
        source_type: binding.source_type,
        namespace: binding.namespace,
        project: binding.project,
        document_title: "",
        content_hash: deriveContentHashBytes(bytes),
        byte_length: bytes.byteLength,
        source_modified_at: undefined,
        ingested_at: new Date().toISOString(),
        ingested_by: runId,
        status: "pending",
        is_latest: true,
        deleted_at: undefined,
        doc_category: undefined,
        doc_sensitivity: undefined,
        doc_lifecycle_status: undefined,
        frontmatter: {},
      };

      let tx = await sidecar.begin();
      await sidecar.upsertDocument(tx, baseDoc);
      await tx.commit();

      // Stage 2
      tx = await sidecar.begin();
      const t0 = now();
      const s2 = await runStage2({ document: baseDoc, rawBytes: bytes, runId, sidecar, tx });
      const t_parse = now() - t0;
      await tx.commit();
      if (s2.kind !== "parsed") continue;

      tx = await sidecar.begin();
      const t1 = now();
      const s3 = await runStage3({ parsed: s2.parsed, sidecar, tx });
      const t_chunk = now() - t1;
      await tx.commit();

      const t2 = now();
      const s4 = runStage4({ chunked: s3 });
      const t_derive = now() - t2;

      tx = await sidecar.begin();
      const t3 = now();
      const s5 = await runStage5({
        chunks: s4.chunks,
        classifier,
        sidecar,
        runId,
        binding,
      });
      const t_classify = now() - t3;
      await tx.commit();

      tx = await sidecar.begin();
      const t4 = now();
      const s6 = await runStage6({
        document: s2.parsed.document,
        body: s2.parsed.raw_normalized,
        sections: s3.sections,
        chunks: s5.chunks,
        summarizer,
        sidecar,
        tx,
        runId,
      });
      const t_summarize = now() - t4;
      await tx.commit();

      const t5 = now();
      const s7 = await runStage7({ chunks: s6.chunks, sidecar });
      const t_link = now() - t5;

      tx = await sidecar.begin();
      const t6 = now();
      const s8 = await runStage8({ chunks: s7.chunks, sidecar, runId });
      const t_embed_text = now() - t6;
      await tx.commit();

      tx = await sidecar.begin();
      const t7 = now();
      const s9 = await runStage9({
        document: s2.parsed.document,
        chunks: s8.chunks,
        embedder,
        sidecar,
        tx,
        runId,
      });
      const t_embed = now() - t7;
      await tx.commit();

      results.push({
        source_uri,
        n_chunks: s9.chunks.length,
        n_sections: s3.sections.length,
        n_chars: s2.parsed.raw_normalized.length,
        parse_ms: t_parse,
        chunk_ms: t_chunk,
        derive_ms: t_derive,
        classify_ms: t_classify,
        summarize_ms: t_summarize,
        link_ms: t_link,
        embed_text_ms: t_embed_text,
        embed_ms: t_embed,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("bench_doc_failed", {
        event: "bench_doc_failed",
        source_uri: abs,
        error_message: msg,
      });
    }
  }

  const totalMs = now() - overallStart;
  const totalChunks = results.reduce((s, r) => s + r.n_chunks, 0);
  const totalChars = results.reduce((s, r) => s + r.n_chars, 0);
  const docsPerSec = results.length > 0 ? (results.length * 1000) / totalMs : 0;
  const chunksPerSec = totalChunks > 0 ? (totalChunks * 1000) / totalMs : 0;
  const charsPerSec = totalChars > 0 ? (totalChars * 1000) / totalMs : 0;

  const summarize = (key: keyof StageTimings): { p50: number; p95: number; p99: number } => {
    const sorted = [...results].map((r) => r[key]).sort((a, b) => a - b);
    return {
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
    };
  };

  const report = {
    corpus_path: corpus,
    docs: results.length,
    total_chunks: totalChunks,
    total_ms: totalMs,
    throughput: { docs_per_sec: docsPerSec, chunks_per_sec: chunksPerSec, chars_per_sec: charsPerSec },
    stages: {
      parse: summarize("parse_ms"),
      chunk: summarize("chunk_ms"),
      derive: summarize("derive_ms"),
      classify: summarize("classify_ms"),
      summarize: summarize("summarize_ms"),
      link: summarize("link_ms"),
      embed_text: summarize("embed_text_ms"),
      embed: summarize("embed_ms"),
    },
    per_doc: results,
  };

  const outfile = out ?? `bench-${runId}.json`;
  await Bun.write(outfile, JSON.stringify(report, null, 2));

  process.stdout.write(
    `bench: ${results.length} docs, ${totalChunks} chunks in ${totalMs.toFixed(0)}ms → ${outfile}\n`,
  );
  process.stdout.write(
    `throughput: ${docsPerSec.toFixed(2)} docs/s, ${chunksPerSec.toFixed(2)} chunks/s\n`,
  );

  // Only close after we've written the report.
  const closeResult = (getConfig() as object, void sidecar.close());
  void closeResult;
};

await main();
