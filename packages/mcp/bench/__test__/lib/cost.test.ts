// author: Claude
import { beforeAll, describe, expect, test } from "bun:test";
import { BudgetMeter, costFor, ollamaEnergyCost, rateFor } from "@/lib/cost";
import { BudgetExceededError } from "@/lib/errors";
import { loadTestConfig } from "../helpers";

describe("cost math", () => {
  test("ollama is always zero", () => {
    const r = rateFor("ollama", "qwen2.5:14b");
    expect(r.input_per_m).toBe(0);
    expect(r.output_per_m).toBe(0);
    expect(costFor(r, 1000, 2000)).toBe(0);
  });

  test("anthropic-batch is half the sync rate", () => {
    const sync = rateFor("anthropic", "claude-sonnet-4-6");
    const batch = rateFor("anthropic-batch", "claude-sonnet-4-6");
    expect(batch.input_per_m).toBeCloseTo(sync.input_per_m / 2, 6);
    expect(batch.output_per_m).toBeCloseTo(sync.output_per_m / 2, 6);
  });

  test("costFor computes tokens * rate / 1M", () => {
    const r = { input_per_m: 3, output_per_m: 15 };
    expect(costFor(r, 1_000_000, 0)).toBeCloseTo(3, 6);
    expect(costFor(r, 0, 1_000_000)).toBeCloseTo(15, 6);
  });
});

describe("BudgetMeter", () => {
  beforeAll(async () => {
    await loadTestConfig({ cost: { max_budget_usd: 1, estimates: {} as never } });
  });

  test("accumulates cost across roles", () => {
    const m = new BudgetMeter();
    m.record("role_1", 0.1);
    m.record("role_2", 0.2);
    expect(m.total()).toBeCloseTo(0.3, 6);
  });

  test("throws BudgetExceededError when cap is exceeded", () => {
    const m = new BudgetMeter();
    m.record("role_1", 0.6);
    expect(() => m.record("role_2", 0.5)).toThrow(BudgetExceededError);
  });

  test("budget violation preserves spent_usd and cap_usd", () => {
    const m = new BudgetMeter();
    try {
      m.record("role_3", 1.2);
      expect.unreachable("expected BudgetExceededError");
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceededError);
      const e = err as BudgetExceededError;
      expect(e.cap_usd).toBe(1);
      expect(e.spent_usd).toBeGreaterThan(1);
    }
  });
});

describe("ollamaEnergyCost — opt-in electricity tracking", () => {
  test("returns 0 when cost.ollama is absent", async () => {
    await loadTestConfig();
    expect(ollamaEnergyCost(10_000)).toBe(0);
  });

  test("returns 0 when only gpu_wattage is set", async () => {
    await loadTestConfig({
      cost: {
        max_budget_usd: 5,
        estimates: {} as never,
        ollama: { gpu_wattage: 450 },
      } as never,
    });
    expect(ollamaEnergyCost(10_000)).toBe(0);
  });

  test("returns 0 when only dollar_per_kwh is set", async () => {
    await loadTestConfig({
      cost: {
        max_budget_usd: 5,
        estimates: {} as never,
        ollama: { dollar_per_kwh: 0.15 },
      } as never,
    });
    expect(ollamaEnergyCost(10_000)).toBe(0);
  });

  test("computes wattage × time × rate when both are set", async () => {
    await loadTestConfig({
      cost: {
        max_budget_usd: 5,
        estimates: {} as never,
        ollama: { gpu_wattage: 450, dollar_per_kwh: 0.15 },
      } as never,
    });
    // 450 W × 1 hour × $0.15/kWh = 0.450 kWh × 0.15 = $0.0675
    expect(ollamaEnergyCost(3_600_000)).toBeCloseTo(0.0675, 6);
  });

  test("scales linearly with latency", async () => {
    await loadTestConfig({
      cost: {
        max_budget_usd: 5,
        estimates: {} as never,
        ollama: { gpu_wattage: 1000, dollar_per_kwh: 0.20 },
      } as never,
    });
    // 1000W × 10s = 10000 J = 0.00278 kWh × $0.20 = ~$0.000556
    const oneCall = ollamaEnergyCost(10_000);
    const twoCalls = ollamaEnergyCost(20_000);
    expect(twoCalls).toBeCloseTo(oneCall * 2, 6);
  });
});
