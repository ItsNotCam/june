// author: Claude
/**
 * @june/mcp-bench public entry.
 *
 * The bench is primarily a CLI (`june-eval`); this module re-exports the
 * pieces tests import directly — pure functions for stages 1/5/6/9 and the
 * small helpers that back them.
 */

export { runStage1, validateFacts } from "./stages/01-facts";
export { runStage5 } from "./stages/05-resolve";
export { runStage6, computeRecall, computeMrr } from "./stages/06-retrieval";
export { runStage9, renderSummary } from "./stages/09-score";

export { seededRng, seedFromString, shuffle, pick, randInt } from "./lib/rng";
export {
  normalizeForResolution,
  normalizeLikeMcp,
} from "./lib/normalize";
export { fixtureId, juneDocId, newRunId } from "./lib/ids";
export { computeBootstrapCi } from "./lib/bootstrap";
export { jaccardOverlap, contentWords } from "./lib/tokens";
export { BudgetMeter, costFor, rateFor, buildCostPreview } from "./lib/cost";

export { bm25Vectorize } from "./retriever/bm25";
export { reciprocalRankFusion } from "./retriever/rrf";

export { getDomainTemplate, listDomainNames } from "./domains";
