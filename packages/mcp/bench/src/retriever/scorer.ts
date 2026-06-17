// author: Claude
import type { Scorer } from "./types";
import {
  AutoTokenizer,
  AutoModelForSequenceClassification,
  type PreTrainedTokenizer,
  type PreTrainedModel,
} from "@huggingface/transformers";
import { logger } from "@/lib/logger";

/**
 * Max (query, candidate) pairs per forward pass. A reranker pool is small
 * (~30–50 candidates), so this only sub-batches pathological pools. Splitting is
 * score-preserving: the cross-encoder's attention masking makes per-candidate
 * scores invariant to batch composition (verified — see the Step-0 spike), so
 * any split yields identical scores and identical rankings.
 */
const MAX_BATCH = 32;

/** Cache loaded tokenizer+model per model id — loading is the expensive step. */
type Loaded = { tokenizer: PreTrainedTokenizer; model: PreTrainedModel };
const cache = new Map<string, Promise<Loaded>>();

const load = (modelId: string): Promise<Loaded> => {
  const existing = cache.get(modelId);
  if (existing) return existing;
  const loading = (async (): Promise<Loaded> => {
    logger.info("reranker.scorer.load", { model: modelId });
    const [tokenizer, model] = await Promise.all([
      AutoTokenizer.from_pretrained(modelId),
      AutoModelForSequenceClassification.from_pretrained(modelId),
    ]);
    return { tokenizer, model };
  })();
  cache.set(modelId, loading);
  return loading;
};

/** Score one sub-batch of (query, candidate) pairs in a single forward pass. */
const scoreSubBatch = async (
  { tokenizer, model }: Loaded,
  query: string,
  candidates: string[],
): Promise<number[]> => {
  const inputs = await tokenizer(
    candidates.map(() => query),
    { text_pair: candidates, padding: true, truncation: true },
  );
  const output = await model(inputs);
  // Cross-encoder rerankers are single-label sequence classifiers: one logit per
  // pair, in input order. Higher = more relevant.
  return Array.from(output.logits.data as Float32Array, (v) => Number(v));
};

/**
 * A local cross-encoder `Scorer` backed by Transformers.js (ONNX runtime, WASM
 * fallback under Bun). Deterministic and free — the principled first backend for
 * the reranker A/B because it keeps the retrieval control noise-free.
 *
 * The model is lazy-loaded on first `score()` and cached, so importing this is
 * cheap and the model download happens once per process.
 *
 * @param model - a Transformers.js-compatible cross-encoder repo that ships ONNX
 *   weights (e.g. `Xenova/bge-reranker-base`).
 */
export const createCrossEncoderScorer = (args: { model: string }): Scorer => {
  const score = async (query: string, candidates: string[]): Promise<number[]> => {
    if (candidates.length === 0) return [];
    const loaded = await load(args.model);
    const scores: number[] = [];
    for (let i = 0; i < candidates.length; i += MAX_BATCH) {
      const sub = candidates.slice(i, i + MAX_BATCH);
      scores.push(...(await scoreSubBatch(loaded, query, sub)));
    }
    return scores;
  };
  return { name: `cross-encoder:${args.model}`, score };
};
