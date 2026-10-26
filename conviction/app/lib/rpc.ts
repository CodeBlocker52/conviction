import { custom, defineChain, http, type EIP1193RequestFn } from "viem";
import deployment from "../../contracts/deployments/current.json";

export const RPC_URL = process.env.NEXT_PUBLIC_ARC_RPC_URL || deployment.rpcUrl;
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

export const arcTestnet = defineChain({
  id: deployment.chainId,
  name: deployment.chainName,
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "Arc Explorer", url: deployment.explorerUrl } },
  contracts: { multicall3: { address: MULTICALL3 } },
});

type ReadProvider = { request: EIP1193RequestFn };

let walletProvider: ReadProvider | null = null;
let requestCount = 0;

// The connected wallet's provider is tried first for reads (only while it is on Arc), then the public RPC.
export function setReadProvider(provider: ReadProvider | null) {
  walletProvider = provider;
}

export function rpcRequestCount() {
  return requestCount;
}

export function isRateLimitError(error: unknown) {
  const text = error instanceof Error ? `${error.message} ${(error as { details?: string }).details ?? ""}` : String(error);
  const code = (error as { code?: number } | null)?.code;
  return code === -32005 || code === 429 || /rate limit|exceeds defined limit|too many requests|429|timeout|timed out|fetch failed|failed to fetch|network/i.test(text);
}

const publicRpc = http(RPC_URL, { retryCount: 0, timeout: 15_000 })({ chain: arcTestnet, retryCount: 0 });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const request: EIP1193RequestFn = async (args) => {
  if (walletProvider) {
    try {
      requestCount += 1;
      return await walletProvider.request(args);
    } catch {
      // Fall through to the public RPC.
    }
  }
  const maxAttempts = 5;
  for (let attempt = 0; ; attempt += 1) {
    try {
      requestCount += 1;
      return await publicRpc.request(args as never);
    } catch (error) {
      if (attempt >= maxAttempts - 1 || !isRateLimitError(error)) throw error;
      await wait(500 * 2 ** attempt + Math.random() * 250);
    }
  }
};

export const readTransport = custom({ request }, { retryCount: 0 });

// Shared "data may be stale" flag so the shell can show one small notice for every live page.
let rpcStale = false;
const staleListeners = new Set<() => void>();
export function setRpcStale(value: boolean) {
  if (rpcStale === value) return;
  rpcStale = value;
  staleListeners.forEach((listener) => listener());
}
export function subscribeRpcStale(listener: () => void) {
  staleListeners.add(listener);
  return () => { staleListeners.delete(listener); };
}
export const getRpcStale = () => rpcStale;
