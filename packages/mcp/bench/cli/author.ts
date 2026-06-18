// author: Claude
import { resolve, join } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import type { FactsFile } from "@/types/facts";
import {
  buildAuthoringPlan,
  assembleCorpus,
  assembleQueries,
  DEFAULT_QUERY_COUNTS,
  type AuthoringPlan,
  type QueryCounts,
} from "@/lib/authoring";
import { runStage1 } from "@/stages/01-facts";
import { readJson, writeJsonAtomic, fileExists } from "@/lib/artifacts";
import { UsageError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { bootstrap, getConfig, parseArgv, flagString } from "./shared";

/**
 * No-API fixture authoring driver (§ RSI Phase 3). `scaffold` emits the
 * deterministic skeleton (facts + an authoring plan) with NO LLM; the
 * orchestrator's agents then author the prose (sonnet corpus / opus queries);
 * `assemble` validates that prose and writes the fixture artifacts. See
 * AUTHORING.md for the agent protocol. `freeze` then commits the result.
 */

const PLAN_FILENAME = "authoring_plan.json";

/**
 * `june-eval scaffold <domain> --seed <n> --out <dir> [--counts T1..T7] [--entities <n>]`
 * Runs Stage 1 (deterministic facts, no API) and writes facts.json + the
 * authoring plan. The plan says WHICH facts each document/query must cover.
 */
export const runScaffold = async (argv: readonly string[]): Promise<void> => {
  const { positionals, flags } = parseArgv(argv);
  if (positionals.includes("--help") || positionals.length < 1) {
    process.stderr.write(SCAFFOLD_HELP);
    if (positionals.length < 1) throw new UsageError("Missing <domain>");
    return;
  }
  await bootstrap(flags);

  const domain = positionals[0]!;
  const seedStr = flagString(flags, "seed");
  const seed = seedStr !== undefined ? Number(seedStr) : undefined;
  if (seed === undefined || !Number.isInteger(seed)) {
    throw new UsageError(`--seed <integer> is required (got ${JSON.stringify(seedStr)}).`);
  }
  const outDir = resolve(flagString(flags, "out") ?? `./state/scaffold/${domain}-${seed}`);
  const counts = parseCounts(flagString(flags, "counts"));
  const entitiesStr = flagString(flags, "entities");
  const entityCount = entitiesStr !== undefined ? Number(entitiesStr) : undefined;
  if (entityCount !== undefined && (!Number.isInteger(entityCount) || entityCount < 1)) {
    throw new UsageError(`--entities <positive integer> (got ${JSON.stringify(entitiesStr)}).`);
  }

  await mkdir(outDir, { recursive: true });
  const facts = await runStage1({ seed, domain, out_path: join(outDir, "facts.json"), entityCount });
  const plan = buildAuthoringPlan(facts, {
    maxFactsPerDoc: getConfig().corpus.max_facts_per_doc,
    counts,
  });
  await writeJsonAtomic(join(outDir, PLAN_FILENAME), plan);

  logger.info("scaffold.complete", {
    fixture_id: facts.fixture_id,
    note: `${plan.documents.length} docs, ${plan.query_specs.length} query specs`,
  });
  process.stderr.write(
    `Scaffolded ${facts.domain_name} (seed ${seed}) → ${outDir}\n` +
      `  fixture_id: ${facts.fixture_id}\n` +
      `  ${plan.documents.length} documents to author (sonnet), ${plan.query_specs.length} queries to author (opus).\n` +
      `  Next: agents author corpus drafts (<slug>.md) + a query-drafts JSON, then \`june-eval assemble\`. See AUTHORING.md.\n`,
  );
};

/**
 * `june-eval assemble <scaffold_dir> --corpus-drafts <dir> --query-drafts <file>
 *    --corpus-model <m> --query-model <m> --out <fixture_dir>`
 * Validates agent drafts (hints embedded; anti-leakage) and writes the fixture.
 */
export const runAssemble = async (argv: readonly string[]): Promise<void> => {
  const { positionals, flags } = parseArgv(argv);
  if (positionals.includes("--help") || positionals.length < 1) {
    process.stderr.write(ASSEMBLE_HELP);
    if (positionals.length < 1) throw new UsageError("Missing <scaffold_dir>");
    return;
  }
  await bootstrap(flags);

  const scaffoldDir = resolve(positionals[0]!);
  const corpusDrafts = flagString(flags, "corpus-drafts");
  const queryDrafts = flagString(flags, "query-drafts");
  const corpusModel = flagString(flags, "corpus-model");
  const queryModel = flagString(flags, "query-model");
  const outDir = resolve(flagString(flags, "out") ?? join(scaffoldDir, "fixture"));
  if (!corpusDrafts || !queryDrafts || !corpusModel || !queryModel) {
    throw new UsageError(
      "assemble requires --corpus-drafts <dir> --query-drafts <file> --corpus-model <m> --query-model <m>.",
    );
  }
  if (corpusModel === queryModel) {
    throw new UsageError(
      `--corpus-model and --query-model must DIFFER (anti-collusion). Both were "${corpusModel}".`,
    );
  }

  const facts = (await readJson(join(scaffoldDir, "facts.json"))) as FactsFile;
  const plan = (await readJson(join(scaffoldDir, PLAN_FILENAME))) as AuthoringPlan;

  // Corpus drafts: <corpus-drafts>/<slug>.md per planned document.
  const docMarkdown = new Map<string, string>();
  for (const doc of plan.documents) {
    const p = join(resolve(corpusDrafts), `${doc.slug}.md`);
    if (!(await fileExists(p))) {
      throw new UsageError(`assemble: missing corpus draft for "${doc.slug}" at ${p}.`);
    }
    docMarkdown.set(doc.slug, await readFile(p, "utf-8"));
  }
  // Query drafts: a JSON object { spec_id: text }.
  const rawQ = (await readJson(resolve(queryDrafts))) as Record<string, string>;
  const queryText = new Map<string, string>(Object.entries(rawQ));

  const corpusDir = join(outDir, "corpus");
  const { manifest, files } = assembleCorpus({
    plan,
    docMarkdown,
    corpusDir,
    author: { provider: "claude-code-agent", model: corpusModel },
  });
  const queries = assembleQueries({
    plan,
    queryText,
    threshold: getConfig().anti_leakage.threshold,
    author: { provider: "claude-code-agent", model: queryModel },
  });

  await mkdir(corpusDir, { recursive: true });
  await Promise.all(files.map((f) => writeFile(join(corpusDir, f.filename), f.markdown, "utf-8")));
  await writeJsonAtomic(join(outDir, "facts.json"), facts);
  await writeJsonAtomic(join(outDir, "corpus_manifest.json"), manifest);
  await writeJsonAtomic(join(outDir, "queries.json"), queries);

  logger.info("assemble.complete", {
    fixture_id: facts.fixture_id,
    note: `${files.length} docs, ${queries.queries.length} queries → ${outDir}`,
  });
  process.stderr.write(
    `Assembled fixture → ${outDir}\n` +
      `  ${files.length} documents (corpus ${corpusModel}), ${queries.queries.length} queries (queries ${queryModel}).\n` +
      `  All surface hints verified present; anti-leakage under threshold.\n` +
      `  Next: \`june-eval freeze ${outDir} --name <name> --signoff <who>\`.\n`,
  );
};

const parseCounts = (s: string | undefined): QueryCounts | undefined => {
  if (s === undefined) return undefined;
  const parts = s.split(",").map((x) => Number(x.trim()));
  if (parts.length !== 7 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
    throw new UsageError(
      `--counts expects seven non-negative integers "T1,T2,T3,T4,T5,T6,T7" (got ${JSON.stringify(s)}). Default: ${Object.values(DEFAULT_QUERY_COUNTS).join(",")}.`,
    );
  }
  return { T1: parts[0]!, T2: parts[1]!, T3: parts[2]!, T4: parts[3]!, T5: parts[4]!, T6: parts[5]!, T7: parts[6]! };
};

const SCAFFOLD_HELP = `june-eval scaffold — emit deterministic facts + an authoring plan (no API).

USAGE
  june-eval scaffold <domain> --seed <n> [--out <dir>] [--counts T1,T2,T3,T4,T5,T6,T7]
                     [--entities <n>] [--config <path>]

Runs Stage 1 (seeded, LLM-free) and writes facts.json + authoring_plan.json. The
plan lists each document's facts (to plant verbatim) and each query's target
fact(s). Agents then author the prose — sonnet corpus, opus queries — and
\`june-eval assemble\` validates + writes the fixture. See AUTHORING.md.

  --entities <n>   corpus entity count (default 10 = the legacy hardcoded set).
                   Larger values mint deterministic synthetic entities so a
                   higher-powered fixture (e.g. 100 entities → ~100 independent
                   deep chains) can be built. The fixture_id is discriminated by
                   entity count, so v3 (100) never collides with v1/v2 (10).
`;

const ASSEMBLE_HELP = `june-eval assemble — validate agent-authored drafts into a fixture (no API).

USAGE
  june-eval assemble <scaffold_dir> --corpus-drafts <dir> --query-drafts <file>
                     --corpus-model <m> --query-model <m> [--out <dir>] [--config <path>]

Reads <corpus-drafts>/<slug>.md per planned document and a { spec_id: text } JSON
of query drafts, validates every surface hint is embedded verbatim and every
gated query stays under the anti-leakage threshold, then writes facts.json +
corpus/ + corpus_manifest.json + queries.json. --corpus-model and --query-model
must DIFFER (anti-collusion). Then \`june-eval freeze\`.
`;
