import { BaseError, http } from "viem";
import { AsyncLocalStorage } from "node:async_hooks";

const RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 32_000];
const PRIMARY_COOLDOWN_MS = 60_000;
let arcRequestQueue = Promise.resolve();
const routers = new Map();
const affinity = new AsyncLocalStorage();

export function withRpcAffinity(operation) {
  return affinity.run({ endpoint: null }, operation);
}

export function create429RetryFetch(primaryUrl, fallbackUrls = "", {
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  warn = console.warn,
  now = Date.now,
  cooldownMs = PRIMARY_COOLDOWN_MS,
} = {}) {
  const urls = [...new Set([primaryUrl, ...fallbackUrls.split(",").map((url) => url.trim()).filter(Boolean)])];
  let preferred = 0;
  let primaryRetryAt = 0;
  const request = async (init) => {
    let methods;
    try {
      const body = JSON.parse(init.body);
      methods = (Array.isArray(body) ? body : [body]).map((item) => item.method);
    } catch {
      methods = [];
    }
    const mayBroadcast = methods.length === 0 || methods.some((method) => !method || /^eth_send|^personal_|^wallet_/i.test(method));
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      const first = preferred !== 0 && now() >= primaryRetryAt ? 0 : preferred;
      const session = affinity.getStore();
      const order = session?.endpoint !== null && session?.endpoint !== undefined
        ? [session.endpoint]
        : [first, ...urls.map((_, index) => index).filter((index) => index !== first)];
      for (const index of order) {
        try {
          const response = await fetchImpl(urls[index], init);
          if (![401, 403, 429].includes(response.status)) {
            if (response.ok) {
              preferred = index;
              if (session) session.endpoint = index;
            }
            return response;
          }
          if (index === 0) primaryRetryAt = now() + cooldownMs;
          warn(`Arc RPC endpoint ${index + 1} returned HTTP ${response.status}; trying another endpoint.`);
        } catch (error) {
          if (mayBroadcast) throw error;
          if (index === 0) primaryRetryAt = now() + cooldownMs;
          warn(`Arc RPC endpoint ${index + 1} failed (${error.name}); trying another endpoint.`);
        }
      }
      if (attempt < RETRY_DELAYS_MS.length) {
        warn(`All Arc RPC endpoints unavailable; retrying in ${RETRY_DELAYS_MS[attempt] / 1000}s.`);
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
    throw new BaseError("All configured Arc RPC endpoints are unavailable.");
  };
  return (_url, init) => {
    const result = arcRequestQueue.then(() => request(init));
    arcRequestQueue = result.then(() => undefined, () => undefined);
    return result;
  };
}

export function arcHttpTransport(primaryUrl, fallbackUrls = process.env.ARC_TESTNET_RPC_FALLBACK ?? "") {
  const key = JSON.stringify([primaryUrl, fallbackUrls]);
  if (!routers.has(key)) routers.set(key, create429RetryFetch(primaryUrl, fallbackUrls));
  return http(primaryUrl, { fetchFn: routers.get(key), retryCount: 0 });
}
