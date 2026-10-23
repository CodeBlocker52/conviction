import { createPublicClient, createWalletClient, defineChain, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const rpcUrl = process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io";
const oracleAddress = process.env.MOCK_PRICE_ORACLE_ADDRESS;
const keeperPrivateKey = process.env.KEEPER_PK;

if (!oracleAddress || !/^0x[0-9a-fA-F]{40}$/.test(oracleAddress)) {
  throw new Error("Set MOCK_PRICE_ORACLE_ADDRESS to the deployed oracle address.");
}
if (!keeperPrivateKey || !/^0x[0-9a-fA-F]{64}$/.test(keeperPrivateKey)) {
  throw new Error("Set KEEPER_PK to the keeper private key.");
}

const chain = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const account = privateKeyToAccount(keeperPrivateKey);
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

if ((await publicClient.getChainId()) !== chain.id) {
  throw new Error(`RPC is not Arc Testnet (chain ID ${chain.id}).`);
}

async function updatePriceOnce() {
  const response = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Coinbase price request failed: HTTP ${response.status}`);

  const { data } = await response.json();
  const priceUsd = data?.amount;
  if (typeof priceUsd !== "string" || !/^\d+(\.\d+)?$/.test(priceUsd)) {
    throw new Error("Coinbase returned an invalid ETH/USD price.");
  }

  const [whole, fraction = ""] = priceUsd.split(".");
  if (fraction.length > 8 && /[1-9]/.test(fraction.slice(8))) {
    throw new Error("ETH/USD quote exceeds the oracle's 8-decimal precision.");
  }
  const price = BigInt(whole) * 100_000_000n + BigInt(fraction.slice(0, 8).padEnd(8, "0"));
  if (price <= 0n) throw new Error("ETH/USD price must be positive.");

  const hash = await walletClient.writeContract({
    address: oracleAddress,
    abi: parseAbi(["function updatePrice(int256 price_)"]),
    functionName: "updatePrice",
    args: [price],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Oracle update reverted: ${hash}`);

  console.log(`ETH/USD: $${priceUsd}`);
  console.log(`Oracle update: ${hash}`);
}

const watch = process.argv.includes("--watch");
do {
  await updatePriceOnce();
  if (watch) await new Promise((resolve) => setTimeout(resolve, 60_000));
} while (watch);
