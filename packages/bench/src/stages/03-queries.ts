// author: Claude
import type { FactsFile, Fact, AtomicFact, RelationalFact } from "@/types/facts";
import type { QueriesFile, Query, QueryTier } from "@/types/query";
import type { LlmProvider } from "@/providers/types";
import {
  QueryAuthorT1OutputSchema,
  QueryAuthorT2OutputSchema,
  QueryAuthorT3OutputSchema,
  QueryAuthorT4OutputSchema,
  QueryAuthorT5OutputSchema,
} from "@/schemas/queries";
import { renderPrompt } from "@/lib/prompts";
import { writeJsonAtomic } from "@/lib/artifacts";
import { jaccardOverlap, contentWords } from "@/lib/tokens";
import { getConfig } from "@/lib/config";
import { BudgetMeter } from "@/lib/cost";
import { seededRng, seedFromString, shuffle } from "@/lib/rng";
import { logger } from "@/lib/logger";

/**
 * Stage 3 — query generation (§17).
 *
 * Five tiers, five prompts, five tier-specific output schemas. Each is
 * reshaped into the canonical `Query` record before being appended to
 * `queries.json` — the LLM answers in the tier-natural shape, and the
 * bench owns the `id`, `tier`, `anti_leakage_score`, and `generation_attempts`
 * fields.
 *
 * Anti-leakage (§12) applies to T2/T3/T4 only. T1 skips the check (lexical
 * overlap is the point) and T5 skips it (no expected fact to compare).
 * Failed queries are regenerated up to `config.anti_leakage.max_retries`
 * with a tightened reprompt naming the overlapping words.
 */
export const runStage3 = async (args: {
  facts: FactsFile;
  out_path: string;
  provider: LlmProvider;
  model: string;
  max_tokens: number;
  budget: BudgetMeter;
  domain_theme: string;
}): Promise<QueriesFile> => {
  const cfg = getConfig();
  const atomic = args.facts.facts.filter((f): f is AtomicFact => f.kind === "atomic");
  const relational = args.facts.facts.filter((f): f is RelationalFact => f.kind === "relational");
  const rng = seededRng(seedFromString(`queries:${args.facts.fixture_id}`));

  let leakage_warnings = 0;

  const t1 = await buildTierSingleFact({
    tier: "T1",
    count: cfg.queries.counts.T1,
    sampleFacts: samplePerFact(rng, args.facts.facts, cfg.queries.counts.T1),
    provider: args.provider,
    model: args.model,
    max_tokens: args.max_tokens,
    budget: args.budget,
    anti_leakage: false,
  });

  const t2 = await buildTierSingleFact({
    tier: "T2",
    count: cfg.queries.counts.T2,
    sampleFacts: samplePerFact(rng, args.facts.facts, cfg.queries.counts.T2),
    provider: args.provider,
    model: args.model,
    max_tokens: args.max_tokens,
    budget: args.budget,
    anti_leakage: true,
  });
  leakage_warnings += t2.leakage_warnings;

  const t3 = await buildTierSingleFact({
    tier: "T3",
    count: cfg.queries.counts.T3,
    sampleFacts: samplePerFact(rng, atomic, cfg.queries.counts.T3),
    provider: args.provider,
    model: args.model,
    max_tokens: args.max_tokens,
    budget: args.budget,
    anti_leakage: true,
  });
  leakage_warnings += t3.leakage_warnings;

  const chains = buildFactChains(atomic, relational, cfg.queries.counts.T4, rng);
  const t4 = await buildT4({
    chains,
    provider: args.provider,
    model: args.model,
    max_tokens: args.max_tokens,
    budget: args.budget,
  });
  leakage_warnings += t4.leakage_warnings;

  const t5 = await buildT5({
    count: cfg.queries.counts.T5,
    sampleFacts: samplePerFact(rng, args.facts.facts, Math.min(cfg.queries.counts.T5, 30)),
    domain_theme: args.domain_theme,
    factEntities: new Set(atomic.map((f) => f.entity)),
    factAttributes: new Set(atomic.map((f) => f.attribute)),
    provider: args.provider,
    model: args.model,
    max_tokens: args.max_tokens,
    budget: args.budget,
  });

  const queries: Query[] = [];
  let counter = 1;
  const append = (rows: Omit<Query, "id">[]): void => {
    for (const row of rows) {
      queries.push({ id: `q-${String(counter++).padStart(4, "0")}`, ...row });
    }
  };
  append(t1.queries);
  append(t2.queries);
  append(t3.queries);
  append(t4.queries);
  append(t5.queries);

  const file: QueriesFile = {
    fixture_id: args.facts.fixture_id,
    schema_version: 1,
    query_author: { provider: args.provider.name, model: args.model },
    queries,
  };
  await writeJsonAtomic(args.out_path, file);
  logger.info("stage.3.complete", {
    fixture_id: file.fixture_id,
    query_count: queries.length,
    leakage_warnings,
  });
  return file;
};

