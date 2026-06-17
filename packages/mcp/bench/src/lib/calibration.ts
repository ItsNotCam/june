// author: Claude
import { join } from "path";
import type { VerdictRecord } from "@/types/judge";
import type { Verdict } from "@/types/verdict";
import type {
  GoldCase,
  GoldSetFile,
  CalibrationRecord,
  CalibrationRegistry,
  ClassStat,
} from "@/types/calibration";
import { cohensKappa, confusionMatrix, type LabelPair } from "@/lib/kappa";
import { readJson, writeJsonAtomic, sha256Hex, fileExists } from "@/lib/artifacts";

/**
 * Judge calibration scoring + the licensing gate (§ RSI Phase 5).
 *
 * `scoreCalibration` is pure: gold cases + agent verdicts → a `CalibrationRecord`
 * (Cohen's κ, agreement, confusion, pass/fail). The registry is the on-disk
 * `judge-calibration.json` keyed by judge identity; `assertJudgeCalibrated` is
 * the precondition `control-pin` enforces — a judge may certify a run only when
 * its identity has a PASSING record against the CURRENT gold set.
 */

/** Default κ gate — TREC/dossier "fair-to-good" agreement; below this the judge is unreliable. */
export const DEFAULT_MIN_KAPPA = 0.7;

/** Package-root paths — beside `golden.json`, committed (the licensing record + the gold set). */
export const CALIBRATION_REGISTRY_PATH = join(import.meta.dir, "..", "..", "judge-calibration.json");
export const DEFAULT_GOLD_SET_PATH = join(
  import.meta.dir,
  "..",
  "..",
  "__test__",
  "judge",
  "fixtures",
  "calibration-gold.json",
);

/** Stable identity key for a judge — model + the exact prompt it ran. */
export const judgeKey = (judge: { model: string; prompt_template_hash: string }): string =>
  `${judge.model}::${judge.prompt_template_hash}`;

/** Canonical hash of the gold cases — any edit invalidates an existing license. */
export const computeGoldSetHash = (cases: readonly GoldCase[]): string =>
  sha256Hex(JSON.stringify(cases));

/** Reads + lightly validates the gold set (a malformed gold is an operator error, not drift). */
export const loadGoldSet = async (path: string): Promise<GoldSetFile> => {
  const raw = (await readJson(path)) as GoldSetFile;
  if (!Array.isArray(raw.cases) || raw.cases.length === 0) {
    throw new Error(`calibration gold set at ${path} has no cases`);
  }
  for (const c of raw.cases) {
    if (!c.id || !c.human_verdict || !Array.isArray(c.acceptable_verdicts)) {
      throw new Error(`calibration gold case is malformed (id=${c.id ?? "?"})`);
    }
    if (!c.acceptable_verdicts.includes(c.human_verdict)) {
      throw new Error(
        `calibration gold case ${c.id}: human_verdict "${c.human_verdict}" not in acceptable_verdicts`,
      );
    }
  }
  return raw;
};

/** The current gold set's hash (default path), for the gate's staleness check. */
export const currentGoldSetHash = async (path = DEFAULT_GOLD_SET_PATH): Promise<string> =>
  computeGoldSetHash((await loadGoldSet(path)).cases);

/**
 * Scores agent verdicts against the human-labeled gold set — PURE (no I/O). A
 * gold case with no agent verdict (or an `UNJUDGED` one) counts as a
 * disagreement (paired against `"UNJUDGED"`), and blocks `passed`: a judge that
 * couldn't grade part of the gold isn't licensed.
 */
export const scoreCalibration = (args: {
  gold: readonly GoldCase[];
  verdicts: readonly VerdictRecord[];
  judge: { kind: string; model: string; prompt_template_hash: string };
  min_kappa: number;
  judged_at: string;
  note?: string;
}): CalibrationRecord => {
  const byId = new Map(args.verdicts.map((v) => [v.query_id, v.verdict]));

  const pairs: LabelPair[] = [];
  const perClass: Partial<Record<Verdict, ClassStat>> = {};
  let rawAgree = 0;
  let lenientAgree = 0;
  let unjudged = 0;

  for (const c of args.gold) {
    const agent = byId.get(c.id) ?? "UNJUDGED";
    if (agent === "UNJUDGED") unjudged++;
    pairs.push({ a: c.human_verdict, b: agent });

    const exact = agent === c.human_verdict;
    if (exact) rawAgree++;
    if (c.acceptable_verdicts.includes(agent as Verdict)) lenientAgree++;

    const stat = (perClass[c.human_verdict] ??= { support: 0, agree: 0 });
    stat.support++;
    if (exact) stat.agree++;
  }

  const n = args.gold.length;
  const cohens_kappa = cohensKappa(pairs);
  const passed = n > 0 && cohens_kappa >= args.min_kappa && unjudged === 0;

  return {
    schema_version: 1,
    judge: args.judge,
    gold_set_hash: computeGoldSetHash(args.gold),
    n,
    cohens_kappa,
    raw_agreement: n === 0 ? 0 : rawAgree / n,
    lenient_agreement: n === 0 ? 0 : lenientAgree / n,
    min_kappa: args.min_kappa,
    passed,
    per_class: perClass,
    confusion: confusionMatrix(pairs),
    judged_at: args.judged_at,
    ...(args.note !== undefined ? { note: args.note } : {}),
  };
};

/** Reads the calibration registry, tolerating absence (→ empty) and malformed entries. */
export const loadCalibrationRegistry = async (
  path = CALIBRATION_REGISTRY_PATH,
): Promise<CalibrationRegistry> => {
  if (!(await fileExists(path))) return {};
  try {
    const raw = (await readJson(path)) as unknown;
    if (typeof raw !== "object" || raw === null) return {};
    return raw as CalibrationRegistry;
  } catch {
    return {};
  }
};

/** Upserts a record (keyed by judge identity) into the registry on disk. */
export const writeCalibrationRecord = async (
  record: CalibrationRecord,
  path = CALIBRATION_REGISTRY_PATH,
): Promise<void> => {
  const registry = await loadCalibrationRegistry(path);
  registry[judgeKey(record.judge)] = record;
  await writeJsonAtomic(path, registry);
};

export type CalibrationStatus =
  | { licensed: true; record: CalibrationRecord }
  | { licensed: false; reason: string; record: CalibrationRecord | null };

/**
 * Looks up whether a judge identity is licensed: a PASSING record must exist for
 * its `${model}::${prompt_hash}` AND have been measured against the CURRENT gold
 * set (a changed gold demands re-validation). Pure-ish: reads the registry + the
 * gold hash, returns a verdict — the CLI/gate decides whether to throw.
 */
export const calibrationStatus = async (
  judge: { model: string; prompt_template_hash: string },
  opts: { registryPath?: string; goldPath?: string } = {},
): Promise<CalibrationStatus> => {
  const registry = await loadCalibrationRegistry(opts.registryPath ?? CALIBRATION_REGISTRY_PATH);
  const record = registry[judgeKey(judge)] ?? null;
  if (!record) {
    return { licensed: false, reason: "no calibration record for this judge identity", record: null };
  }
  if (!record.passed) {
    return {
      licensed: false,
      reason: `calibration failed (κ ${record.cohens_kappa.toFixed(3)} < ${record.min_kappa})`,
      record,
    };
  }
  const goldHash = await currentGoldSetHash(opts.goldPath ?? DEFAULT_GOLD_SET_PATH);
  if (record.gold_set_hash !== goldHash) {
    return {
      licensed: false,
      reason: "calibration is STALE — the gold set changed since this judge was validated",
      record,
    };
  }
  return { licensed: true, record };
};
