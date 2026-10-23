import {
  createPublicClient,
  createWalletClient,
  defineChain,
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  http,
  keccak256,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const rpcUrl = process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io";
const callbackAddress = process.env.V4_CALLBACK_ADDRESS;
const privateKey = process.env.DEPLOYER_PK;
const poolManagerAddress = "0x2756F3F7bFAf103F4c550f4d24CdCa82B093240A";
const usdcAddress = "0x3600000000000000000000000000000000000000";
const tEthAddress = "0x82EA73ad4a39a5673a910c7Ef76BcF03b3DC531d";
const oracleAddress = "0xb064CeEd9E9a74FfAf89C6DeaDF902876e2e456d";
const usdcLiquidity = 500_000n;
const swapAmount = 50_000n;
const maxTEthAmount = 1_000_000_000_000_000n;
const tickLower = -887_220;
const tickUpper = 887_220;
const q96 = 1n << 96n;
const q128 = 1n << 128n;
const q192 = 1n << 192n;
const usdcUnit = 1_000_000n;
const tEthUnit = 1_000_000_000_000_000_000n;
const poolSlot = `0x${"0".repeat(63)}6`;

if (!callbackAddress || !/^0x[0-9a-fA-F]{40}$/.test(callbackAddress)) {
  throw new Error("Set V4_CALLBACK_ADDRESS to the deployed smoke-test callback.");
}
if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error("Set DEPLOYER_PK to the callback owner private key.");
}

const chain = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const account = privateKeyToAccount(privateKey);
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

if ((await publicClient.getChainId()) !== chain.id) {
  throw new Error(`RPC is not Arc Testnet (chain ID ${chain.id}).`);
}

