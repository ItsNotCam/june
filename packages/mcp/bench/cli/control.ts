// author: Claude
import { resolve, join } from "path";
import { writeFile } from "fs/promises";
import { z } from "zod";
import type { ResultsFile } from "@/types/results";
import { QUERY_TIERS } from "@/types/query";
import { readJson } from "@/lib/artifacts";
import { UsageError, OperatorAbortError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { bootstrap, parseArgv, flagString } from "./shared";

/**
 * One committed golden baseline — a pinned `control` (gemma4:26b) run that
 * defines "expected results" for a single fixture. `control-check` fails any
 * later control run that regresses per-tier correct% beyond `noise_floor`.
 * Self-contained (stores the snapshot, not a run-dir reference) so it survives
 * state/ pruning.
 */
const GoldenEntrySchema = z.object({
  run_id: z.string(),
  fixture_hash: z.string(),
  /** Max per-tier correct% drop tolerated as noise (establish by running control twice). */
  noise_floor: z.number().min(0).max(1),
  /** Per-tier reader-correct% at golden time. */
  per_tier_correct: z.record(z.string(), z.number()),
  note: z.string().optional(),
});
type GoldenEntry = z.infer<typeof GoldenEntrySchema>;

/**
 * The golden registry, keyed by `fixture_hash`. Each fixture keeps its OWN
 * golden so distinct fixtures (e.g. the current fixture vs the deep-hop T6/T7
 * fixture) never clobber each other — pinning one leaves the others untouched.
 */
const GoldenRegistrySchema = z.record(z.string(), GoldenEntrySchema);
type GoldenRegistry = z.infer<typeof GoldenRegistrySchema>;

const GOLDEN_PATH = join(import.meta.dir, "..", "golden.json");
const DEFAULT_NOISE_FLOOR = 0.05;

/**
 * Reads the golden registry, returning an empty registry when the file is
 * absent (nothing pinned yet). The on-disk shape is `{ [fixture_hash]: entry }`.
 */
const loadRegistry = async (): Promise<GoldenRegistry> => {
  let raw: unknown;
  try {
    raw = await readJson(GOLDEN_PATH);
  } catch {
    return {};
  }
  return GoldenRegistrySchema.parse(raw);
};

const perTierCorrect = (results: ResultsFile): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const tier of QUERY_TIERS) {
    const t = results.per_tier[tier];
    if (t) out[tier] = t.reader_correct_pct.point;
  }
  return out;
};

const assertControl = (results: ResultsFile, verb: string): void => {
  if (results.manifest.mode !== "control") {
    throw new UsageError(
      `${verb} requires a CONTROL run (gemma4:26b), but this run is mode="${results.manifest.mode}". ` +
        `Only --mode control runs are authoritative. See src/lib/modes.ts.`,
    );
  }
};

/**
 * `june-eval control-pin <run_dir> [--noise-floor <0..1>]` — pins a control run
 * as the golden baseline. Set `--noise-floor` from the consistency run (run
 * control twice; the max per-tier correct% drift is the floor).
 */
