#!/usr/bin/env bun
// author: Claude
import { runGenerate } from "./generate";
import { runRun } from "./run";
import { runScore } from "./score";
import { runReport } from "./report";
import { runCompare } from "./compare";
import { runControlPin, runControlCheck } from "./control";
import { runMeasureNoiseFloor, runMeasureConsistency } from "./measure";
import { runHealth } from "./health";
import { logger } from "@/lib/logger";
import {
  BudgetExceededError,
  IntegrityViolationError,
  JudgeBatchExpiredError,
  JudgeIntegrityError,
  LockContentionError,
  OperatorAbortError,
  UsageError,
} from "@/lib/errors";

/**
 * Process exit codes by failure class (§28). Anything unrecognized — including
 * the generation/resolution/template/rate-limit family — falls through to
 * `GENERIC`, so only the codes that differ from 1 need an explicit branch.
 */
const EXIT_CODE = {
  USAGE: 64,
  OPERATOR_ABORT: 4,
  INTEGRITY_OR_BUDGET: 3,
  LOCK_CONTENTION: 2,
  GENERIC: 1,
} as const;

const HELP = `june-eval — synthetic-corpus RAG-quality benchmark for june.

USAGE
  june-eval <command> [args...]

COMMANDS
  generate    produce a fixture (facts + corpus + queries)
  run         drive Stages 4–9 against a fixture
  score       finalize an awaiting-verdicts run from external verdicts.json
  report      regenerate summary.md from results.json
  compare     diff two runs
  control-pin   pin a control (gemma4:26b) run as the golden baseline
  control-check fail if a control run regresses vs the golden baseline
  measure-noise-floor  measure retrieval determinism across ≥2 runs (asserts ≈0)
  measure-consistency  measure judge variance across ≥2 re-judges of one run
  health      provider + june + qdrant reachability probe

See \`june-eval <command> --help\` for command-specific flags.
`;

const dispatch = async (argv: readonly string[]): Promise<void> => {
  const sub = argv[0];
  if (!sub || sub === "--help" || sub === "-h") {
    process.stderr.write(HELP);
    return;
  }
  const rest = argv.slice(1);
  switch (sub) {
    case "generate":
      return runGenerate(rest);
    case "run":
      return runRun(rest);
    case "score":
      return runScore(rest);
    case "report":
      return runReport(rest);
    case "compare":
      return runCompare(rest);
    case "control-pin":
      return runControlPin(rest);
    case "control-check":
      return runControlCheck(rest);
    case "measure-noise-floor":
      return runMeasureNoiseFloor(rest);
    case "measure-consistency":
      return runMeasureConsistency(rest);
    case "health":
      return runHealth(rest);
    default:
      throw new UsageError(`Unknown subcommand: ${sub}`);
  }
};

const exitFor = (err: unknown): number => {
  if (err instanceof UsageError) return EXIT_CODE.USAGE;
  if (err instanceof OperatorAbortError) return EXIT_CODE.OPERATOR_ABORT;
  if (
    err instanceof IntegrityViolationError ||
    err instanceof JudgeIntegrityError ||
    err instanceof JudgeBatchExpiredError ||
    err instanceof BudgetExceededError
  ) {
    return EXIT_CODE.INTEGRITY_OR_BUDGET;
  }
  if (err instanceof LockContentionError) return EXIT_CODE.LOCK_CONTENTION;
  // Generation, resolution, template, and rate-limit failures all exit 1 —
  // the same code as any unexpected crash, so no explicit branch is needed.
  return EXIT_CODE.GENERIC;
};

try {
  await dispatch(process.argv.slice(2));
  process.exit(0);
} catch (err) {
  const code = exitFor(err);
  const message = err instanceof Error ? err.message : String(err);
  logger.error("cli.error", {
    message,
    name: err instanceof Error ? err.name : undefined,
    exit_code: code,
  });
  process.stderr.write(`\n${err instanceof Error ? err.name : "Error"}: ${message}\n`);
  process.exit(code);
}
