// author: Claude
import type { Fact, FactsFile } from "@/types/facts";
import { getDomainTemplate } from "@/domains";
import { seededRng } from "@/lib/rng";
import { fixtureId } from "@/lib/ids";
import { writeJsonAtomic } from "@/lib/artifacts";
import { FactGenerationError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Stage 1 — deterministic fact generation (§15).
 *
 * Pure: same `(seed, domain_name)` → byte-identical `facts.json`. No LLM, no
 * network, no Date.now() feed into the facts themselves (only the
 * `generated_at` metadata, which is explicitly not hashed into `fixture_id`).
 *
 * Validates the template's output and writes the artifact atomically. Any
 * validation failure throws `FactGenerationError` (exit code 1) — these are
 * template bugs, not operator bugs, and the run should not proceed.
 */
export const runStage1 = async (args: {
  seed: number;
  domain: string;
  out_path: string;
}): Promise<FactsFile> => {
  const template = getDomainTemplate(args.domain);
  if (!template) {
    throw new FactGenerationError(
      `Unknown domain template: ${args.domain}`,
    );
  }

  const rng = seededRng(args.seed);
  const { facts } = template.generate(rng);

  validateFacts(facts);

  const file: FactsFile = {
    fixture_id: fixtureId(args.seed, template.domain_name),
    fixture_seed: args.seed,
    schema_version: 1,
    domain_name: template.domain_name,
    generated_at: new Date().toISOString(),
    facts,
  };

  await writeJsonAtomic(args.out_path, file);
  logger.info("stage.1.complete", {
    fixture_id: file.fixture_id,
    atomic_count: facts.filter((f) => f.kind === "atomic").length,
    relational_count: facts.filter((f) => f.kind === "relational").length,
  });
  return file;
};

/**
 * Validates generated facts (§15). Any violation is a template bug.
 *
 * Checks:
 * 1. Every fact id is unique.
 * 2. Every relational subject and object appears as an atomic entity
 *    (connected-graph property — required for T4 answerability).
 * 3. Every atomic `surface_hint` includes the `value` substring;
 *    every relational `surface_hint` includes the `object` substring.
 * 4. No two facts share a byte-identical `surface_hint`.
 */
export const validateFacts = (facts: Fact[]): void => {
  const ids = new Set<string>();
  const atomicEntities = new Set<string>();
  const hints = new Set<string>();

  for (const f of facts) {
    if (ids.has(f.id)) {
      throw new FactGenerationError(`Duplicate fact id: ${f.id}`);
    }
    ids.add(f.id);

    if (hints.has(f.surface_hint)) {
      throw new FactGenerationError(
        `Duplicate surface_hint (breaks ground-truth resolution): "${f.surface_hint}"`,
      );
    }
    hints.add(f.surface_hint);

    if (f.kind === "atomic") {
      atomicEntities.add(f.entity);
      if (!f.surface_hint.includes(f.value)) {
        throw new FactGenerationError(
          `Atomic fact ${f.id}: surface_hint does not contain value "${f.value}"`,
        );
      }
    }
  }

  for (const f of facts) {
    if (f.kind === "relational") {
      if (!atomicEntities.has(f.subject)) {
        throw new FactGenerationError(
          `Relational fact ${f.id}: subject "${f.subject}" is not an atomic entity`,
        );
      }
      if (!atomicEntities.has(f.object)) {
        throw new FactGenerationError(
          `Relational fact ${f.id}: object "${f.object}" is not an atomic entity`,
        );
      }
      if (!f.surface_hint.includes(f.object)) {
        throw new FactGenerationError(
          `Relational fact ${f.id}: surface_hint does not contain object "${f.object}"`,
        );
      }
    }
  }
};
