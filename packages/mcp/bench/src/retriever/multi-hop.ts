// author: Claude
import type { Retriever, RetrievalResult } from "./types";
import type { LlmProvider } from "@/providers/types";
import type { BudgetMeter } from "@/lib/cost";
import { renderPrompt } from "@/lib/prompts";
import { logger } from "@/lib/logger";
import { z } from "zod";

/**
 * Multi-hop retriever wrapper — "anchored bridge injection".
 *
 * Extends a single-pass `Retriever` with LLM-driven query decomposition for
 * questions that reference an entity indirectly ("the protocol that X
 * authenticates via"). Single-hop questions pass through unchanged.
 *
 * Design rationale (measured on the bench's T4 tier — relational + atomic
 * chunk both required in the reader window): the *original* query already
 * surfaces the relational chunk reliably (top-3 ~95% of the time); the atomic
 * chunk is the sole gap. So instead of replacing the query with rephrased hops
 * and RRF-fusing (which extracted the bridge from a weak rephrased retrieval
 * and let fusion DEMOTE correct chunks — both measured to regress T4), we:
 *
 *   1. Anchor on the original query (`base`) — authoritative, the floor every
 *      degraded path returns to.
 *   2. Decompose only to detect a bridge. Single-hop / any failure → `base`.
 *   3. Resolve the bridge entity B from `base`'s OWN top chunks (where the
 *      relational chunk reliably sits), not a fragile rephrased hop.
 *   4. Retrieve the atomic sub-query (now naming B) and INJECT its best novel
 *      chunk into the reader window without demoting any base chunk already in
 *      the window (see `injectAtomic`).
 *
 * Net effect: single-pass is a strict floor; T4 can only gain the bridged
 * atomic chunk, never lose a chunk the original query already found.
 */

const HopSchema = z.object({
  query: z.string().min(1),
  depends_on: z.number().int().nonnegative().optional(),
});
const DecomposeOutputSchema = z.object({
  hops: z.array(HopSchema).min(1).max(3),
});
const BridgeOutputSchema = z.object({
  entity: z.string(),
});

type Hop = z.infer<typeof HopSchema>;

const HOP_FETCH_K = 5;
const BRIDGE_LOOKUP_TOP = 3;
/**
 * How many novel atomic chunks to inject into the reader window. 1 is provably
 * non-demoting within the protected head (top `windowK - INJECT_SLOTS`) and the
 * atomic sub-query is highly specific, so its #1 is normally the right chunk.
 * Raise only on measured evidence that the true atomic chunk frequently ranks
 * below #1 in the sub-query (see `multi_hop.atomic_candidates` telemetry) — a
 * retrieval-merit decision, never a fixture-tuning knob.
 */
const INJECT_SLOTS = 1;

