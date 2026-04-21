// author: Claude
import type { SparseVector } from "./bm25";

/**
 * Thin `fetch` wrapper over the Qdrant HTTP API (§37, Appendix E).
 *
 * The bench uses a narrow subset (named-vector query + payload extraction),
 * and the SDK's broader surface isn't worth the dependency weight. If this
 * module grows hairy, drop in `@qdrant/js-client-rest` — the SDK is gated
 * in per I14 (active maintenance, no CVE, no telemetry).
 */

export type QdrantQueryHit = {
  id: string | number;
  score: number;
  payload: Record<string, unknown>;
};

type DenseQueryBody = {
  using: "dense";
  query: number[];
  limit: number;
  with_payload: string[];
  filter?: QdrantFilter;
};

type SparseQueryBody = {
  using: "bm25";
  query: SparseVector;
  limit: number;
  with_payload: string[];
  filter?: QdrantFilter;
};

type QdrantFilter = {
  must?: Array<{ key: string; match: { value: string | number } }>;
};

/**
 * POST `/collections/{name}/points/query` with a named-vector query body.
 *
 * Handles Qdrant's `{ result: { points: [...] } }` envelope and normalizes
 * hits into the `QdrantQueryHit` shape so callers don't repeat the dig.
 */
export const qdrantQuery = async (args: {
  qdrantUrl: string;
  apiKey?: string;
  collection: string;
  body: DenseQueryBody | SparseQueryBody;
}): Promise<QdrantQueryHit[]> => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (args.apiKey) headers["api-key"] = args.apiKey;

  const res = await fetch(
    `${args.qdrantUrl}/collections/${args.collection}/points/query`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(args.body),
    },
  );

  if (res.status === 404) return [];
  if (!res.ok) {
    throw new QdrantHttpError(res.status, await safeText(res));
  }

  const json = (await res.json()) as {
    result?: { points?: QdrantQueryHit[] };
  };
  return json.result?.points ?? [];
};

export class QdrantHttpError extends Error {
  constructor(
    readonly status: number,
    readonly bodyText: string,
  ) {
    super(`Qdrant HTTP ${status}: ${bodyText.slice(0, 200)}`);
    this.name = "QdrantHttpError";
  }
}

/**
 * Returns `true` if a named collection exists on the given Qdrant.
 *
 * Used by the `health` subcommand to confirm the bench is pointed at a
 * Qdrant that's been initialized by `june init`.
 */
export const qdrantCollectionExists = async (args: {
  qdrantUrl: string;
  apiKey?: string;
  collection: string;
}): Promise<boolean> => {
  const headers: Record<string, string> = {};
  if (args.apiKey) headers["api-key"] = args.apiKey;
  const res = await fetch(
    `${args.qdrantUrl}/collections/${args.collection}/exists`,
    { method: "GET", headers },
  );
  if (!res.ok) return false;
  const json = (await res.json()) as { result?: { exists?: boolean } };
  return json.result?.exists === true;
};

const safeText = async (res: Response): Promise<string> => {
  try {
    return await res.text();
  } catch {
    return "";
  }
};

/** Builds a `must:[{ key, match }]` filter clause limited to one doc id (§19 doc-scoping). */
export const filterByDocId = (doc_id: string): QdrantFilter => ({
  must: [{ key: "doc_id", match: { value: doc_id } }],
});
