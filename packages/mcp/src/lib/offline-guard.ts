// author: Claude
import { OfflineWhitelistViolation } from "./errors";
import { logger } from "./logger";

/**
 * Installs the offline network guard per I10 / [§25.5](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#255-offline-invariant-enforcement).
 *
 * Wraps `globalThis.fetch` so any outbound connection to a host outside the
 * configured whitelist throws `OfflineWhitelistViolation`. The whitelist is
 * derived from the exact hostnames of the `OLLAMA_URL` and `QDRANT_URL` env
 * vars — no implicit `localhost` / `127.0.0.1` fallback, by design.
 *
 * Must run at entry-point time, before any pipeline module instantiates a
 * client. Idempotent: calling it twice with the same whitelist is a no-op;
 * calling it with a different whitelist rewraps (tests reuse this).
 */

type FetchFn = typeof globalThis.fetch;

let _originalFetch: FetchFn | null = null;
let _activeWhitelist: ReadonlySet<string> | null = null;

const extractHost = (input: Parameters<FetchFn>[0]): string => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  return new URL(url).hostname;
};

/**
 * Compute the whitelist from env-var URLs. Accepts the URL strings directly
 * so tests can pass arbitrary whitelists without touching `process.env`.
 */
export const computeWhitelist = (urls: ReadonlyArray<string>): ReadonlySet<string> => {
  const set = new Set<string>();
  for (const url of urls) {
    set.add(new URL(url).hostname);
  }
  return set;
};

/**
 * Installs the guard. Safe to call repeatedly — the wrapper holds a reference
 * to the ORIGINAL fetch, not to the previously-installed wrapper.
 */
export const installOfflineGuard = (whitelist: ReadonlySet<string>): void => {
  if (_originalFetch === null) {
    _originalFetch = globalThis.fetch.bind(globalThis);
  }
  _activeWhitelist = whitelist;

  const original = _originalFetch;
  globalThis.fetch = ((input, init) => {
    const host = extractHost(input);
    if (!_activeWhitelist || !_activeWhitelist.has(host)) {
      throw new OfflineWhitelistViolation(
        host,
        _activeWhitelist ? [..._activeWhitelist] : [],
      );
    }
    return original(input, init);
  }) as FetchFn;

  logger.info("offline_guard_installed", {
    whitelist: [..._activeWhitelist],
  });
};

/**
 * Restores the original `fetch`. Test-only — production uninstalls implicitly
 * at process exit.
 */
export const uninstallOfflineGuard = (): void => {
  if (_originalFetch) {
    globalThis.fetch = _originalFetch;
    _originalFetch = null;
    _activeWhitelist = null;
  }
};

/**
 * `--verify-offline` flag implementation ([§25.5.3](../../../../.claude/plans/ingestion-pipeline-v1/SPEC.md#2553---verify-offline-flag)). Actively exercises the
 * guard at startup: a forbidden host MUST throw, and each whitelisted host
 * MUST reach the network (throwing anything other than
 * `OfflineWhitelistViolation` is also a pass — we only care that the guard
 * doesn't block them).
 */
export const verifyOffline = async (
  whitelist: ReadonlySet<string>,
  probeUrls: ReadonlyArray<string>,
): Promise<void> => {
  let forbiddenBlocked = false;
  try {
    await fetch("https://example.invalid-june-probe");
  } catch (err) {
    if (err instanceof OfflineWhitelistViolation) forbiddenBlocked = true;
    else throw err;
  }
  if (!forbiddenBlocked) {
    throw new Error("offline guard not engaged — forbidden host was not blocked");
  }

  for (const url of probeUrls) {
    try {
      await fetch(url);
    } catch (err) {
      if (err instanceof OfflineWhitelistViolation) {
        throw new Error(
          `offline guard misconfigured — probe URL ${url} was blocked (host ${new URL(url).hostname} not in whitelist)`,
        );
      }
    }
  }

  logger.info("offline_guard_verified", { whitelist: [...whitelist] });
};
