// author: Claude
/**
 * Server-only configuration for the `/test` pipeline runner.
 *
 * The `/test` page spawns the bench CLI (`june-eval run`) as a child process and
 * streams its NDJSON progress. Everything that varies by machine — where the
 * bench package lives, which fixture to run, which flags to pass — is read from
 * environment variables here and validated once at the trust boundary (Zod).
 *
 * Defaults assume the standard monorepo layout (`packages/next` next to
 * `packages/mcp/bench`) so a developer only needs to set `TEST_FIXTURE_DIR`.
 */
import { resolve } from "path";
import { z } from "zod";

const RawTestEnvSchema = z.object({
  /** Executable that runs the bench CLI. Bench is Bun-only, so default `bun`. */
  TEST_BENCH_RUNNER: z.string().min(1).optional(),
  /** Path to the bench CLI entry, resolved against TEST_BENCH_CWD. */
  TEST_BENCH_CLI: z.string().min(1).optional(),
  /** Working directory for the child — must be the bench package so its .env/config.yaml resolve. */
  TEST_BENCH_CWD: z.string().min(1).optional(),
  /** Fixture directory produced by `june-eval generate`. Required — no safe default. */
  TEST_FIXTURE_DIR: z.string().min(1, "TEST_FIXTURE_DIR is required to run the bench pipeline"),
  /** Space-separated flags appended to `june-eval run <fixture>`. */
  TEST_RUN_FLAGS: z.string().optional(),
  /** Parent directory of run-dirs — must match bench's --out (default ./state/runs). */
  TEST_RUNS_DIR: z.string().min(1).optional(),
  /** Path to the editable run-config YAML the /test UI reads + writes. */
  TEST_CONFIG_PATH: z.string().min(1).optional(),
});

/** Resolved, ready-to-spawn configuration. */
export type TestConfig = {
  readonly runner: string;
  readonly cli: string;
  readonly cwd: string;
  readonly fixtureDir: string;
  /** Flags split into argv tokens (already excludes --progress-ndjson, added by the runner). */
  readonly flags: readonly string[];
  /** Where run-dirs live — read for history, written to for saved logs. */
  readonly runsDir: string;
  /** Path to the editable run-config YAML. */
  readonly configPath: string;
};

const DEFAULT_RUNNER = "bun";
const DEFAULT_CLI = "cli/bench.ts";
// Run options now come from the saved config (lib/test/config.ts); TEST_RUN_FLAGS
// is only for optional power-user extras appended on top, so it defaults empty.
const DEFAULT_FLAGS = "";
/** Bench package location relative to the Next package root (dev cwd). */
const DEFAULT_BENCH_CWD = resolve(process.cwd(), "../mcp/bench");

let cached: TestConfig | undefined;

/**
 * Returns the validated `/test` runner config, parsing `process.env` on first
 * call and caching the result. Throws a Zod error if `TEST_FIXTURE_DIR` is unset.
 *
 * Server-only — never import this into a Client Component.
 */
export const getTestConfig = (): TestConfig => {
  if (cached) return cached;
  const raw = RawTestEnvSchema.parse(process.env);
  const cwd = raw.TEST_BENCH_CWD ? resolve(raw.TEST_BENCH_CWD) : DEFAULT_BENCH_CWD;
  cached = {
    runner: raw.TEST_BENCH_RUNNER ?? DEFAULT_RUNNER,
    cli: raw.TEST_BENCH_CLI ?? DEFAULT_CLI,
    cwd,
    fixtureDir: resolve(raw.TEST_FIXTURE_DIR),
    flags: (raw.TEST_RUN_FLAGS ?? DEFAULT_FLAGS).split(/\s+/).filter(Boolean),
    runsDir: raw.TEST_RUNS_DIR ? resolve(raw.TEST_RUNS_DIR) : resolve(cwd, "state/runs"),
    configPath: raw.TEST_CONFIG_PATH
      ? resolve(raw.TEST_CONFIG_PATH)
      : resolve(cwd, "test-run.config.yaml"),
  };
  return cached;
};