const samplePerFact = (
  rng: ReturnType<typeof seededRng>,
  facts: readonly Fact[],
  count: number,
): Fact[] => {
  if (count <= 0 || facts.length === 0) return [];
  const shuffled = shuffle(rng, facts);
  const out: Fact[] = [];
  for (let i = 0; i < count; i++) {
    out.push(shuffled[i % shuffled.length]!);
  }
  return out;
};

/**
 * Builds queries for a tier whose expected shape is "one fact id per query"
 * (T1, T2, T3).
 *
 * Single LLM call per batch of facts — not one call per fact. The prompt
 * receives all facts at once; the LLM returns N queries. Anti-leakage is
 * checked per-query; failures trigger a regeneration loop that passes
 * tightened excluded-word lists.
 */
const buildTierSingleFact = async (args: {
  tier: "T1" | "T2" | "T3";
  count: number;
  sampleFacts: Fact[];
  provider: LlmProvider;
  model: string;
  max_tokens: number;
  budget: BudgetMeter;
  anti_leakage: boolean;
}): Promise<{ queries: Omit<Query, "id">[]; leakage_warnings: number }> => {
  const cfg = getConfig();
  if (args.count === 0 || args.sampleFacts.length === 0) {
    return { queries: [], leakage_warnings: 0 };
  }

  const facts = args.sampleFacts.slice(0, args.count);
  const excluded = new Map<string, string[]>();
  for (const f of facts) excluded.set(f.id, contentWords(f.surface_hint));

  let accepted = new Map<string, { text: string; score: number | null; attempts: number }>();
  let leakage_warnings = 0;

  let attempt = 0;
  const maxAttempts = args.anti_leakage ? cfg.anti_leakage.max_retries + 1 : 1;

  while (attempt < maxAttempts && accepted.size < facts.length) {
    const missing = facts.filter((f) => !accepted.has(f.id));
    const prompt = await renderPrompt(`query-${args.tier.toLowerCase()}`, {
      facts_json: JSON.stringify(missing, null, 2),
      excluded_words_per_fact_json: JSON.stringify(
        Object.fromEntries(missing.map((f) => [f.id, excluded.get(f.id) ?? []])),
        null,
        2,
      ),
    });
    const res = await args.provider.call({
      model: args.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: args.max_tokens,
      temperature: 0,
      response_format: "json",
    });
    args.budget.record("role_2", res.cost_usd);

    const parsed = parseSingleFactQueries(args.tier, res.text);
    if (!parsed) break;

    for (const q of parsed) {
      const fact = facts.find((f) => f.id === q.fact_id);
      if (!fact) continue;
      const score = args.anti_leakage
        ? jaccardOverlap(q.text, [fact.surface_hint])
        : null;
      const attempts = attempt + 1;
      if (args.anti_leakage && score !== null && score > cfg.anti_leakage.threshold) {
        if (attempt < maxAttempts - 1) continue;
        leakage_warnings++;
      }
      accepted.set(fact.id, { text: q.text, score, attempts });
    }
    attempt++;
  }

  const queries: Omit<Query, "id">[] = [];
  for (const fact of facts) {
    const entry = accepted.get(fact.id);
    if (!entry) continue;
    queries.push({
      tier: args.tier,
      text: entry.text,
      expected_fact_ids: [fact.id],
      anti_leakage_score: args.anti_leakage ? entry.score : null,
      generation_attempts: entry.attempts,
    });
  }

  return { queries, leakage_warnings };
};

