import type { Address, Hash } from "viem";
import deployment from "../../contracts/deployments/current.json";

export type ExplorerLog = {
  name: string;
  params: Record<string, string>;
  txHash: Hash;
  blockNumber: number;
};

type RawLog = {
  block_number: number;
  transaction_hash: Hash;
  decoded?: { method_call?: string; parameters?: { name: string; value: string }[] } | null;
};

const API = `${deployment.explorerUrl}/api/v2`;

export const explorerTx = (hash: string) => `${deployment.explorerUrl}/tx/${hash}`;
export const explorerAddress = (address: string) => `${deployment.explorerUrl}/address/${address}`;

// The RPC rejects eth_getLogs ranges above ~5000 blocks, so event history comes from the explorer's indexed logs.
export async function fetchLogs(address: Address, maxPages = 8): Promise<ExplorerLog[]> {
  const logs: ExplorerLog[] = [];
  let query = "";
  for (let page = 0; page < maxPages; page++) {
    const response = await fetch(`${API}/addresses/${address}/logs${query}`);
    if (!response.ok) throw new Error(`Explorer log request failed (${response.status}).`);
    const body = await response.json() as { items: RawLog[]; next_page_params: Record<string, string | number> | null };
    for (const item of body.items) {
      const call = item.decoded?.method_call;
      if (!call) continue;
      logs.push({
        name: call.split("(")[0],
        params: Object.fromEntries((item.decoded?.parameters ?? []).map((parameter) => [parameter.name, parameter.value])),
        txHash: item.transaction_hash,
        blockNumber: item.block_number,
      });
    }
    if (!body.next_page_params) break;
    query = `?${new URLSearchParams(Object.entries(body.next_page_params).map(([key, value]) => [key, String(value)]))}`;
  }
  return logs;
}
