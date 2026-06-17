// author: Claude
import { ProviderRateLimitExhausted } from "@/lib/errors";
import { logger } from "@/lib/logger";

/** Exponential backoff schedule (ms) — five attempts total before exhaustion. */
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];

/**
 * Shared rate-limit retry helper (§27).
 *
 * Exponential backoff: 1s, 2s, 4s, 8s, 16s — five attempts total. On
 * exhaustion throws `ProviderRateLimitExhausted` which the run layer catches
 * and aborts on. Silent at `info` on first retry; `warn` on subsequent
 * retries so log scrapers can flag chronic pressure.
 *
 * `isRateLimited` is per-provider — each adapter knows its own 429 /
 * `rate_limit_exceeded` signal.
 */
export const withRateLimitRetry = async <T>(args: {
  provider: string;
  run: () => Promise<T>;
  isRateLimited: (err: unknown) => boolean;
}): Promise<T> => {
  const { provider, run, isRateLimited } = args;
  const delays = RETRY_DELAYS_MS;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (!isRateLimited(err)) throw err;
      if (attempt === delays.length) {
        throw new ProviderRateLimitExhausted(provider);
      }
      const delay = delays[attempt]!;
      const fields = {
        provider,
        attempt: attempt + 1,
        delay_ms: delay,
      };
      if (attempt === 0) logger.info("provider.rate_limit_retry", fields);
      else logger.warn("provider.rate_limit_retry", fields);
      await Bun.sleep(delay);
    }
  }

  throw new ProviderRateLimitExhausted(provider);
};