const parseSingleFactQueries = (
  tier: "T1" | "T2" | "T3",
  text: string,
): Array<{ fact_id: string; text: string }> | null => {
  const payload = extractJson(text);
  if (!payload) return null;
  const schema =
    tier === "T1"
      ? QueryAuthorT1OutputSchema
      : tier === "T2"
        ? QueryAuthorT2OutputSchema
        : QueryAuthorT3OutputSchema;
  const result = schema.safeParse(payload);
  return result.success ? result.data.queries : null;
};

export type FactChain = {
  relational: RelationalFact;
  atomic: AtomicFact;
};

/**
 * Builds `(relational, atomic)` pairs that together answer one multi-hop
 * question (§17).
 *
 * For each relational fact `R = (subject, predicate, object)`, every atomic
 * fact `A` whose `entity === R.object` forms one chain. Pairs are
 * deduplicated on `(R.id, A.id)` and truncated to the configured T4 count.
 * The truncation uses a seeded shuffle so the selected subset is stable
 * across regenerations of the same fixture.
 */
export const buildFactChains = (
  atomic: AtomicFact[],
  relational: RelationalFact[],
  count: number,
  rng: ReturnType<typeof seededRng>,
): FactChain[] => {
  if (count === 0) return [];

  const atomicByEntity = new Map<string, AtomicFact[]>();
  for (const a of atomic) {
    const arr = atomicByEntity.get(a.entity) ?? [];
    arr.push(a);
    atomicByEntity.set(a.entity, arr);
  }

  const chains: FactChain[] = [];
  for (const r of relational) {
    const matching = atomicByEntity.get(r.object) ?? [];
    for (const a of matching) chains.push({ relational: r, atomic: a });
  }
  return shuffle(rng, chains).slice(0, count);
};

const buildT4 = async (args: {
  chains: FactChain[];
  provider: LlmProvider;
  model: string;
  max_tokens: number;
  budget: BudgetMeter;
}): Promise<{ queries: Omit<Query, "id">[]; leakage_warnings: number }> => {
  const cfg = getConfig();
  if (args.chains.length === 0) return { queries: [], leakage_warnings: 0 };

  const accepted = new Map<string, { text: string; score: number; attempts: number }>();
  let leakage_warnings = 0;
  const maxAttempts = cfg.anti_leakage.max_retries + 1;
  let attempt = 0;
  const chainKey = (c: FactChain): string => `${c.relational.id}|${c.atomic.id}`;

  while (attempt < maxAttempts && accepted.size < args.chains.length) {
    const missing = args.chains.filter((c) => !accepted.has(chainKey(c)));
    const prompt = await renderPrompt("query-t4", {
      fact_chains_json: JSON.stringify(
        missing.map((c) => ({
          relational: c.relational,
          atomic: c.atomic,
        })),
        null,
        2,
      ),
    });
    const res = await args.provider.call({
      model: args.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: args.max_tokens,
      temperature: 0,
      response_format: "json",
    });
    args.budget.record("role_2", res.cost_usd);

    const payload = extractJson(res.text);
    if (!payload) break;
    const parsed = QueryAuthorT4OutputSchema.safeParse(payload);
    if (!parsed.success) break;

    for (const q of parsed.data.queries) {
      const [relId, atomicId] = q.fact_ids;
      const chain = missing.find(
        (c) => c.relational.id === relId && c.atomic.id === atomicId,
      );
      if (!chain) continue;
      const score = jaccardOverlap(q.text, [
        chain.relational.surface_hint,
        chain.atomic.surface_hint,
      ]);
      const attempts = attempt + 1;
      if (score > cfg.anti_leakage.threshold) {
        if (attempt < maxAttempts - 1) continue;
        leakage_warnings++;
      }
      accepted.set(chainKey(chain), { text: q.text, score, attempts });
    }
    attempt++;
  }

  const queries: Omit<Query, "id">[] = [];
  for (const chain of args.chains) {
    const entry = accepted.get(chainKey(chain));
    if (!entry) continue;
    queries.push({
      tier: "T4",
      text: entry.text,
      expected_fact_ids: [chain.relational.id, chain.atomic.id],
      anti_leakage_score: entry.score,
      generation_attempts: entry.attempts,
    });
  }
  return { queries, leakage_warnings };
};

