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
      implementation: z.enum(["ollama", "stub", "mock"]).default("ollama"),
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

  return { flags, ingestYaml: yamlStringify(ingest) };
};
