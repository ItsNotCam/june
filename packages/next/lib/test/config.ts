// author: Claude
/**
 * The editable `/test` run configuration (server-only).
 *
 * Persisted as YAML at `TEST_CONFIG_PATH`. It has two sections:
 *   - `ingest`: a curated subset of the ingestion pipeline's ConfigSchema
 *     (`packages/mcp/ingest/src/lib/config.ts`) — passed through to the bench run
 *     via `--ingest-config`. **Keep the keys/defaults in sync with that schema.**
 *   - `run`: bench `run` controls, translated into CLI flags by `deriveRunArgs`.
 *
 * The schema is the trust boundary for both the saved file and the PUT body.
 */
import { readFile, writeFile, rename } from "fs/promises";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";
import { z } from "zod";
import { getTestConfig } from "./env";

/** Sample-ratio sentinel that maps to bench's `--quick` shorthand. */
const QUICK_RATIO = 0.1;

/** Curated ingest tunables — mirrors ingest ConfigSchema defaults. */
const IngestConfigSchema = z.object({
  chunk: z
    .object({
      target_tokens: z.number().int().positive().default(500),
      min_tokens: z.number().int().positive().default(100),
      max_tokens: z.number().int().positive().default(1000),
      overlap_pct: z.number().min(0).max(0.5).default(0.15),
    })
    .prefault({}),
  embedding: z
    .object({
      batch_size: z.number().int().positive().default(32),
      matryoshka_dim: z.number().int().positive().nullable().default(null),
      max_input_chars: z.number().int().positive().default(30_000),
    })
    .prefault({}),
  summarizer: z
    .object({
      // Provider for Stage 6. `anthropic`/`deepseek` call hosted Messages APIs —
      // the run subprocess inherits ANTHROPIC_API_KEY / DEEPSEEK_API_KEY from the
      // server env. Mapped to ingest `summarizer.implementation` in deriveRunArgs.
      provider: z.enum(["ollama", "anthropic", "deepseek"]).default("ollama"),
      // Model for the chosen provider (ollama auto-detected; claude/deepseek
      // curated). Optional — the ingest backend falls back to its default when
      // unset (ollama→env, anthropic→claude-haiku-4-5, deepseek→deepseek-v4-flash).
      model: z.string().optional(),
      long_doc_threshold_tokens: z.number().int().positive().default(6000),
    })
    .prefault({}),
});

/** Bench `run` controls. */
const RunConfigSchema = z.object({
  // 1 = full fixture; 0.1 → --quick; any other value in (0,1] → --sample <ratio>.
  sample_ratio: z.number().gt(0).max(1).default(QUICK_RATIO),
  cache: z.boolean().default(true),
  baseline: z.boolean().default(false),
  reader_concurrency: z.number().int().min(1).default(6),
  // When set to a prior run-id, reuse that run's ingest (Stage 4 / Qdrant
  // collection) instead of re-ingesting — maps to bench `--skip-ingest <id>`.
  // This holds retrieval byte-identical across runs so reader/sample changes can
  // be A/B'd cleanly. Empty/undefined = fresh ingest each run. When set, the
  // `ingest` section (summarizer, chunking, embedding) has no effect.
  skip_ingest: z.string().optional(),
  // The reader (role 3, system under test). Mapped to bench --reader-provider /
  // --reader-model overrides in deriveRunArgs.
  reader: z
    .object({
      provider: z.enum(["ollama", "anthropic", "deepseek"]).default("ollama"),
      model: z.string().min(1).default("llama3.1:latest"),
    })
    .prefault({}),
});

export const TestConfigSchema = z.object({
  ingest: IngestConfigSchema.prefault({}),
  run: RunConfigSchema.prefault({}),
});

export type TestRunConfig = z.infer<typeof TestConfigSchema>;

/** Shipped defaults — the result of parsing `{}`. */
export const DEFAULT_TEST_CONFIG: TestRunConfig = TestConfigSchema.parse({});

/**
 * Loads + validates the saved config, or returns defaults when the file is
 * absent. Throws (Zod) if the file exists but is invalid — a corrupt config
 * should surface loudly rather than silently reset.
 */
export const loadTestConfig = async (): Promise<TestRunConfig> => {
  const { configPath } = getTestConfig();
  let raw: string;
  try {
    raw = await readFile(configPath, "utf-8");
  } catch {
    return DEFAULT_TEST_CONFIG;
  }
  return TestConfigSchema.parse(parseYaml(raw) ?? {});
};

/**
 * Validates and atomically writes the config as YAML (temp file + rename).
 * Returns the normalized config that was persisted.
 */
export const saveTestConfig = async (input: unknown): Promise<TestRunConfig> => {
  const config = TestConfigSchema.parse(input);
  const { configPath } = getTestConfig();
  const tmp = `${configPath}.tmp`;
  await writeFile(tmp, yamlStringify(config), "utf-8");
  await rename(tmp, configPath);
  return config;
};

/**
 * Translates a config into bench `run` arguments: the CLI flags for the `run`
 * section plus the YAML to hand to `--ingest-config` for the `ingest` section.
 */
export const deriveRunArgs = (config: TestRunConfig): { flags: string[]; ingestYaml: string } => {
  const { run, ingest } = config;
  const flags: string[] = [];

  if (run.sample_ratio === QUICK_RATIO) {
    flags.push("--quick");
  } else if (run.sample_ratio < 1) {
    flags.push("--sample", String(run.sample_ratio));
  }
  if (run.cache) flags.push("--cache");
  flags.push(run.baseline ? "--baseline" : "--no-baseline");
  flags.push("--reader-concurrency", String(run.reader_concurrency));
  flags.push("--reader-provider", run.reader.provider);
  flags.push("--reader-model", run.reader.model);
  // Reuse a prior ingest when requested — retrieval stays identical so the
  // reader/sample are the only moving parts. bench ignores --ingest-config when
  // Stage 4 is skipped, so we still emit the YAML below harmlessly.
  if (run.skip_ingest && run.skip_ingest.trim() !== "") {
    flags.push("--skip-ingest", run.skip_ingest.trim());
  }

  // Map the summarizer picker to the ingest ConfigSchema shape: provider →
  // `implementation`, and the model into the provider-specific field. Chunk /
  // embedding pass through unchanged.
  const s = ingest.summarizer;
  const summarizer: Record<string, unknown> = {
    implementation: s.provider,
    long_doc_threshold_tokens: s.long_doc_threshold_tokens,
  };
  if (s.model) {
    const field =
      s.provider === "ollama"
        ? "ollama_model"
        : s.provider === "anthropic"
          ? "anthropic_model"
          : "deepseek_model";
    summarizer[field] = s.model;
  }
  const ingestForYaml = {
    chunk: ingest.chunk,
    embedding: ingest.embedding,
    summarizer,
  };

  return { flags, ingestYaml: yamlStringify(ingestForYaml) };
};