const buildT5 = async (args: {
  count: number;
  sampleFacts: Fact[];
  domain_theme: string;
  factEntities: Set<string>;
  factAttributes: Set<string>;
  provider: LlmProvider;
  model: string;
  max_tokens: number;
  budget: BudgetMeter;
}): Promise<{ queries: Omit<Query, "id">[] }> => {
  if (args.count === 0) return { queries: [] };

  const accepted: Array<{ text: string; attempts: number }> = [];
  const maxAttempts = 4;
  let attempt = 0;

  while (attempt < maxAttempts && accepted.length < args.count) {
    const remaining = args.count - accepted.length;
    const prompt = await renderPrompt("query-t5", {
      facts_json: JSON.stringify(args.sampleFacts, null, 2),
      domain_theme: args.domain_theme,
      n_queries: String(remaining),
    });
    const res = await args.provider.call({
      model: args.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: args.max_tokens,
      temperature: 0,
      response_format: "json",
    });
    args.budget.record("role_2", res.cost_usd);

    const payload = extractJson(res.text);
    if (!payload) break;
    const parsed = QueryAuthorT5OutputSchema.safeParse(payload);
    if (!parsed.success) break;

    for (const q of parsed.data.queries) {
      if (t5LeaksIntoFacts(q.text, args.factEntities, args.factAttributes)) continue;
      accepted.push({ text: q.text, attempts: attempt + 1 });
      if (accepted.length >= args.count) break;
    }
    attempt++;
  }

  return {
    queries: accepted.map((q) => ({
      tier: "T5" satisfies QueryTier,
      text: q.text,
      expected_fact_ids: [] as string[],
      anti_leakage_score: null,
      generation_attempts: q.attempts,
    })),
  };
};

/**
 * Crude T5 post-check (§17): flags queries that happen to ask about a real
 * entity + attribute combination. Catches the obvious failure mode where the
 * query author produces a T1 and labels it T5.
 */
const t5LeaksIntoFacts = (
  text: string,
  factEntities: Set<string>,
  factAttributes: Set<string>,
): boolean => {
  const lower = text.toLowerCase();
  let matchedEntity = false;
  let matchedAttr = false;
  for (const e of factEntities) {
    if (lower.includes(e.toLowerCase())) {
      matchedEntity = true;
      break;
    }
  }
  if (!matchedEntity) return false;
  const words = new Set(contentWords(text));
  for (const a of factAttributes) {
    for (const w of contentWords(a.replace(/_/g, " "))) {
      if (words.has(w)) {
        matchedAttr = true;
        break;
      }
    }
    if (matchedAttr) break;
  }
  return matchedEntity && matchedAttr;
};

const extractJson = (text: string): unknown => {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence && fence[1]) candidates.push(fence[1].trim());
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // fall through
    }
  }
  return null;
};
