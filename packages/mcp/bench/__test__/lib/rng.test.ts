// author: Claude
import { describe, expect, test } from "bun:test";
import {
  pick,
  randInt,
  seededRng,
  seedFromString,
  shuffle,
} from "@/lib/rng";

describe("seededRng", () => {
  test("same seed produces identical sequence", () => {
    const a = seededRng(42);
    const b = seededRng(42);
    const seqA = Array.from({ length: 100 }, () => a());
    const seqB = Array.from({ length: 100 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  test("different seeds produce different sequences", () => {
    const a = seededRng(42);
    const b = seededRng(43);
    expect(a()).not.toEqual(b());
  });

  test("emits values strictly in [0, 1)", () => {
    const rng = seededRng(1);
    for (let i = 0; i < 10_000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("seedFromString", () => {
  test("deterministic for equal strings", () => {
    expect(seedFromString("foo")).toBe(seedFromString("foo"));
  });

  test("distinct for different strings", () => {
    expect(seedFromString("foo")).not.toBe(seedFromString("bar"));
  });
});

describe("shuffle", () => {
  test("does not mutate the input", () => {
    const input = [1, 2, 3, 4, 5];
    const snapshot = [...input];
    shuffle(seededRng(1), input);
    expect(input).toEqual(snapshot);
  });

  test("same seed → same permutation", () => {
    const input = [1, 2, 3, 4, 5];
    expect(shuffle(seededRng(7), input)).toEqual(shuffle(seededRng(7), input));
  });
});

describe("randInt + pick", () => {
  test("randInt bounded", () => {
    const rng = seededRng(1);
    for (let i = 0; i < 1000; i++) {
      const v = randInt(rng, 10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
    }
  });

  test("pick returns undefined on empty array", () => {
    expect(pick(seededRng(1), [])).toBeUndefined();
  });
});
