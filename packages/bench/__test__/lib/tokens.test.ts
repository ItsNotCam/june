// author: Claude
import { describe, expect, test } from "bun:test";
import { contentWords, jaccardOverlap } from "@/lib/tokens";

describe("contentWords", () => {
  test("lowercases, drops stopwords, keeps letter runs ≥ 3", () => {
    const words = contentWords("What port does the Glorbulon Protocol use?");
    // "what" is stopword; "the" is stopword; "does" is stopword; "use" is length 3 so kept
    expect(words).toContain("port");
    expect(words).toContain("glorbulon");
    expect(words).toContain("protocol");
    expect(words).not.toContain("what");
    expect(words).not.toContain("the");
  });

  test("drops digits and punctuation", () => {
    const words = contentWords("Port 7733, control-messages!");
    expect(words).not.toContain("7733");
    expect(words).toContain("port");
    expect(words).toContain("control");
    expect(words).toContain("messages");
  });
});

describe("jaccardOverlap", () => {
  test("identical strings → 1", () => {
    expect(jaccardOverlap("port glorbulon", ["port glorbulon"])).toBe(1);
  });

  test("disjoint content → 0", () => {
    expect(jaccardOverlap("port", ["encoding"])).toBe(0);
  });

  test("high overlap triggers anti-leakage", () => {
    const q = "What port does the Glorbulon Protocol use for control messages?";
    const hint = "Glorbulon Protocol uses port 7733 for control messages";
    const overlap = jaccardOverlap(q, [hint]);
    // Four overlapping content words out of a small union → well above 0.4
    expect(overlap).toBeGreaterThan(0.4);
  });

  test("paraphrase keeps overlap under threshold", () => {
    const q = "Which TCP endpoint does Glorbulon reserve for command-plane traffic?";
    const hint = "Glorbulon Protocol uses port 7733 for control messages";
    expect(jaccardOverlap(q, [hint])).toBeLessThan(0.4);
  });
});
