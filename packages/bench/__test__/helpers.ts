// author: Claude
import { mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { loadConfig } from "@/lib/config";
import { stringify as yamlStringify } from "yaml";

/**
 * Baseline config used by every test that touches `getConfig()`.
 *
 * Matches `config.example.yaml` where it matters; narrower on the knobs each
 * test tunes (e.g. bootstrap_iterations: 100 for speed).
 */
const BASE_CONFIG = {
  schema_version: 1,
  roles: {
    corpus_author: {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      concurrency: 4,
    },
    query_author: {
      provider: "openai",
      model: "gpt-4.1",
      max_tokens: 2000,
      concurrency: 4,
    },
    reader: {
      provider: "ollama",
      model: "qwen2.5:14b",
      max_tokens: 1024,
      temperature: 0,
      concurrency: 2,
    },
    judge: {
      provider: "anthropic-batch",
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      temperature: 0,
    },
  },
  corpus: { max_facts_per_doc: 15, max_retries: 3 },
  queries: {
    counts: { T1: 5, T2: 5, T3: 5, T4: 5, T5: 5 },
    max_total: 500,
  },
  anti_leakage: { threshold: 0.4, max_retries: 3 },
  resolution: {
    embedding_threshold: 0.85,
    max_unresolved_pct: 0.02,
    max_embedding_pct: 0.2,
  },
  retrieval: {
    adapter: "stopgap",
    k_values: [1, 3, 5, 10],
    retriever_config: {
      fusion: "rrf",
      dense_weight: 0.6,
      bm25_weight: 0.4,
      rank_constant: 60,
    },
  },
  reader_eval: { k: 5 },
  judge: {
    batch_timeout_ms: 60_000,
    poll_initial_ms: 10,
    poll_max_ms: 100,
    max_unjudged_pct: 0.05,
  },
  scoring: {
    bootstrap_iterations: 100,
    ci_percentiles: [2.5, 97.5],
  },
  baseline: {
    no_rag_opus: false,
    provider: "anthropic",
    model: "claude-opus-4-7",
    max_tokens: 1024,
  },
  ingest: {
    scratch_root: "./bench-scratch",
    keep_store_on_success: false,
    confirm_qdrant_host: false,
  },
  cost: {
    max_budget_usd: 5,
    estimates: {
      corpus_author: { input_per_doc: 3000, output_per_doc: 10000 },
      query_author: { input_per_query: 500, output_per_query: 200 },
      reader: { input_per_query: 2000, output_per_query: 300 },
      judge: { input_per_query: 800, output_per_query: 200 },
    },
  },
  caching: { enabled: false },
  log: { level: "error", output: "stdout" },
};

/**
 * Loads a fresh bench config for a test. Pass an `override` object of partial
 * fields to tweak the defaults without copy-pasting the whole tree.
 */
export const loadTestConfig = async (override: Partial<typeof BASE_CONFIG> = {}): Promise<void> => {
  const merged = deepMerge(BASE_CONFIG, override);
  const dir = await mkdtemp(join(tmpdir(), "bench-test-"));
  const path = join(dir, "config.yaml");
  await writeFile(path, yamlStringify(merged), "utf-8");
  await loadConfig(path);
};

const deepMerge = <T extends Record<string, unknown>>(a: T, b: Partial<T>): T => {
  const out = { ...a };
  for (const key of Object.keys(b) as Array<keyof T>) {
    const av = out[key];
    const bv = b[key];
    if (bv !== undefined && av !== null && bv !== null && typeof av === "object" && typeof bv === "object" && !Array.isArray(av)) {
      out[key] = deepMerge(av as Record<string, unknown>, bv as Record<string, unknown>) as T[keyof T];
    } else if (bv !== undefined) {
      out[key] = bv as T[keyof T];
    }
  }
  return out;
};
