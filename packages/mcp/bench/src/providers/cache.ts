// author: Claude
import type {
  BatchLlmProvider,
  BatchPollStatus,
  BatchResult,
  BatchSubmitRequest,
  LlmCallResponse,
  LlmProvider,
} from "./types";
import {
  buildEntry,
  cacheRead,
  cacheWrite,
  keyForBatchRequest,
  keyForLlmCall,
} from "@/lib/llm-cache";
import { logger } from "@/lib/logger";

/**
 * Provider-cache wrappers (§37).
 *
 * Wrap any `LlmProvider` or `BatchLlmProvider` so that identical requests
 * return the prior response from disk instead of hitting the API. Cache hits
 * report `cost_usd: 0` (the run didn't pay), `latency_ms: 0`. The original
 * cost stays in the cache file for accounting if a future report wants it.
 *
 * The wrappers are fully transparent — the wrapped provider's `name` field
 * is preserved, so `resolveSyncProvider` and downstream type-narrowing keep
 * working. Stage code never knows the cache exists.
 */

/**
 * Wraps a sync provider so identical `(model, system, messages, max_tokens,
 * temperature, response_format, disable_thinking)` requests are served from
 * disk. Hits are logged at `debug` so operators can verify cache behavior
 * without spamming `info`.
 */
export const withProviderCache = (
  provider: LlmProvider,
  cache_root: string,
): LlmProvider => {
  return {
    name: provider.name,
    call: async (req) => {
      const key = keyForLlmCall(provider.name, req);
      const hit = await cacheRead({ cache_root, provider: provider.name, key });
      if (hit) {
        logger.debug("cache.hit", { provider: provider.name, key });
        return responseFromEntry(hit);
      }

      const response = await provider.call(req);

      const firstUser = req.messages.find((m) => m.role === "user")?.content ?? "";
      await cacheWrite({
        cache_root,
        provider: provider.name,
        key,
        entry: buildEntry({
          provider: provider.name,
          model: req.model,
          max_tokens: req.max_tokens,
          temperature: req.temperature,
          first_user_message: firstUser,
          response,
        }),
      });
      logger.debug("cache.miss", { provider: provider.name, key });
      return response;
    },
  };
};

/**
 * Wraps the Anthropic Batch provider with per-request disk caching.
 *
 * Strategy: at submit time, partition requests into hits (already cached) and
 * misses (need to be sent). If all hits, short-circuit — return a synthetic
 * `cached:<hash>` batch_id and resolve poll/retrieve from memory. If some
 * misses, submit only the misses to the real API and remember which custom_ids
 * we expect from the wire, then merge with the cached hits at retrieve time.
 *
 * Synthetic batch_id encoding (round-trips through Stage 8's checkpoint file):
 * - `cached:<hash>`            — every request hit; nothing was sent.
 * - `mixed:<real_id>:<hash>`   — some hit, some miss; `<real_id>` is the
 *                                Anthropic batch id for the partial submit.
 *
 * `<hash>` is a per-batch random hex token used as the in-memory map key —
 * the wrapper holds the partition state in a Map keyed by this hash. If the
 * process restarts mid-batch (rare), the cache keys on disk still allow a
 * fresh run to re-partition correctly; the in-memory map is best-effort.
 */
