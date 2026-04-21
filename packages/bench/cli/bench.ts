// author: Claude
#!/usr/bin/env bun
import { runGenerate } from "./generate";
import { runRun } from "./run";
import { runReport } from "./report";
import { runCompare } from "./compare";
import { runHealth } from "./health";
import { logger } from "@/lib/logger";
import {
  BudgetExceededError,
  CorpusTamperedError,
  CorpusValidationError,
  FactGenerationError,
  GroundTruthResolutionError,
  IntegrityViolationError,
  JudgeBatchExpiredError,
  JudgeIntegrityError,
  LockContentionError,
  OperatorAbortError,
  PromptTemplateError,
  ProviderRateLimitExhausted,
  UsageError,
} from "@/lib/errors";

const HELP = `june-eval — synthetic-corpus RAG-quality benchmark for june.

USAGE
  june-eval <command> [args...]

COMMANDS
  generate    produce a fixture (facts + corpus + queries)
  run         drive Stages 4–9 against a fixture
  report      regenerate summary.md from results.json
  compare     diff two runs
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
    case "report":
      return runReport(rest);
    case "compare":
      return runCompare(rest);
    case "health":
      return runHealth(rest);
    default:
      throw new UsageError(`Unknown subcommand: ${sub}`);
  }
};

const exitFor = (err: unknown): number => {
  if (err instanceof UsageError) return 64;
  if (err instanceof OperatorAbortError) return 4;
  if (
    err instanceof IntegrityViolationError ||
    err instanceof JudgeIntegrityError ||
    err instanceof JudgeBatchExpiredError ||
    err instanceof BudgetExceededError
  ) {
    return 3;
  }
  if (err instanceof LockContentionError) return 2;
  if (
    err instanceof FactGenerationError ||
    err instanceof CorpusValidationError ||
    err instanceof CorpusTamperedError ||
    err instanceof GroundTruthResolutionError ||
    err instanceof PromptTemplateError ||
    err instanceof ProviderRateLimitExhausted
  ) {
    return 1;
  }
  return 1;
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
