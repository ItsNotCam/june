// author: Claude
import { z } from "zod";

/**
 * BenchConfigSchema — validates `config.yaml` (§29.2).
 *
 * Mirrors the YAML surface exactly. Config-load failure exits with code 1 and
 * the zod error path so operators see which field tripped the validation.
 *
 * Load-bearing enum checks:
 * - `roles.judge.provider` MUST be `"anthropic-batch"` (DD-3).
 * - `roles.judge.temperature` MUST be `0` (§22 Batch API grading must be reproducible).
 * - `baseline.provider` MUST be `"anthropic"` (v1 only supports Opus for the baseline).
 */

const ProviderName = z.enum(["ollama", "anthropic", "openai"]);

const SyncRoleSchema = z.object({
  provider: ProviderName,
  model: z.string().min(1),
  max_tokens: z.number().int().positive(),
  /**
   * Max in-flight calls for this role. One number — operators size it for
   * their active provider (Ollama saturates ~1–2 on consumer GPUs; hosted
   * providers tolerate more, subject to rate limits).
   */
  concurrency: z.number().int().positive(),
});

const ReaderRoleSchema = SyncRoleSchema.extend({
  temperature: z.number().min(0).max(2).default(0),
});

const JudgeRoleSchema = z.object({
  provider: z.literal("anthropic-batch"),
  model: z.string().min(1),
  max_tokens: z.number().int().positive(),
  temperature: z.literal(0),
});

const BaselineSchema = z.object({
  no_rag_opus: z.boolean().default(false),
  provider: z.literal("anthropic"),
  model: z.string().min(1),
  max_tokens: z.number().int().positive(),
});

const CostEstimateSchema = z.object({
  input_per_doc: z.number().int().nonnegative().optional(),
  output_per_doc: z.number().int().nonnegative().optional(),
  input_per_query: z.number().int().nonnegative().optional(),
  output_per_query: z.number().int().nonnegative().optional(),
  /**
   * Optional — average wall-clock latency per call. Only used in the cost
   * preview to estimate Ollama electricity spend ahead of time
   * (`latency × wattage × $/kWh`). Ignored when the role isn't Ollama or
   * `cost.ollama` is unset.
   */
  latency_ms_per_query: z.number().int().positive().optional(),
});

/** The full config object — `BenchConfig = z.infer<typeof BenchConfigSchema>`. */
export const BenchConfigSchema = z.object({
  schema_version: z.literal(1),
  roles: z.object({
    corpus_author: SyncRoleSchema,
    query_author: SyncRoleSchema,
    reader: ReaderRoleSchema,
    judge: JudgeRoleSchema,
  }),
  corpus: z.object({
    max_facts_per_doc: z.number().int().positive(),
    max_retries: z.number().int().nonnegative(),
  }),
  queries: z.object({
    counts: z.object({
      T1: z.number().int().nonnegative(),
      T2: z.number().int().nonnegative(),
      T3: z.number().int().nonnegative(),
      T4: z.number().int().nonnegative(),
      T5: z.number().int().nonnegative(),
    }),
    max_total: z.number().int().positive().max(500),
  }),
  anti_leakage: z.object({
    threshold: z.number().min(0).max(1),
    max_retries: z.number().int().nonnegative(),
  }),
  resolution: z.object({
    embedding_threshold: z.number().min(0).max(1),
    max_unresolved_pct: z.number().min(0).max(1),
    max_embedding_pct: z.number().min(0).max(1),
  }),
  retrieval: z.object({
    adapter: z.enum(["stopgap", "june-api"]),
    k_values: z.array(z.number().int().positive()).min(1),
    retriever_config: z.object({
      fusion: z.literal("rrf"),
      dense_weight: z.number().nonnegative(),
      bm25_weight: z.number().nonnegative(),
      rank_constant: z.number().int().positive(),
    }),
    /**
     * Multi-hop wrapper around the inner retriever. When enabled, the bench
     * decomposes each query into one or more hops (LLM-driven), retrieves
     * per hop, and fuses the per-hop rankings via RRF. Single-hop queries
     * pass through unchanged. Designed to fix T4 multi-hop recall —
     * single-pass dense+BM25 fusion can't resolve "the X that Y verbs"
     * because the entity bridge isn't in the query text. Disabling matches
     * the legacy single-pass behaviour.
     */
    multi_hop: z
      .object({
        enabled: z.boolean(),
        planner: z.object({
          provider: ProviderName,
          model: z.string().min(1),
          max_tokens: z.number().int().positive(),
        }),
      })
      .optional(),
  }),
  reader_eval: z.object({
    k: z.number().int().positive(),
  }),
  judge: z.object({
    batch_timeout_ms: z.number().int().positive(),
    poll_initial_ms: z.number().int().positive(),
    poll_max_ms: z.number().int().positive(),
    max_unjudged_pct: z.number().min(0).max(1),
  }),
  scoring: z.object({
    bootstrap_iterations: z.number().int().positive(),
    ci_percentiles: z.tuple([z.number(), z.number()]),
  }),
  baseline: BaselineSchema,
  ingest: z.object({
    scratch_root: z.string().min(1),
    keep_store_on_success: z.boolean(),
    confirm_qdrant_host: z.boolean(),
  }),
  cost: z.object({
    max_budget_usd: z.number().positive(),
    estimates: z.object({
      corpus_author: CostEstimateSchema,
      query_author: CostEstimateSchema,
      reader: CostEstimateSchema,
      judge: CostEstimateSchema,
    }),
    /**
     * Optional electricity-cost tracking for local Ollama runs.
     *
     * Every field is optional. If `gpu_wattage` AND `dollar_per_kwh` are both
     * present, every Ollama call's `cost_usd` carries the wall-clock energy
     * cost: `wattage_W × latency_s / 3600 × $/kWh`. If either is missing,
     * Ollama cost stays at $0 (silent — no warning, no throw).
     *
     * `gpu` is metadata only — recorded in the run manifest so operators
     * comparing runs can spot a hardware change.
     */
    ollama: z
      .object({
        gpu: z.string().optional(),
        gpu_wattage: z.number().positive().optional(),
        dollar_per_kwh: z.number().nonnegative().optional(),
      })
      .optional(),
  }),
  caching: z.object({
    enabled: z.boolean(),
    /**
     * Root directory for the LLM response cache. One subdir per provider
     * (`anthropic/`, `anthropic-batch/`, `openai/`); one file per request
     * keyed by SHA-256 of the canonical request shape. Operator can `rm -rf`
     * this dir at any time — entries are non-load-bearing.
     */
    cache_root: z.string().min(1).default("./state/cache/llm"),
  }),
  log: z.object({
    level: z.string().min(1),
    output: z.enum(["stdout", "stderr"]),
    /**
     * When true, log lines are colored and prefixed with an emoji per level
     * (human-readable). When false (default), standard JSON — safer for log
     * aggregators. `--log-json` on the CLI overrides this to `false`.
     */
    pretty: z.boolean().default(false),
  }),
});

export type BenchConfig = z.infer<typeof BenchConfigSchema>;