export const withBatchProviderCache = (
  provider: BatchLlmProvider,
  cache_root: string,
): BatchLlmProvider => {
  type Pending = {
    /** Cached results, restored at retrieve time with their original custom_ids. */
    cached: BatchResult[];
    /** custom_id → cache key, for misses we expect to receive from the wire. */
    miss_keys: Map<string, string>;
    /** custom_id → first user message, kept so we can write a complete cache entry on retrieve. */
    miss_user: Map<string, string>;
    /** Model used by the batch — needed to compute cache key for missed entries. */
    model: string;
  };
  const pending = new Map<string, Pending>();

  const submit = async (
    requests: BatchSubmitRequest[],
  ): Promise<{ batch_id: string }> => {
    const cached: BatchResult[] = [];
    const miss_requests: BatchSubmitRequest[] = [];
    const miss_keys = new Map<string, string>();
    const miss_user = new Map<string, string>();

    // Determine model from the first request (Anthropic Batch is single-model
    // per submit in practice — judge calls share the configured judge model).
    const model = requests[0]?.model ?? "unknown";

    await Promise.all(
      requests.map(async (r) => {
        const key = keyForBatchRequest({
          provider_name: "anthropic-batch",
          model: r.model,
          max_tokens: r.max_tokens,
          temperature: r.temperature,
          system: r.system,
          user_content: r.messages[0]?.content ?? "",
        });
        const hit = await cacheRead({
          cache_root,
          provider: "anthropic-batch",
          key,
        });
        if (hit) {
          cached.push(batchResultFromEntry(r.custom_id, hit));
        } else {
          miss_requests.push(r);
          miss_keys.set(r.custom_id, key);
          miss_user.set(r.custom_id, r.messages[0]?.content ?? "");
        }
      }),
    );

    const partitionHash = randomHex(8);

    if (miss_requests.length === 0) {
      pending.set(partitionHash, { cached, miss_keys, miss_user, model });
      logger.info("cache.batch.full_hit", {
        request_count: requests.length,
        candidates: cached.length,
      });
      return { batch_id: `cached:${partitionHash}` };
    }

    const res = await provider.submit(miss_requests);
    pending.set(partitionHash, { cached, miss_keys, miss_user, model });
    logger.info("cache.batch.partial_hit", {
      request_count: requests.length,
      candidates: cached.length,
    });
    return { batch_id: `mixed:${res.batch_id}:${partitionHash}` };
  };

  const poll = async (batchId: string): Promise<BatchPollStatus> => {
    if (batchId.startsWith("cached:")) {
      const partitionHash = batchId.slice("cached:".length);
      return { status: "ended", results_url: `mem://${partitionHash}` };
    }
    if (batchId.startsWith("mixed:")) {
      const rest = batchId.slice("mixed:".length);
      const sep = rest.lastIndexOf(":");
      const realId = rest.slice(0, sep);
      const partitionHash = rest.slice(sep + 1);
      const inner = await provider.poll(realId);
      if (inner.status === "in_progress") return inner;
      return {
        status: "ended",
        results_url: `mixed://${partitionHash}::${inner.results_url}`,
      };
    }
    return provider.poll(batchId);
  };

  const retrieve = async (resultsUrl: string): Promise<BatchResult[]> => {
    if (resultsUrl.startsWith("mem://")) {
      const partitionHash = resultsUrl.slice("mem://".length);
      const p = pending.get(partitionHash);
      pending.delete(partitionHash);
      return p?.cached ?? [];
    }
    if (resultsUrl.startsWith("mixed://")) {
      const rest = resultsUrl.slice("mixed://".length);
      const sep = rest.indexOf("::");
      const partitionHash = rest.slice(0, sep);
      const realUrl = rest.slice(sep + 2);
      const fresh = await provider.retrieve(realUrl);
      const p = pending.get(partitionHash);
      pending.delete(partitionHash);
      if (!p) return fresh;

      // Persist newly-fetched results so the next run can hit them.
      await Promise.all(
        fresh.map(async (r) => {
          if (r.status !== "succeeded" || r.text === null) return;
          const key = p.miss_keys.get(r.custom_id);
          if (!key) return;
          const userContent = p.miss_user.get(r.custom_id) ?? "";
          await cacheWrite({
            cache_root,
            provider: "anthropic-batch",
            key,
            entry: buildEntry({
              provider: "anthropic-batch",
              model: p.model,
              max_tokens: 0,
              temperature: 0,
              first_user_message: userContent,
              response: {
                text: r.text,
                prompt_tokens: r.prompt_tokens,
                completion_tokens: r.completion_tokens,
                cost_usd: r.cost_usd,
                latency_ms: 0,
              },
            }),
          });
        }),
      );

      return [...p.cached, ...fresh];
    }
    return provider.retrieve(resultsUrl);
  };

  return { name: provider.name, submit, poll, retrieve };
};

const responseFromEntry = (entry: ReturnType<typeof buildEntry>): LlmCallResponse => ({
  text: entry.response.text,
  prompt_tokens: entry.response.prompt_tokens,
  completion_tokens: entry.response.completion_tokens,
  cost_usd: 0,
  latency_ms: 0,
});

const batchResultFromEntry = (
  custom_id: string,
  entry: ReturnType<typeof buildEntry>,
): BatchResult => ({
  custom_id,
  status: "succeeded",
  text: entry.response.text,
  error: null,
  cost_usd: 0,
  prompt_tokens: entry.response.prompt_tokens,
  completion_tokens: entry.response.completion_tokens,
});

const randomHex = (bytes: number): string => {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
};