export const runControlPin = async (argv: readonly string[]): Promise<void> => {
  const { positionals, flags } = parseArgv(argv);
  if (positionals.includes("--help") || positionals.length < 1) {
    process.stderr.write(CONTROL_PIN_HELP);
    if (positionals.length < 1) throw new UsageError("Missing <run_dir>");
    return;
  }
  await bootstrap(flags);
  const results = (await readJson(
    join(resolve(positionals[0]!), "results.json"),
  )) as ResultsFile;
  assertControl(results, "control-pin");

  const nfStr = flagString(flags, "noise-floor");
  const noise_floor = nfStr !== undefined ? Number(nfStr) : DEFAULT_NOISE_FLOOR;
  if (!Number.isFinite(noise_floor) || noise_floor < 0 || noise_floor > 1) {
    throw new UsageError(`--noise-floor must be in [0,1]; got "${nfStr}".`);
  }

  const entry: GoldenEntry = {
    run_id: results.run_id,
    fixture_hash: results.manifest.fixture_hash,
    noise_floor,
    per_tier_correct: perTierCorrect(results),
    note: "Pinned gemma4:26b control baseline — the bar for 'expected results'. See packages/mcp/bench/CLAUDE.md.",
  };
  const registry = await loadRegistry();
  registry[entry.fixture_hash] = entry;
  await writeFile(GOLDEN_PATH, `${JSON.stringify(registry, null, 2)}\n`, "utf-8");
  logger.info("control.pinned", { run_id: results.run_id, fixture_hash: entry.fixture_hash });
  process.stderr.write(
    `Pinned golden for fixture ${entry.fixture_hash} = ${results.run_id} (noise_floor ${noise_floor}). Wrote ${GOLDEN_PATH}\n`,
  );
};

/**
 * `june-eval control-check <run_dir>` — fails (exit 3) if a control run
 * regresses any tier's correct% beyond the golden noise floor.
 */
export const runControlCheck = async (argv: readonly string[]): Promise<void> => {
  const { positionals, flags } = parseArgv(argv);
  if (positionals.includes("--help") || positionals.length < 1) {
    process.stderr.write(CONTROL_CHECK_HELP);
    if (positionals.length < 1) throw new UsageError("Missing <run_dir>");
    return;
  }
  await bootstrap(flags);
  const results = (await readJson(
    join(resolve(positionals[0]!), "results.json"),
  )) as ResultsFile;
  assertControl(results, "control-check");

  const registry = await loadRegistry();
  const golden = registry[results.manifest.fixture_hash];
  if (!golden) {
    process.stderr.write(
      `No golden baseline pinned for fixture ${results.manifest.fixture_hash} yet. Pin this run with:\n  june-eval control-pin ${positionals[0]}\n`,
    );
    return;
  }

  const candidate = perTierCorrect(results);
  const regressions: string[] = [];
  const lines: string[] = [];
  for (const tier of QUERY_TIERS) {
    const g = golden.per_tier_correct[tier];
    const c = candidate[tier];
    if (g === undefined || c === undefined) continue;
    const delta = c - g;
    const regressed = delta < -golden.noise_floor;
    if (regressed) regressions.push(`${tier}: ${(g * 100).toFixed(1)}% → ${(c * 100).toFixed(1)}% (Δ ${(delta * 100).toFixed(1)}pp)`);
    lines.push(
      `  ${tier}: ${(g * 100).toFixed(1)}% → ${(c * 100).toFixed(1)}%  (Δ ${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}pp)${regressed ? "  ✗ REGRESSION" : ""}`,
    );
  }
  process.stderr.write(
    `control-check: ${results.run_id} vs golden ${golden.run_id} (noise floor ${(golden.noise_floor * 100).toFixed(1)}pp)\n${lines.join("\n")}\n`,
  );
  if (regressions.length > 0) {
    throw new OperatorAbortError(
      `control-check FAILED — ${regressions.length} tier(s) regressed beyond the noise floor:\n  ${regressions.join("\n  ")}`,
    );
  }
  process.stderr.write(`control-check PASSED — no tier regressed beyond the noise floor.\n`);
};

const CONTROL_PIN_HELP = `june-eval control-pin — pin a control run as the golden baseline.

USAGE
  june-eval control-pin <run_dir> [--noise-floor <0..1>] [--config <path>]

Only a --mode control (gemma4:26b) run can be pinned. Set --noise-floor from the
consistency run (run control twice; the max per-tier drift is the floor).
`;

const CONTROL_CHECK_HELP = `june-eval control-check — fail if a control run regresses vs the golden baseline.

USAGE
  june-eval control-check <run_dir> [--config <path>]

Exits non-zero if any tier's reader-correct% drops more than the golden noise floor.
`;
