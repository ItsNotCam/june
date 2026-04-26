// author: Claude
import { ConfigNotInitializedError } from "@june/shared";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  LOG_LEVEL_VALUES,
  SOURCE_SYSTEM_VALUES,
  SOURCE_TYPE_VALUES,
} from "./config-enums";

/**
 * MCP-package configuration schema ([§29.2](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#292-the-configyaml-reference)). Operational tunables live here;
 * secrets and service endpoints live in env vars ([§29.1](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#291-environment-variables), I13).
 *
 * Every nested block has a complete default so a fresh install with required
 * env vars and no `config.yaml` parses successfully ("shipped defaults"
 * fallback at the end of [§29.2](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#292-the-configyaml-reference)'s discovery order).
 */

const RetrySchema = z.object({
  base_ms: z.number().int().positive(),
  max_attempts: z.number().int().positive(),
});

const SourceOverrideSchema = z.object({
  source_system: z.enum(SOURCE_SYSTEM_VALUES).optional(),
  source_type: z.enum(SOURCE_TYPE_VALUES).optional(),
  namespace: z.string().min(1).optional(),
  project: z.string().min(1).optional(),
});

export const ConfigSchema = z
  .object({
    sidecar: z
      .object({
        path: z.string().min(1).default("./june.db"),
      })
      .prefault({}),
    log: z
      .object({
        level: z.enum(LOG_LEVEL_VALUES).default("info"),
        output: z.string().min(1).default("stdout"),
        pretty: z.boolean().default(false),
      })
      .prefault({}),
    chunk: z
      .object({
        target_tokens: z.number().int().positive().default(500),
        min_tokens: z.number().int().positive().default(100),
        max_tokens: z.number().int().positive().default(1000),
        overlap_pct: z.number().min(0).max(0.5).default(0.15),
      })
      .prefault({}),
    ingest: z
      .object({
        max_file_bytes: z.number().int().positive().default(52_428_800),
      })
      .prefault({}),
    embedding: z
      .object({
        batch_size: z.number().int().positive().default(32),
        matryoshka_dim: z.number().int().positive().nullable().default(null),
        max_input_chars: z.number().int().positive().default(30_000),
      })
      .prefault({}),
    bm25: z
      .object({
        stopwords: z.array(z.string()).default([]),
      })
      .prefault({}),
    summarizer: z
      .object({
        implementation: z.enum(["ollama", "stub", "mock"]).default("ollama"),
        long_doc_threshold_tokens: z.number().int().positive().default(6000),
      })
      .prefault({}),
    ollama: z
      .object({
        embed_timeout_ms: z.number().int().positive().default(60_000),
        summarizer_timeout_ms: z.number().int().positive().default(60_000),
        first_call_timeout_ms: z.number().int().positive().default(300_000),
        retry: RetrySchema.default({ base_ms: 1000, max_attempts: 3 }),
        embed_retry_max_attempts: z.number().int().positive().default(5),
        summarizer_retry_max_attempts: z.number().int().positive().default(3),
      })
      .prefault({}),
    qdrant: z
      .object({
        upsert_batch_size: z.number().int().positive().default(128),
        retry: RetrySchema.default({ base_ms: 1000, max_attempts: 4 }),
      })
      .prefault({}),
    reconcile: z
      .object({
        mode: z.enum(["off", "manual", "scheduled"]).default("manual"),
        cron: z.string().default(""),
      })
      .prefault({}),
    sources: z.record(z.string(), SourceOverrideSchema).prefault({}),
  })
  .prefault({});

export type Config = z.infer<typeof ConfigSchema>;

/** Shipped defaults — the result of parsing `{}`. Useful as a fallback when no config file is found. */
export const SHIPPED_CONFIG_DEFAULTS: Config = ConfigSchema.parse({});

let _config: Config | null = null;

const fileExists = async (path: string): Promise<boolean> => {
  try {
    const f = Bun.file(path);
    return await f.exists();
  } catch {
    return false;
  }
};

/**
 * Discovery order per [§29.2](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#292-the-configyaml-reference):
 *   1. `--config <path>` / `CONFIG_PATH` env (passed as `explicitPath`) — MUST
 *       exist if provided; no silent fall-through on operator typo.
 *   2. `./config.yaml`
 *   3. `~/.config/june/config.yaml`
 *   4. shipped defaults
 */
export const discoverConfigPath = async (
  explicitPath?: string,
): Promise<string | undefined> => {
  if (explicitPath && explicitPath.length > 0) {
    if (await fileExists(explicitPath)) return explicitPath;
    throw new Error(
      `Config file not found at '${explicitPath}'. Check --config / CONFIG_PATH.`,
    );
  }
  const candidates = [
    "./config.yaml",
    join(homedir(), ".config", "june", "config.yaml"),
  ];
  for (const p of candidates) {
    if (await fileExists(p)) return p;
  }
  return undefined;
};

/**
 * Loads and validates the YAML at `explicitPath` (or the discovery chain if
 * absent). Falls back to shipped defaults if no file is found anywhere.
 * Throws if an `explicitPath` is supplied and the file doesn't exist — a
 * typoed `--config` should surface loudly, not silently use defaults.
 *
 * Always overwrites the singleton — safe to call again for hot-reload or
 * test reset.
 */
export const loadConfig = async (
  explicitPath?: string,
): Promise<Config> => {
  const path = await discoverConfigPath(explicitPath);
  if (!path) {
    _config = ConfigSchema.parse({});
    return _config;
  }
  const raw = await readFile(path, "utf8");
  _config = ConfigSchema.parse(parseYaml(raw) ?? {});
  return _config;
};

/**
 * Returns the loaded config.
 * Throws `ConfigNotInitializedError` if `loadConfig` has not been called.
 */
export const getConfig = (): Config => {
  if (!_config) throw new ConfigNotInitializedError();
  return _config;
};
