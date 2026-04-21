// author: Claude
import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { runStage1, validateFacts } from "@/stages/01-facts";
import type { Fact } from "@/types/facts";
import { FactGenerationError } from "@/lib/errors";

const tmpFactsPath = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "bench-stage1-"));
  return join(dir, "facts.json");
};

describe("Stage 1 — fact generation", () => {
  test("same seed + domain produces byte-identical facts.json", async () => {
    const pathA = await tmpFactsPath();
    const pathB = await tmpFactsPath();
    const a = await runStage1({ seed: 42, domain: "glorbulon-protocol", out_path: pathA });
    const b = await runStage1({ seed: 42, domain: "glorbulon-protocol", out_path: pathB });
    // Facts array equality — `generated_at` deliberately excluded (it's the only non-deterministic field).
    expect(a.facts).toEqual(b.facts);
    expect(a.fixture_id).toBe(b.fixture_id);

    const rawA = JSON.parse(await readFile(pathA, "utf-8"));
    const rawB = JSON.parse(await readFile(pathB, "utf-8"));
    delete rawA.generated_at;
    delete rawB.generated_at;
    expect(rawA).toEqual(rawB);
  });

  test("different seeds produce different fixtures", async () => {
    const a = await runStage1({ seed: 1, domain: "glorbulon-protocol", out_path: await tmpFactsPath() });
    const b = await runStage1({ seed: 2, domain: "glorbulon-protocol", out_path: await tmpFactsPath() });
    expect(a.fixture_id).not.toBe(b.fixture_id);
  });

  test("rejects unknown domain names", async () => {
    await expect(
      runStage1({ seed: 1, domain: "no-such-domain", out_path: await tmpFactsPath() }),
    ).rejects.toThrow(FactGenerationError);
  });

  test("produces the expected fact counts for glorbulon-protocol", async () => {
    const file = await runStage1({
      seed: 7,
      domain: "glorbulon-protocol",
      out_path: await tmpFactsPath(),
    });
    const atomic = file.facts.filter((f) => f.kind === "atomic").length;
    expect(atomic).toBe(80);
  });
});

describe("validateFacts", () => {
  const ok = (): Fact[] => [
    { kind: "atomic", id: "f-atomic-0001", entity: "E1", attribute: "a", value: "V", surface_hint: "E1 a is V" },
    { kind: "atomic", id: "f-atomic-0002", entity: "E2", attribute: "b", value: "W", surface_hint: "E2 b is W" },
    { kind: "relational", id: "f-rel-0001", subject: "E1", predicate: "p", object: "E2", surface_hint: "E1 p E2" },
  ];

  test("accepts a well-formed fact set", () => {
    expect(() => validateFacts(ok())).not.toThrow();
  });

  test("rejects duplicate ids", () => {
    const dup = ok();
    dup[1]!.id = dup[0]!.id;
    expect(() => validateFacts(dup)).toThrow(FactGenerationError);
  });

  test("rejects relational subject/object not in atomic entities", () => {
    const bad = ok();
    (bad[2] as { subject: string }).subject = "Ghost";
    expect(() => validateFacts(bad)).toThrow(FactGenerationError);
  });

  test("rejects surface_hint that doesn't contain value", () => {
    const bad = ok();
    (bad[0] as { surface_hint: string }).surface_hint = "no value here";
    expect(() => validateFacts(bad)).toThrow(FactGenerationError);
  });

  test("rejects byte-identical surface_hint", () => {
    const bad = ok();
    bad[1]!.surface_hint = bad[0]!.surface_hint;
    expect(() => validateFacts(bad)).toThrow(FactGenerationError);
  });
});
