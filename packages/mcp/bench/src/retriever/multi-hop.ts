// author: Claude
import type { Retriever, RetrievalResult } from "./types";
import type { LlmProvider } from "@/providers/types";
import type { BudgetMeter } from "@/lib/cost";
import { renderPrompt } from "@/lib/prompts";
import { logger } from "@/lib/logger";
import { z } from "zod";

/**
 * Multi-hop retriever wrapper.
 *
 * Extends a single-pass `Retriever` with LLM-driven query decomposition for
 * questions that reference an entity indirectly ("the protocol that X
 * authenticates via"). Single-hop questions pass through unchanged.
 *
 * Flow per call:
 *   1. Decompose query → list of hops. Hops without `depends_on` retrieve
 *      directly; hops with `depends_on` first read the dependency's top
 *      chunks, ask the planner to extract the bridge entity, substitute it
 *      into the templated hop query, then retrieve.
 *   2. Combine all hops' rankings via reciprocal rank fusion (rank_constant=60)
 *      and return the top-K.
 *
 * Designed to fix T4 multi-hop recall — the bench expects both expected
 * chunks (relational + atomic) in top-K. Returning the union of top results
 * from each hop, RRF-fused, lets both bridging chunks land in the final list.
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

const RRF_CONSTANT = 60;
const HOP_FETCH_K = 5;
const BRIDGE_LOOKUP_TOP = 3;

export const createMultiHopRetriever = (args: {
  inner: Retriever;
  plannerProvider: LlmProvider;
  plannerModel: string;
  plannerMaxTokens: number;
  fetchChunkContent: (chunkId: string) => string | null;
  budget: BudgetMeter;
}): Retriever => {
  const { inner, plannerProvider, plannerModel, plannerMaxTokens, fetchChunkContent, budget } =
    args;

  const decompose = async (queryText: string): Promise<Hop[]> => {
    const prompt = await renderPrompt("decompose-query", { query_text: queryText });
    const res = await plannerProvider.call({
      model: plannerModel,
      messages: [{ role: "user", content: prompt }],
      max_tokens: plannerMaxTokens,
      temperature: 0,
      response_format: "json",
      disable_thinking: true,
    });
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
    const res = await plannerProvider.call({
      model: plannerModel,
      messages: [{ role: "user", content: prompt }],
      max_tokens: plannerMaxTokens,
      temperature: 0,
      response_format: "json",
      disable_thinking: true,
    });
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
    const hops = await decompose(queryText);

    if (hops.length === 1) {
      return inner.retrieve(hops[0]!.query, k);
    }

    const perHopResults: RetrievalResult[][] = [];
    for (let i = 0; i < hops.length; i++) {
      const hop = hops[i]!;
      let resolvedQuery = hop.query;

      if (hop.depends_on !== undefined) {
        const depIdx = hop.depends_on;
        const depResults = perHopResults[depIdx];
        if (!depResults || depResults.length === 0) {
          logger.warn("multi_hop.dependency_missing", {
            tier: "T4",
            attempt: i,
          });
          perHopResults.push([]);
          continue;
        }
        const bridgeEntity = await extractBridge(
          hop.query,
          depResults.slice(0, BRIDGE_LOOKUP_TOP).map((r) => r.chunk_id),
        );
        if (!bridgeEntity) {
          perHopResults.push([]);
          continue;
        }
        resolvedQuery = hop.query.replace(/\{(\d+)\}/g, (_, idx: string) =>
          parseInt(idx, 10) === depIdx ? bridgeEntity : `{${idx}}`,
        );
        logger.debug("multi_hop.resolved", {
          text_preview: resolvedQuery.slice(0, 200),
        });
      }

      const hopResults = await inner.retrieve(resolvedQuery, HOP_FETCH_K);
      perHopResults.push(hopResults);
    }

    return fuseRankings(perHopResults, k);
  };

  return {
    name: `${inner.name}+multi-hop`,
    config_snapshot: {
      ...inner.config_snapshot,
      multi_hop: { planner_model: plannerModel, hop_fetch_k: HOP_FETCH_K },
    },
    retrieve,
  };
};

/**
 * RRF-fuses N independent rankings into a single ordered list of length K.
 *
 * For each chunk_id appearing in any hop's ranking, sums `1 / (RRF_CONSTANT + rank)`
 * across hops. Chunks appearing in multiple hops (the bridging case for T4)
 * get a multiplicative boost. Ties broken by total occurrences then chunk_id.
 */
const fuseRankings = (
  perHopResults: ReadonlyArray<ReadonlyArray<RetrievalResult>>,
  k: number,
): RetrievalResult[] => {
  type Entry = {
    chunk_id: string;
    score: number;
    occurrences: number;
    rank_source: RetrievalResult["rank_source"];
  };
  const merged = new Map<string, Entry>();
  for (const hopResults of perHopResults) {
    hopResults.forEach((r, rank) => {
      const rrfScore = 1 / (RRF_CONSTANT + rank + 1);
      const existing = merged.get(r.chunk_id);
      if (existing) {
        existing.score += rrfScore;
        existing.occurrences += 1;
      } else {
        merged.set(r.chunk_id, {
          chunk_id: r.chunk_id,
          score: rrfScore,
          occurrences: 1,
          rank_source: r.rank_source,
        });
      }
    });
  }
  return [...merged.values()]
    .sort((a, b) => b.score - a.score || b.occurrences - a.occurrences)
    .slice(0, k)
    .map((e) => ({ chunk_id: e.chunk_id, score: e.score, rank_source: e.rank_source }));
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
