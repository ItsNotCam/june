// author: Claude
import { getConfig } from "@/lib/config";
import { BudgetExceededError } from "@/lib/errors";

/**
 * Per-million-token prices in USD for each model the bench knows about
 * (§27, Appendix F).
 *
 * **This module is the sole source of truth for pricing at run time.**
 * `BENCH_SPEC.md` deliberately omits worked prices — they drift faster than
 * the spec. When a model rate changes, edit the table below and re-run;
 * `cost_preview` reflects the new numbers immediately.
 *
 * Ollama rates are always zero — local inference has no per-token charge.
 * Anthropic Batch rates are half the sync rate (50% batch discount on both
 * input and output tokens).
 */
export type ModelRate = {
  /** USD per 1M input tokens. */
  input_per_m: number;
  /** USD per 1M output tokens. */
  output_per_m: number;
};

const SYNC_RATES: Readonly<Record<string, ModelRate>> = {
  // Anthropic — sync Messages API
  "claude-sonnet-4-6": { input_per_m: 3.0, output_per_m: 15.0 },
  "claude-opus-4-7": { input_per_m: 15.0, output_per_m: 75.0 },
  // OpenAI — Chat Completions
  "gpt-4.1": { input_per_m: 2.0, output_per_m: 8.0 },
  "gpt-4o": { input_per_m: 2.5, output_per_m: 10.0 },
};

const OLLAMA_RATE: ModelRate = { input_per_m: 0, output_per_m: 0 };

/**
 * Looks up the per-token rate for a `(provider, model)` pair.
 *
 * Anthropic Batch rates are derived by halving the sync rate — the 50% batch
 * discount applies to both input and output. Unknown models return a fail-
 * loud placeholder so the operator notices a missing price rather than
 * silently computing `cost = 0`.
 */
export const rateFor = (
  provider: "ollama" | "anthropic" | "anthropic-batch" | "openai",
  model: string,
): ModelRate => {
  if (provider === "ollama") return OLLAMA_RATE;
  const rate = SYNC_RATES[model];
  if (!rate) {
    // Use a sentinel so `cost_usd` is clearly wrong rather than masked as zero.
    return { input_per_m: -1, output_per_m: -1 };
  }
  if (provider === "anthropic-batch") {
    return {
      input_per_m: rate.input_per_m / 2,
      output_per_m: rate.output_per_m / 2,
    };
  }
  return rate;
};

/**
 * Computes USD cost for a single call given its token counts.
 *
 * When the provider doesn't surface tokens (some Ollama streaming responses),
 * callers pass `null` — the bench records cost as `0` in that case since
 * Ollama's API has no per-token charge anyway.
 */
export const costFor = (
  rate: ModelRate,
  prompt_tokens: number | null,
  completion_tokens: number | null,
): number => {
  if (rate.input_per_m < 0 || rate.output_per_m < 0) return 0;
  const pt = prompt_tokens ?? 0;
  const ct = completion_tokens ?? 0;
  return (pt / 1_000_000) * rate.input_per_m + (ct / 1_000_000) * rate.output_per_m;
};

/**
 * Computes the wall-clock electricity cost for one Ollama call.
 *
 * Returns `0` when either `gpu_wattage` or `dollar_per_kwh` is unset (or the
 * whole `cost.ollama` block is absent) — the bench treats these as opt-in
 * tracking, never required. No warning, no throw.
 *
 * Formula: `wattage_W × (latency_ms / 1000) / 3600 × $/kWh`. The wattage is
 * a steady-state nameplate value (`gpu_wattage` in `config.cost.ollama`) —
 * not measured live. Operators tuning this number should pick the value
 * `nvidia-smi` shows under sustained load.
 */
export const ollamaEnergyCost = (latency_ms: number): number => {
  const ollama = getConfig().cost.ollama;
  if (!ollama) return 0;
  const w = ollama.gpu_wattage;
  const rate = ollama.dollar_per_kwh;
  if (w === undefined || rate === undefined) return 0;
  const seconds = latency_ms / 1000;
  const kwh = (w * seconds) / 3_600_000;
  return kwh * rate;
};

/**
 * Running total of spend, per-role.
 *
 * `BudgetMeter` is a small stateful helper — the bench constructs one at run
 * start, threads it through every provider call, and asks it to check the
 * cap before every metered call. The bench aborts mid-run with
 * `BudgetExceededError` when the cap is breached.
 */
export class BudgetMeter {
  private readonly by_role: Record<"role_1" | "role_2" | "role_3" | "role_4", number> = {
    role_1: 0,
    role_2: 0,
    role_3: 0,
    role_4: 0,
  };

  record(role: "role_1" | "role_2" | "role_3" | "role_4", amount: number): void {
    this.by_role[role] += amount;
    const total = this.total();
    const cap = getConfig().cost.max_budget_usd;
    if (total > cap) {
      throw new BudgetExceededError(
        `Spent ${total.toFixed(4)} exceeds configured cap ${cap.toFixed(2)}`,
        total,
        cap,
      );
    }
  }

