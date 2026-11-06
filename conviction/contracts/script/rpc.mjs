import { BaseError, http } from "viem";

const RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 32_000];

class ArcRateLimitError extends BaseError {
  constructor(message) {
    super(message);
    this.code = 400;
  }
}

export function create429RetryFetch(
  primaryUrl,
  fallbackUrl = "",
  {
    fetchImpl = globalThis.fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    warn = console.warn,
  } = {},
) {
  async function fetchUntilAvailable(url, label, init) {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      const response = await fetchImpl(url, init);
      if (response.status !== 429) return response;
      if (attempt === RETRY_DELAYS_MS.length) return null;
      const delay = RETRY_DELAYS_MS[attempt];
      warn(`${label} RPC returned HTTP 429; retrying in ${delay / 1_000}s.`);
      await sleep(delay);
    }
    return null;
  }

  return async (_url, init) => {
    const response = await fetchUntilAvailable(primaryUrl, "Primary Arc", init);
    if (response) return response;

    if (!fallbackUrl || fallbackUrl === primaryUrl) {
      throw new ArcRateLimitError("Primary Arc RPC returned repeated HTTP 429 responses; no distinct fallback RPC is configured.");
    }

    warn("Primary Arc RPC remains rate-limited; switching to ARC_TESTNET_RPC_FALLBACK.");
    const fallbackResponse = await fetchUntilAvailable(fallbackUrl, "Fallback Arc", init);
    if (!fallbackResponse) {
      throw new ArcRateLimitError("Primary and fallback Arc RPCs returned repeated HTTP 429 responses.");
    }
    return fallbackResponse;
  };
}

export function arcHttpTransport(primaryUrl, fallbackUrl = process.env.ARC_TESTNET_RPC_FALLBACK) {
  return http(primaryUrl, {
    fetchFn: create429RetryFetch(primaryUrl, fallbackUrl),
    retryCount: 3,
    retryDelay: 1_000,
  });
}
