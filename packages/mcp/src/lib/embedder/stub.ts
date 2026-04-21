// author: Claude
import { createHash } from "node:crypto";
import type { Embedder } from "./types";

/**
 * Deterministic stub embedder ([§22.6](../../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#226-interface)). Produces hash-derived unit-length
 * pseudo-vectors for pipeline plumbing tests — no Ollama dependency.
 */

const DEFAULT_DIM = 128;

const textToVector = (text: string, dim: number): number[] => {
  const out: number[] = new Array(dim).fill(0);
  let sumSq = 0;
  for (let i = 0; i < dim; i++) {
    // Derive a byte from sha256(text || i).
    const h = createHash("sha256").update(text).update(String(i)).digest();
    const byte = h[0] ?? 0;
    const signed = byte / 255 - 0.5;
    out[i] = signed;
    sumSq += signed * signed;
  }
  const norm = Math.sqrt(sumSq) || 1;
  return out.map((v) => v / norm);
};

export const createStubEmbedder = (dim: number = DEFAULT_DIM): Embedder => ({
  name: "stub",
  version: `dim-${dim}`,
  dim,
  max_input_chars: 30_000,
  embed: async (texts) => texts.map((t) => textToVector(t, dim)),
});