  total(): number {
    return this.by_role.role_1 + this.by_role.role_2 + this.by_role.role_3 + this.by_role.role_4;
  }

  snapshot(): { role_1: number; role_2: number; role_3: number; role_4: number; total: number } {
    return { ...this.by_role, total: this.total() };
  }
}

/**
 * Shape of one row in the cost-preview table printed before every `run` (§27).
 *
 * `estimated_input_tokens` / `estimated_output_tokens` are the heuristics from
 * `config.cost.estimates` multiplied by the relevant unit count (docs for
 * corpus_author, queries for the others).
 */
export type CostPreviewRow = {
  role: "role_1" | "role_2" | "role_3" | "role_4";
  label: string;
  provider: string;
  model: string;
  estimated_input_tokens: number;
  estimated_output_tokens: number;
  estimated_usd: number;
};

/**
 * Builds the cost-preview table for a run.
 *
 * `doc_count` is how many documents the corpus author will generate (one LLM
 * call per document). `query_count` is the total across tiers (used for
 * reader, judge, and query_author — the latter is a slight overestimate because
 * the query author is called once per tier, not once per query, but the token
 * budget is sized that way in `estimates.query_author`).
 *
 * When `include_baseline` is true, the baseline's token budget is added to
 * the reader row (the baseline is a sibling reader pass).
 */
export const buildCostPreview = (args: {
  doc_count: number;
  query_count: number;
  include_baseline: boolean;
}): CostPreviewRow[] => {
  const cfg = getConfig();
  const { doc_count, query_count } = args;

  const rows: CostPreviewRow[] = [];

  const ca = cfg.cost.estimates.corpus_author;
  const caIn = (ca.input_per_doc ?? 0) * doc_count;
  const caOut = (ca.output_per_doc ?? 0) * doc_count;
  rows.push({
    role: "role_1",
    label: "corpus author",
    provider: cfg.roles.corpus_author.provider,
    model: cfg.roles.corpus_author.model,
    estimated_input_tokens: caIn,
    estimated_output_tokens: caOut,
    estimated_usd: costFor(
      rateFor(cfg.roles.corpus_author.provider, cfg.roles.corpus_author.model),
      caIn,
      caOut,
    ),
  });

  const qa = cfg.cost.estimates.query_author;
  const qaIn = (qa.input_per_query ?? 0) * query_count;
  const qaOut = (qa.output_per_query ?? 0) * query_count;
  rows.push({
    role: "role_2",
    label: "query author",
    provider: cfg.roles.query_author.provider,
    model: cfg.roles.query_author.model,
    estimated_input_tokens: qaIn,
    estimated_output_tokens: qaOut,
    estimated_usd: costFor(
      rateFor(cfg.roles.query_author.provider, cfg.roles.query_author.model),
      qaIn,
      qaOut,
    ),
  });

  const rd = cfg.cost.estimates.reader;
  const baselineMultiplier = args.include_baseline ? 2 : 1;
  const rdIn = (rd.input_per_query ?? 0) * query_count * baselineMultiplier;
  const rdOut = (rd.output_per_query ?? 0) * query_count * baselineMultiplier;
  // Token cost (paid providers) + electricity (Ollama). Both are silent fallbacks
  // — token cost is $0 for Ollama; electricity is $0 unless `cost.ollama` and
  // `estimates.reader.latency_ms_per_query` are both opted in.
  const rdTokenUsd = costFor(
    rateFor(cfg.roles.reader.provider, cfg.roles.reader.model),
    rdIn,
    rdOut,
  );
  const rdEnergyUsd =
    cfg.roles.reader.provider === "ollama" && rd.latency_ms_per_query !== undefined
      ? ollamaEnergyCost(rd.latency_ms_per_query) * query_count * baselineMultiplier
      : 0;
  rows.push({
    role: "role_3",
    label: args.include_baseline ? "reader + baseline" : "reader",
    provider: cfg.roles.reader.provider,
    model: cfg.roles.reader.model,
    estimated_input_tokens: rdIn,
    estimated_output_tokens: rdOut,
    estimated_usd: rdTokenUsd + rdEnergyUsd,
  });

  const jd = cfg.cost.estimates.judge;
  const jdCount = query_count * baselineMultiplier;
  const jdIn = (jd.input_per_query ?? 0) * jdCount;
  const jdOut = (jd.output_per_query ?? 0) * jdCount;
  rows.push({
    role: "role_4",
    label: "judge (batch)",
    provider: cfg.roles.judge.provider,
    model: cfg.roles.judge.model,
    estimated_input_tokens: jdIn,
    estimated_output_tokens: jdOut,
    estimated_usd: costFor(
      rateFor("anthropic-batch", cfg.roles.judge.model),
      jdIn,
      jdOut,
    ),
  });

  return rows;
};
