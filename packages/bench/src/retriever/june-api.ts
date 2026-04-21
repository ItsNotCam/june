// author: Claude
import type { Retriever } from "./types";

/**
 * Placeholder for a future `june-api` adapter (§35).
 *
 * When june exposes a public retrieval API, this file gains a
 * `createJuneApiRetriever()` that calls that surface. Nothing else in the
 * bench needs to change — the `Retriever` interface is the seam. Swapping
 * adapters is a single config change (`retrieval.adapter`) plus this file.
 */
export const createJuneApiRetriever = (): Retriever => {
  throw new Error(
    "juneapi adapter not implemented in v1; use `retrieval.adapter: stopgap` for now",
  );
};
