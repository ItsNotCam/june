// author: Claude
import { join, resolve } from "path";
import { mkdir } from "fs/promises";
import { runStage1 } from "@/stages/01-facts";
import { runStage2 } from "@/stages/02-corpus";
import { runStage3 } from "@/stages/03-queries";
import { buildProviders, resolveSyncProvider } from "@/providers";
import { BudgetMeter } from "@/lib/cost";
import { logger } from "@/lib/logger";
import { getConfig } from "@/lib/config";
import { UsageError, FactGenerationError } from "@/lib/errors";
import { getDomainTemplate } from "@/domains";
import { fixtureId } from "@/lib/ids";
import {
  bootstrap,
  flagString,
  parseArgv,
  stageProgress,
  flagBool,
} from "./shared";

/**
 * `june-eval generate` — produces a fixture (facts + corpus + queries).
 *
 * Separate CLI subcommand from `run` per I-EVAL-5 — expensive fixture work
 * and cheap-but-repeatable run work must not be coupled. A fixture directory
 * contains `facts.json`, `corpus/`, `corpus_manifest.json`, `queries.json`.
 */
export const runGenerate = async (argv: readonly string[]): Promise<void> => {
  const { positionals, flags } = parseArgv(argv);
  if (positionals.includes("--help")) {
    process.stderr.write(GENERATE_HELP);
    return;
  }
  await bootstrap(flags);

  const seedStr = flagString(flags, "seed");
  const seed =
    seedStr === undefined ? Math.floor(Math.random() * 2 ** 31) : parseInt(seedStr, 10);
  if (!Number.isFinite(seed)) {
    throw new UsageError(`--seed must be an integer, got: ${seedStr}`);
  }

  const domain = flagString(flags, "domain") ?? "glorbulon-protocol";
  const quiet = flagBool(flags, "quiet");
  const json_log = flagBool(flags, "log-json");

  const budget = new BudgetMeter();
  const providers = buildProviders();
  const cfg = getConfig();

  const corpusProvider = resolveSyncProvider(
    providers,
    cfg.roles.corpus_author.provider,
  );
  const queryProvider = resolveSyncProvider(
    providers,
    cfg.roles.query_author.provider,
  );

  // Derive fixture_id ahead of time so the output directory can be created
  // before Stage 1 writes facts.json into it. `domain_name` is static on
  // the template — no need to run generate() twice.
  const template = getDomainTemplate(domain);
  if (!template) {
    throw new FactGenerationError(`Unknown domain template: ${domain}`);
  }
  const fid = fixtureId(seed, template.domain_name);

  const outRoot = resolve(flagString(flags, "out") ?? "./fixtures");
  const fixtureDir = join(outRoot, fid);
  await mkdir(fixtureDir, { recursive: true });
  const factsPath = join(fixtureDir, "facts.json");
  const corpusDir = join(fixtureDir, "corpus");
  const manifestPath = join(fixtureDir, "corpus_manifest.json");
  const queriesPath = join(fixtureDir, "queries.json");

  // Stage 1 — facts.
  const t1 = Date.now();
  const finalFacts = await runStage1({ seed, domain, out_path: factsPath });
  stageProgress({
    quiet,
    json_log,
    stage_num: 1,
    stage_name: "fact generation",
    duration_ms: Date.now() - t1,
    detail: `${finalFacts.facts.length} facts`,
  });

  // Stage 2 — corpus.
  const t2 = Date.now();
  const manifest = await runStage2({
    facts: finalFacts,
    corpus_dir: corpusDir,
    manifest_path: manifestPath,
    provider: corpusProvider,
    model: cfg.roles.corpus_author.model,
    max_tokens: cfg.roles.corpus_author.max_tokens,
    budget,
    domain_theme: `a fictional ${finalFacts.domain_name.toLowerCase()} network protocol family`,
  });
  stageProgress({
    quiet,
    json_log,
    stage_num: 2,
    stage_name: "corpus generation",
    duration_ms: Date.now() - t2,
    detail: `${manifest.documents.length} docs`,
  });

  // Stage 3 — queries.
  const t3 = Date.now();
  const queries = await runStage3({
    facts: finalFacts,
    out_path: queriesPath,
    provider: queryProvider,
    model: cfg.roles.query_author.model,
    max_tokens: cfg.roles.query_author.max_tokens,
    budget,
    domain_theme: `a fictional ${finalFacts.domain_name.toLowerCase()} network protocol family`,
  });
  stageProgress({
    quiet,
    json_log,
    stage_num: 3,
    stage_name: "query generation",
    duration_ms: Date.now() - t3,
    detail: `${queries.queries.length} queries`,
  });

  logger.info("generate.complete", {
    fixture_id: finalFacts.fixture_id,
    fixture_dir: fixtureDir,
    seed,
    domain,
    total_cost_usd: budget.total(),
  });

  process.stderr.write(
    `\nFixture ready: ${fixtureDir}\nSeed: ${seed}  Domain: ${domain}  Fixture id: ${finalFacts.fixture_id}\n`,
  );
};

const GENERATE_HELP = `june-eval generate — produce a fixture (facts + corpus + queries).

USAGE
  june-eval generate [--seed <n>] [--domain <name>] [--out <dir>]
                     [--config <path>] [--quiet] [--log-json]

FLAGS
  --seed <n>        integer seed. Same seed + domain → same fixture_id forever.
  --domain <name>   domain template name. Default: glorbulon-protocol.
  --out <dir>       parent directory for the fixture dir. Default: ./fixtures.
  --config <path>   config.yaml path. Default: CONFIG_PATH env or ./config.yaml.
  --quiet           suppress stderr progress.
  --log-json        structured JSON log instead of human progress.
`;