const poolKey = {
  currency0: usdcAddress,
  currency1: tEthAddress,
  fee: 3_000,
  tickSpacing: 60,
  hooks: "0x0000000000000000000000000000000000000000",
};
const poolKeyType = {
  type: "tuple",
  components: [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
  ],
};
const poolId = keccak256(encodeAbiParameters([poolKeyType], [poolKey]));
const stateSlot = keccak256(encodePacked(["bytes32", "bytes32"], [poolId, poolSlot]));
const poolManagerAbi = parseAbi([
  "function initialize((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,uint160 sqrtPriceX96) returns (int24 tick)",
  "function extsload(bytes32 slot) view returns (bytes32)",
]);
const callbackAbi = parseAbi([
  "function owner() view returns (address)",
  "function execute(bytes data) returns (bytes result)",
]);
const usdcAbi = parseAbi([
  "function approve(address spender,uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);
const tEthAbi = parseAbi([
  "function approve(address spender,uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);
const oracleAbi = parseAbi([
  "function latestPrice() view returns (int256 price_,uint8 priceDecimals,uint64 updatedAt)",
]);

const owner = await publicClient.readContract({
  address: callbackAddress,
  abi: callbackAbi,
  functionName: "owner",
});
if (owner.toLowerCase() !== account.address.toLowerCase()) {
  throw new Error("DEPLOYER_PK does not own V4_CALLBACK_ADDRESS.");
}

const latestPrice = await publicClient.readContract({
  address: oracleAddress,
  abi: oracleAbi,
  functionName: "latestPrice",
});
const [oracleAnswer, oracleDecimals, oracleUpdatedAt] = latestPrice;
const now = (await publicClient.getBlock()).timestamp;
if (oracleUpdatedAt === 0n || oracleUpdatedAt > now || now - oracleUpdatedAt > 300n) {
  throw new Error("The on-chain ETH/USD oracle update is stale; refresh it before the smoke test.");
}
const priceUsdcPerTEth = (oracleAnswer * usdcUnit) / 10n ** BigInt(oracleDecimals);
if (priceUsdcPerTEth <= 0n) throw new Error("Oracle price is invalid.");

let slot0 = await publicClient.readContract({
  address: poolManagerAddress,
  abi: poolManagerAbi,
  functionName: "extsload",
  args: [stateSlot],
});
let sqrtPriceX96 = BigInt(slot0) & ((1n << 160n) - 1n);

const sqrt = (value) => {
  if (value < 2n) return value;
  let x = value >> 1n;
  let y = (x + value / x) >> 1n;
  while (y < x) {
    x = y;
    y = (x + value / x) >> 1n;
  }
  return x;
};

const sendAndConfirm = async (hash) => {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Transaction reverted: ${hash}`);
  return receipt;
};

let initializeHash;
if (sqrtPriceX96 === 0n) {
  sqrtPriceX96 = sqrt((tEthUnit * q192) / priceUsdcPerTEth);
  const { request } = await publicClient.simulateContract({
    account,
    address: poolManagerAddress,
    abi: poolManagerAbi,
    functionName: "initialize",
    args: [poolKey, sqrtPriceX96],
  });
  initializeHash = await walletClient.writeContract(request);
  await sendAndConfirm(initializeHash);
} else {
  const ratioX128 = (sqrtPriceX96 * sqrtPriceX96) >> 64n;
  const poolPrice = (tEthUnit * q128) / ratioX128;
  const deviationBps = (poolPrice > priceUsdcPerTEth
    ? poolPrice - priceUsdcPerTEth
    : priceUsdcPerTEth - poolPrice) * 10_000n / priceUsdcPerTEth;
  if (deviationBps > 500n) {
    throw new Error(`Existing pool price differs from the oracle by ${deviationBps} bps; refusing to add liquidity.`);
  }
}

const liquidity = (usdcLiquidity * sqrtPriceX96 / q96) * 9n / 10n;
if (liquidity === 0n || liquidity > (1n << 127n) - 1n) {
  throw new Error("Calculated liquidity is outside the supported range.");
}

const usdcBalance = await publicClient.readContract({
  address: usdcAddress,
  abi: usdcAbi,
  functionName: "balanceOf",
  args: [account.address],
});
const tEthBalance = await publicClient.readContract({
  address: tEthAddress,
  abi: tEthAbi,
  functionName: "balanceOf",
  args: [account.address],
});
if (usdcBalance < usdcLiquidity + swapAmount) throw new Error("Not enough USDC for the smoke-test liquidity and swap.");
if (tEthBalance < maxTEthAmount) throw new Error("Not enough tETH for the smoke-test liquidity.");

const approveUsdcHash = await walletClient.writeContract({
  address: usdcAddress,
  abi: usdcAbi,
  functionName: "approve",
  args: [callbackAddress, usdcLiquidity + swapAmount],
});
await sendAndConfirm(approveUsdcHash);
const approveTEthHash = await walletClient.writeContract({
  address: tEthAddress,
  abi: tEthAbi,
  functionName: "approve",
  args: [callbackAddress, maxTEthAmount],
});
await sendAndConfirm(approveTEthHash);

const addLiquidityData = encodeAbiParameters(
  [
    { type: "uint8" },
    poolKeyType,
    { type: "address" },
    { type: "int24" },
    { type: "int24" },
    { type: "int256" },
    { type: "uint256" },
    { type: "uint256" },
  ],
  [0, poolKey, account.address, tickLower, tickUpper, liquidity, usdcLiquidity, maxTEthAmount],
);
const addLiquidityCall = encodeFunctionData({
  abi: callbackAbi,
  functionName: "execute",
  args: [addLiquidityData],
});
const addSimulation = await publicClient.call({
  account: account.address,
  to: callbackAddress,
  data: addLiquidityCall,
});
if (!addSimulation.data) throw new Error("Liquidity simulation returned no data.");
const [addLiquidityResult] = decodeAbiParameters([{ type: "bytes" }], addSimulation.data);
const [delta0, delta1] = decodeAbiParameters(
  [{ type: "int128" }, { type: "int128" }],
  addLiquidityResult,
);
if (delta0 >= 0n || delta1 >= 0n || -delta0 > usdcLiquidity || -delta1 > maxTEthAmount) {
  throw new Error(`Liquidity simulation exceeded approved token caps: ${delta0}, ${delta1}.`);
}
const addLiquidityHash = await walletClient.sendTransaction({
  to: callbackAddress,
  data: addLiquidityCall,
});
await sendAndConfirm(addLiquidityHash);

const swapData = encodeAbiParameters(
  [
    { type: "uint8" },
    poolKeyType,
    { type: "address" },
    { type: "bool" },
    { type: "int256" },
    { type: "uint160" },
  ],
  [1, poolKey, account.address, true, swapAmount, 4_295_128_740n],
);
const swapCall = encodeFunctionData({
  abi: callbackAbi,
  functionName: "execute",
  args: [swapData],
});
const swapSimulation = await publicClient.call({
  account: account.address,
  to: callbackAddress,
  data: swapCall,
});
if (!swapSimulation.data) throw new Error("Swap simulation returned no data.");
const [swapResult] = decodeAbiParameters([{ type: "bytes" }], swapSimulation.data);
const [swapDelta0, swapDelta1] = decodeAbiParameters(
  [{ type: "int128" }, { type: "int128" }],
  swapResult,
);
if (swapDelta0 >= 0n || swapDelta1 <= 0n) {
  throw new Error(`Expected a USDC-in/tETH-out swap, received deltas ${swapDelta0}, ${swapDelta1}.`);
}
const swapHash = await walletClient.sendTransaction({ to: callbackAddress, data: swapCall });
await sendAndConfirm(swapHash);

slot0 = await publicClient.readContract({
  address: poolManagerAddress,
  abi: poolManagerAbi,
  functionName: "extsload",
  args: [stateSlot],
});
if ((BigInt(slot0) & ((1n << 160n) - 1n)) === 0n) throw new Error("PoolManager reports an uninitialized pool after the smoke test.");

console.log(`Pool ID: ${poolId}`);
console.log(`Initial price: ${priceUsdcPerTEth} USDC base units per 1 tETH`);
console.log(`Liquidity: ${liquidity}`);
console.log(`Liquidity deltas: ${delta0}, ${delta1}`);
console.log(`Swap deltas: ${swapDelta0}, ${swapDelta1}`);
if (initializeHash) console.log(`Initialize: ${initializeHash}`);
console.log(`Approve USDC: ${approveUsdcHash}`);
console.log(`Approve tETH: ${approveTEthHash}`);
console.log(`Add liquidity: ${addLiquidityHash}`);
console.log(`Swap: ${swapHash}`);
