import { parseAbi } from "viem";
import { accountFor, assertArcTestnet, deployment, explorerUrl, oracleAbi, publicClient, walletClientFor } from "./demo-round-common.mjs";
import { poolKey, Q96, sqrt } from "./pool-lib.mjs";

const poolManagerAbi = parseAbi([
  "function initialize((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,uint160 sqrtPriceX96) returns (int24 tick)",
]);
const oracleAddress = deployment.contracts.priceOracle;
const account = accountFor(process.env.DEPLOYER_PK, deployment.admin, "deployer");
const wallet = walletClientFor(account);

await assertArcTestnet();

const [answer, decimals, updatedAt] = await publicClient.readContract({
  address: oracleAddress,
  abi: oracleAbi,
  functionName: "latestPrice",
});
const block = await publicClient.getBlock();
if (answer <= 0n || updatedAt === 0n || updatedAt > block.timestamp || block.timestamp - updatedAt > 300n) {
  throw new Error("The new oracle price is absent or stale; update it before initializing the pool.");
}

const priceUsdc6 = answer * 1_000_000n / 10n ** BigInt(decimals);
const sqrtPriceX96 = sqrt((10n ** 18n * Q96 * Q96) / priceUsdc6);
const { request } = await publicClient.simulateContract({
  account,
  address: deployment.contracts.poolManager,
  abi: poolManagerAbi,
  functionName: "initialize",
  args: [poolKey, sqrtPriceX96],
});
const hash = await wallet.writeContract(request);
const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
if (receipt.status !== "success") throw new Error(`Pool initialization reverted: ${hash}`);
console.log(`Initialized the new USDC/tETH v4 pool at oracle price: ${explorerUrl}/tx/${hash}`);
