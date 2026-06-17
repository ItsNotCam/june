// author: Claude
import { resolve, join } from "path";
import type { JudgeTask, JudgeTasksFile } from "@/types/judge-tasks";
import type { CalibrationRecord } from "@/types/calibration";
import { VerdictsFileSchema } from "@/schemas/verdict";
import {
  loadGoldSet,
  scoreCalibration,
  writeCalibrationRecord,
  calibrationStatus,
  computeGoldSetHash,
  judgeKey,
  DEFAULT_MIN_KAPPA,
  DEFAULT_GOLD_SET_PATH,
  CALIBRATION_REGISTRY_PATH,
} from "@/lib/calibration";
import { promptTemplateHash } from "@/lib/prompts";
import { readJson, writeJsonAtomic } from "@/lib/artifacts";
import { UsageError, JudgeCalibrationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { bootstrap, parseArgv, flagString } from "./shared";

/**
 * `validate-judge` (§ RSI Phase 5) — calibrate the LLM judge against a committed
 * human-labeled gold set, the precondition for letting agent verdicts certify a
 * run. No-API, mirroring the judge seam: `emit` writes the gold cases as a
 * `judge_tasks.json` (the orchestrator's Sonnet agents judge them per
 * JUDGE-RUNNER.md → `verdicts.json`); `score` computes Cohen's κ vs the human
 * labels, writes the calibration record keyed by judge identity, and FAILS
 * (exit 3) below the threshold. `status` reports whether a judge is licensed.
 */

const CALIBRATION_FIXTURE_ID = "judge-calibration";

// ---------------------------------------------------------------------------
// validate-judge emit — gold cases → a judge_tasks.json for the agents
// ---------------------------------------------------------------------------
export const runValidateJudgeEmit = async (argv: readonly string[]): Promise<void> => {
  const { positionals, flags } = parseArgv(argv);
  if (positionals.includes("--help")) {
    process.stderr.write(EMIT_HELP);
    return;
  }
  await bootstrap(flags);

  const goldPath = resolve(flagString(flags, "gold") ?? DEFAULT_GOLD_SET_PATH);
  const gold = await loadGoldSet(goldPath);
  const goldHash = computeGoldSetHash(gold.cases);
  const promptHash = await promptTemplateHash("judge");

  const tasks: JudgeTask[] = gold.cases.map((c) => ({
    query_id: c.id,
    query_text: c.query_text,
    tier: c.tier,
    expected_facts: c.expected_surface_hints.map((h) => ({ surface_hint: h })),
    reader_answer: c.reader_answer,
    retrieved_context: c.retrieved_context,
    is_baseline: c.is_baseline ?? false,
  }));
  const file: JudgeTasksFile = {
    fixture_id: CALIBRATION_FIXTURE_ID,
    run_id: `calibration-${goldHash.slice(0, 12)}`,
    schema_version: 1,
    prompt_template: "judge",
    prompt_template_hash: promptHash,
    tasks,
  };

  const outPath = resolve(flagString(flags, "out") ?? join(process.cwd(), "judge-calibration-tasks.json"));
  await writeJsonAtomic(outPath, file);

  logger.info("validate_judge.emit", {
    note: `${tasks.length} gold tasks → ${outPath}`,
    prompt_template_hash: promptHash,
  });
  process.stderr.write(
    `Emitted ${tasks.length} calibration tasks → ${outPath}\n` +
      `  gold_set_hash: ${goldHash.slice(0, 12)}…  ·  prompt ${promptHash.slice(0, 12)}…\n` +
      `  Judge them with the orchestrator's Sonnet agents (JUDGE-RUNNER.md) → verdicts.json, then:\n` +
      `  june-eval validate-judge score <verdicts.json>\n`,
  );
};

// ---------------------------------------------------------------------------
// validate-judge score — κ vs human labels → calibration record (gate)
// ---------------------------------------------------------------------------
export const runValidateJudgeScore = async (argv: readonly string[]): Promise<void> => {
  const { positionals, flags } = parseArgv(argv);
  if (positionals.includes("--help") || positionals.length < 1) {
    process.stderr.write(SCORE_HELP);
    if (positionals.length < 1) throw new UsageError("Missing <verdicts.json>");
    return;
  }
  await bootstrap(flags);

  const goldPath = resolve(flagString(flags, "gold") ?? DEFAULT_GOLD_SET_PATH);
  const gold = await loadGoldSet(goldPath);
  const verdicts = VerdictsFileSchema.parse(await readJson(resolve(positionals[0]!)));

  const minKappaStr = flagString(flags, "min-kappa");
  const min_kappa = minKappaStr !== undefined ? Number(minKappaStr) : DEFAULT_MIN_KAPPA;
  if (!Number.isFinite(min_kappa) || min_kappa < 0 || min_kappa > 1) {
    throw new UsageError(`--min-kappa must be in [0,1]; got ${JSON.stringify(minKappaStr)}.`);
  }

  const record = scoreCalibration({
    gold: gold.cases,
    verdicts: verdicts.verdicts,
    judge: {
      kind: verdicts.judge.kind,
      model: verdicts.judge.model,
      prompt_template_hash: verdicts.judge.prompt_template_hash,
    },
    min_kappa,
    judged_at: new Date().toISOString(),
    ...(flagString(flags, "note") !== undefined ? { note: flagString(flags, "note")! } : {}),
  });

  const registryPath = resolve(flagString(flags, "out") ?? CALIBRATION_REGISTRY_PATH);
  await writeCalibrationRecord(record, registryPath);

  process.stderr.write(renderCalibrationReport(record));
  logger.info("validate_judge.scored", {
    judge_model: record.judge.model,
    cohens_kappa: record.cohens_kappa,
    passed: record.passed,
  });

  if (!record.passed) {
    throw new JudgeCalibrationError(
      `Judge "${record.judge.model}" is NOT calibrated: κ ${record.cohens_kappa.toFixed(3)} ` +
        `(threshold ${min_kappa}), ${record.n - countJudged(record)} unjudged. It may not certify a run until κ ≥ ${min_kappa}.`,
      record.cohens_kappa,
      min_kappa,
    );
  }
};

// ---------------------------------------------------------------------------
// validate-judge status — is a judge identity licensed?
// ---------------------------------------------------------------------------
export const runValidateJudgeStatus = async (argv: readonly string[]): Promise<void> => {
  const { positionals, flags } = parseArgv(argv);
  if (positionals.includes("--help")) {
    process.stderr.write(STATUS_HELP);
    return;
  }
  await bootstrap(flags);

  const model = flagString(flags, "judge-model");
  if (model === undefined) {
    // No identity given — dump the whole registry.
    const registry = await readJson(CALIBRATION_REGISTRY_PATH).catch(() => ({}));
    const entries = Object.entries(registry as Record<string, CalibrationRecord>);
    if (entries.length === 0) {
      process.stderr.write("No judge calibration records yet. Run `validate-judge emit` → judge → `score`.\n");
      return;
    }
    for (const [key, rec] of entries) {
      process.stderr.write(
        `${rec.passed ? "✅" : "❌"} ${key}  κ=${rec.cohens_kappa.toFixed(3)} ` +
          `(raw ${(rec.raw_agreement * 100).toFixed(0)}%, lenient ${(rec.lenient_agreement * 100).toFixed(0)}%, n=${rec.n})\n`,
      );
    }
    return;
  }

  const prompt_template_hash = flagString(flags, "judge-prompt-hash") ?? (await promptTemplateHash("judge"));
  const status = await calibrationStatus({ model, prompt_template_hash });
  if (status.licensed) {
    process.stderr.write(
      `✅ LICENSED — ${judgeKey({ model, prompt_template_hash })}: κ ${status.record.cohens_kappa.toFixed(3)} ≥ ${status.record.min_kappa} (n=${status.record.n}).\n`,
    );
  } else {
    process.stderr.write(`❌ NOT licensed — ${status.reason}.\n`);
  }
};

const countJudged = (record: CalibrationRecord): number =>
  Object.values(record.per_class).reduce((acc, s) => acc + (s?.support ?? 0), 0) -
  (record.confusion.find((c) => c.b === "UNJUDGED")?.count ?? 0);

const renderCalibrationReport = (r: CalibrationRecord): string => {
  const lines: string[] = [];
  lines.push(
    `\nvalidate-judge: ${r.judge.model} (prompt ${r.judge.prompt_template_hash.slice(0, 12)}…) vs gold n=${r.n}`,
  );
  lines.push(
    `  Cohen's κ ${r.cohens_kappa.toFixed(3)} (threshold ${r.min_kappa}) — ${r.passed ? "✅ PASS" : "❌ FAIL"}`,
  );
  lines.push(
    `  raw agreement ${(r.raw_agreement * 100).toFixed(1)}%  ·  lenient (acceptable-set) ${(r.lenient_agreement * 100).toFixed(1)}%`,
  );
  lines.push(`  per-class (human → agree/support):`);
  for (const [cls, stat] of Object.entries(r.per_class)) {
    lines.push(`    ${cls.padEnd(13)} ${stat!.agree}/${stat!.support}`);
  }
  const disagreements = r.confusion.filter((c) => c.a !== c.b);
  if (disagreements.length > 0) {
    lines.push(`  disagreements (human → agent):`);
    for (const c of disagreements) lines.push(`    ${c.a.padEnd(13)} → ${c.b.padEnd(13)} ×${c.count}`);
  }
  lines.push("");
  return lines.join("\n");
};

const EMIT_HELP = `june-eval validate-judge emit — emit the calibration gold set as judge tasks (NO API).

USAGE
  june-eval validate-judge emit [--gold <path>] [--out <tasks.json>] [--config <path>]

Writes the human-labeled gold cases as a judge_tasks.json (same shape a real run
emits). Judge them with the orchestrator's Sonnet agents (JUDGE-RUNNER.md) →
verdicts.json, then \`validate-judge score\`. Default gold: __test__/judge/fixtures/calibration-gold.json.
`;

const SCORE_HELP = `june-eval validate-judge score — score agent verdicts vs the human gold (Cohen's κ gate).

USAGE
  june-eval validate-judge score <verdicts.json> [--gold <path>] [--min-kappa <0..1>]
                                 [--out <registry.json>] [--note <text>] [--config <path>]

Computes Cohen's κ between the agent verdicts and the canonical human labels, writes
the calibration record (keyed by judge model + prompt hash) into judge-calibration.json,
and EXITS NON-ZERO if κ < --min-kappa (default ${DEFAULT_MIN_KAPPA}) or any gold case was
left UNJUDGED. A passing record licenses that judge identity for \`control-pin\`.
`;

const STATUS_HELP = `june-eval validate-judge status — is a judge identity licensed?

USAGE
  june-eval validate-judge status [--judge-model <m> [--judge-prompt-hash <h>]] [--config <path>]

With no --judge-model, lists every calibration record. With one, reports whether that
judge is LICENSED (passing κ against the CURRENT gold set) — the \`control-pin\` precondition.
`;

/** Dispatches `validate-judge <emit|score|status>`. */
export const runValidateJudge = async (argv: readonly string[]): Promise<void> => {
  const sub = argv[0];
  const rest = argv.slice(1);
  switch (sub) {
    case "emit":
      return runValidateJudgeEmit(rest);
    case "score":
      return runValidateJudgeScore(rest);
    case "status":
      return runValidateJudgeStatus(rest);
    case undefined:
    case "--help":
      process.stderr.write(VALIDATE_JUDGE_HELP);
      return;
    default:
      throw new UsageError(`Unknown validate-judge subcommand: ${sub}. Use emit | score | status.`);
  }
};

const VALIDATE_JUDGE_HELP = `june-eval validate-judge — calibrate the LLM judge vs a human gold set (Cohen's κ gate).

USAGE
  june-eval validate-judge emit    [--gold <path>] [--out <tasks.json>]
  june-eval validate-judge score   <verdicts.json> [--min-kappa <0..1>] [--gold <path>]
  june-eval validate-judge status  [--judge-model <m> [--judge-prompt-hash <h>]]

Phase 5: a judge identity (model + prompt hash) may certify a \`control\` run only when
it has a PASSING κ record against the current gold set. \`control-pin\` enforces it.
`;