export const createMultiHopRetriever = (args: {
  inner: Retriever;
  plannerProvider: LlmProvider;
  plannerModel: string;
  plannerMaxTokens: number;
  fetchChunkContent: (chunkId: string) => string | null;
  /**
   * The reader's context window (chunks the reader actually reads, =
   * `reader_eval.k`). Injected atomic chunks must land within it for the
   * bridged fact to reach the reader; the head above it is protected.
   */
  windowK: number;
  budget: BudgetMeter;
}): Retriever => {
  const { inner, plannerProvider, plannerModel, plannerMaxTokens, fetchChunkContent, windowK, budget } =
    args;

  const decompose = async (queryText: string): Promise<Hop[]> => {
    const prompt = await renderPrompt("decompose-query", { query_text: queryText });
    let res;
    try {
      res = await plannerProvider.call({
        model: plannerModel,
        messages: [{ role: "user", content: prompt }],
        max_tokens: plannerMaxTokens,
        temperature: 0,
        response_format: "json",
        disable_thinking: true,
      });
    } catch (err) {
      // A planner transport failure (timeout, 5xx, network) must not kill the
      // run — degrade to single-hop, identical to the parse-failure fallback.
      logger.warn("multi_hop.decompose_error", {
        error: err instanceof Error ? err.message : String(err),
      });
      return [{ query: queryText }];
    }
    budget.record("role_5", res.cost_usd);

    const parsed = parseJson(res.text, DecomposeOutputSchema);
    if (!parsed) {
      logger.warn("multi_hop.decompose_failed", {
        text_preview: res.text.slice(0, 200),
      });
      return [{ query: queryText }];
    }
    return parsed.hops;
  };

  const extractBridge = async (
    question: string,
    chunkIds: readonly string[],
  ): Promise<string | null> => {
    const chunks = chunkIds
      .map((id) => {
        const content = fetchChunkContent(id);
        return content ? `<chunk id="${id}">\n${content}\n</chunk>` : null;
      })
      .filter((s): s is string => s !== null)
      .join("\n\n");
    if (!chunks) return null;

    const prompt = await renderPrompt("extract-bridge", { question, chunks });
    let res;
    try {
      res = await plannerProvider.call({
        model: plannerModel,
        messages: [{ role: "user", content: prompt }],
        max_tokens: plannerMaxTokens,
        temperature: 0,
        response_format: "json",
        disable_thinking: true,
      });
    } catch (err) {
      // Planner failure during bridge extraction → skip this hop (null) rather
      // than aborting the whole retrieval. The caller handles null gracefully.
      logger.warn("multi_hop.extract_error", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
    budget.record("role_5", res.cost_usd);

    const parsed = parseJson(res.text, BridgeOutputSchema);
    if (!parsed || parsed.entity.trim() === "") {
      logger.warn("multi_hop.extract_failed", {
        text_preview: res.text.slice(0, 200),
      });
      return null;
    }
    return parsed.entity.trim();
  };

  const retrieve = async (queryText: string, k: number): Promise<RetrievalResult[]> => {
    // Anchor on the ORIGINAL query. This is authoritative and the floor every
    // degraded path below returns to — single-hop, planner failure, missing
    // bridge, or atomic-already-present all yield exactly this ranking.
    const base = await inner.retrieve(queryText, k);

    const hops = await decompose(queryText);
    if (hops.length === 1) return base;

    // The atomic hop is the one carrying `depends_on`; the hop it points to is
    // the bridge-resolution hop (the clean "What does A authenticate via?"
    // question, with no `{0}` placeholder). The old code mistakenly fed the
    // atomic hop's own `{0}`-bearing query to extractBridge — never resolve the
    // bridge from the templated question.
    const atomicHop = hops.find((h) => h.depends_on !== undefined);
    if (!atomicHop || atomicHop.depends_on === undefined) return base;
    const depIdx = atomicHop.depends_on;
    const bridgeHop = hops[depIdx];
    if (!bridgeHop) return base;

    // Resolve B from `base`'s own top chunks — the relational chunk lives there
    // ~95% of the time, vs the ~30% the old rephrased hop achieved.
    const bridgeEntity = await extractBridge(
      bridgeHop.query,
      base.slice(0, BRIDGE_LOOKUP_TOP).map((r) => r.chunk_id),
    );
    if (!bridgeEntity) return base;

    const atomicQuery = atomicHop.query.replace(/\{(\d+)\}/g, (_, idx: string) =>
      parseInt(idx, 10) === depIdx ? bridgeEntity : `{${idx}}`,
    );
    logger.debug("multi_hop.resolved", { text_preview: atomicQuery.slice(0, 200) });

    const atomic = await inner.retrieve(atomicQuery, HOP_FETCH_K);
    // Telemetry for the INJECT_SLOTS decision: `text_preview` is the ORIGINAL
    // query (joins to query_id → expected atomic chunk), `chunk_ids` are the
    // raw atomic sub-query candidates in rank order, so a post-hoc script can
    // measure where the true atomic chunk lands before locking the slot count.
    logger.debug("multi_hop.atomic_candidates", {
      text_preview: queryText.slice(0, 200),
      chunk_ids: atomic.map((r) => r.chunk_id),
    });

    return injectAtomic(base, atomic, k, windowK);
  };

  return {
    name: `${inner.name}+multi-hop`,
    config_snapshot: {
      ...inner.config_snapshot,
      multi_hop: {
        planner_model: plannerModel,
        hop_fetch_k: HOP_FETCH_K,
        window_k: windowK,
        inject_slots: INJECT_SLOTS,
      },
    },
    retrieve,
  };
};

/**
 * Merges bridge-resolved atomic chunks into the single-pass ranking WITHOUT
 * demoting anything the original query already placed inside the reader window.
 *
 * The original ranking (`base`) is authoritative — it reliably carries the
 * relational chunk. We reserve the last `INJECT_SLOTS` positions of the window
 * (`windowK`) for the atomic sub-query's TOP candidates that `base` missed, so
 * the bridged fact reaches the reader while the protected head (top
 * `windowK - reserved`) is untouched — unlike RRF, this cannot push a correct
 * head chunk out.
 *
 * Crucially we walk the atomic candidates in sub-query rank order and STOP at
 * the first one already in `base`'s window: a high-confidence atomic chunk the
 * original query already retrieved means the atomic need is met, so injecting a
 * lower-ranked (likely distractor) candidate would only evict the real chunk
 * from the window boundary. So when the sub-query's #1 is already in-window,
 * nothing is injected.
 */
const injectAtomic = (
  base: readonly RetrievalResult[],
  atomic: readonly RetrievalResult[],
  k: number,
  windowK: number,
): RetrievalResult[] => {
  const windowIds = new Set(base.slice(0, windowK).map((r) => r.chunk_id));
  const reserve: RetrievalResult[] = [];
  const reserveIds = new Set<string>();
  for (const cand of atomic) {
    // A top atomic candidate already in-window satisfies the atomic need —
    // stop, don't displace it with a worse one.
    if (windowIds.has(cand.chunk_id)) break;
    if (reserveIds.has(cand.chunk_id)) continue;
    reserve.push(cand);
    reserveIds.add(cand.chunk_id);
    if (reserve.length >= INJECT_SLOTS) break;
  }
  if (reserve.length === 0) return base.slice(0, k);

  const headCount = Math.max(0, windowK - reserve.length);
  const head = base.slice(0, headCount);
  const tail = base.slice(headCount).filter((r) => !reserveIds.has(r.chunk_id));
  return [...head, ...reserve, ...tail].slice(0, k);
};

const parseJson = <T>(text: string, schema: z.ZodType<T>): T | null => {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence?.[1]) candidates.push(fence[1].trim());
  const balanced = extractBalancedJsonObject(trimmed);
  if (balanced) candidates.push(balanced);
  for (const c of candidates) {
    try {
      const result = schema.safeParse(JSON.parse(c));
      if (result.success) return result.data;
    } catch {
      // fall through
    }
  }
  return null;
};

const extractBalancedJsonObject = (text: string): string | null => {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
};
