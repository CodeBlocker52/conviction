import { encodeAbiParameters, encodePacked, keccak256, toHex } from "viem";
import { deployment, poolManagerAbi, publicClient } from "./demo-round-common.mjs";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { contracts } = deployment;
export const callbackAddress = contracts.v4Callback;
export const FEE = 3_000;
export const TICK_SPACING = 60;
export const MIN_TICK = -887_220;
export const MAX_TICK = 887_220;
export const Q96 = 1n << 96n;
const MAX_UINT256 = (1n << 256n) - 1n;
export const positionFile = fileURLToPath(new URL("../deployments/pool-position.json", import.meta.url));

export const poolKey = {
  currency0: contracts.usdc,
  currency1: contracts.testAsset,
  fee: FEE,
  tickSpacing: TICK_SPACING,
  hooks: "0x0000000000000000000000000000000000000000",
};
export const poolKeyType = {
  type: "tuple",
  components: [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
  ],
};

export function ceilDiv(a, b) {
  return (a + b - 1n) / b;
}

export function sqrt(value) {
  if (value < 2n) return value;
  let x = value >> 1n;
  let y = (x + value / x) >> 1n;
  while (y < x) {
    x = y;
    y = (x + value / x) >> 1n;
  }
  return x;
}

export function sqrtPriceAtTick(tick) {
  const absoluteTick = Math.abs(tick);
  if (absoluteTick > 887_272) throw new Error(`Tick is out of range: ${tick}`);
  const constants = [
    0xfffcb933bd6fad37aa2d162d1a594001n,
    0xfff97272373d413259a46990580e213an,
    0xfff2e50f5f656932ef12357cf3c7fdccn,
    0xffe5caca7e10e4e61c3624eaa0941cd0n,
    0xffcb9843d60f6159c9db58835c926644n,
    0xff973b41fa98c081472e6896dfb254c0n,
    0xff2ea16466c96a3843ec78b326b52861n,
    0xfe5dee046a99a2a811c461f1969c3053n,
    0xfcbe86c7900a88aedcffc83b479aa3a4n,
    0xf987a7253ac413176f2b074cf7815e54n,
    0xf3392b0822b70005940c7a398e4b70f3n,
    0xe7159475a2c29b7443b29c7fa6e889d9n,
    0xd097f3bdfd2022b8845ad8f792aa5825n,
    0xa9f746462d870fdf8a65dc1f90e061e5n,
    0x70d869a156d2a1b890bb3df62baf32f7n,
    0x31be135f97d08fd981231505542fcfa6n,
    0x9aa508b5b7a84e1c677de54f3e99bc9n,
    0x5d6af8dedb81196699c329225ee604n,
    0x2216e584f5fa1ea926041bedfe98n,
    0x48a170391f7dc42444e8fa2n,
  ];
  let ratio = (absoluteTick & 1) === 1 ? constants[0] : 1n << 128n;
  for (let bit = 1; bit < constants.length; bit += 1) {
    if ((absoluteTick & (1 << bit)) !== 0) ratio = (ratio * constants[bit]) >> 128n;
  }
  if (tick > 0) ratio = MAX_UINT256 / ratio;
  return (ratio >> 32n) + ((ratio & ((1n << 32n) - 1n)) === 0n ? 0n : 1n);
}

// The pool is token0 = USDC (6 dec), token1 = tETH (18 dec); raw price = tETH raw per USDC raw.
// A USDC-per-tETH price p therefore maps to a raw price of 1e12 / p, and "higher USDC price" means a lower tick.
export function tickForUsdcPerTEth(usdcPerTEth) {
  const rawPrice = 1e12 / usdcPerTEth;
  return Math.log(rawPrice) / Math.log(1.0001);
}

export function usdcPerTEthAtTick(tick) {
  return 1e12 / 1.0001 ** tick;
}

export function usdcPerTEthFromSqrt(sqrtPriceX96) {
  const sqrtFloat = Number(sqrtPriceX96) / Number(Q96);
  return 1e12 / (sqrtFloat * sqrtFloat);
}

export function poolIdOf() {
  return keccak256(encodeAbiParameters([poolKeyType], [poolKey]));
}

function poolStateSlot() {
  // Uniswap v4-core 1.0.2 stores _pools at slot 6.
  return BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [poolIdOf(), 6n])));
}

async function extsload(slot) {
  return BigInt(await publicClient.readContract({
    address: contracts.poolManager,
    abi: poolManagerAbi,
    functionName: "extsload",
    args: [toHex(slot, { size: 32 })],
  }));
}

export async function readPool() {
  const base = poolStateSlot();
  const [slot0, liquidityWord] = await Promise.all([extsload(base), extsload(base + 3n)]);
  const sqrtPriceX96 = slot0 & ((1n << 160n) - 1n);
  const liquidity = liquidityWord & ((1n << 128n) - 1n);
  if (sqrtPriceX96 === 0n) throw new Error("The USDC/tETH v4 pool is uninitialized.");
  return { sqrtPriceX96, liquidity, usdcPerTEth: usdcPerTEthFromSqrt(sqrtPriceX96) };
}

// Position.State.liquidity, stored in State.positions (offset 6) keyed by keccak(owner, tickLower, tickUpper, salt).
export async function readPositionLiquidity(tickLower, tickUpper) {
  const positionKey = keccak256(encodePacked(
    ["address", "int24", "int24", "bytes32"],
    [callbackAddress, tickLower, tickUpper, `0x${"00".repeat(32)}`],
  ));
  const slot = BigInt(keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }],
    [positionKey, poolStateSlot() + 6n],
  )));
  return (await extsload(slot)) & ((1n << 128n) - 1n);
}

export function readSavedPosition() {
  if (!existsSync(positionFile)) return null;
  return JSON.parse(readFileSync(positionFile, "utf8"));
}

export function savePosition(position) {
  writeFileSync(positionFile, `${JSON.stringify(position, null, 2)}\n`);
}

export function amountsForLiquidity(liquidity, sqrtPrice, sqrtLower, sqrtUpper) {
  let amount0 = 0n;
  let amount1 = 0n;
  if (sqrtPrice <= sqrtLower) {
    amount0 = ceilDiv(liquidity * (sqrtUpper - sqrtLower) * Q96, sqrtLower * sqrtUpper);
  } else if (sqrtPrice < sqrtUpper) {
    amount0 = ceilDiv(liquidity * (sqrtUpper - sqrtPrice) * Q96, sqrtPrice * sqrtUpper);
    amount1 = ceilDiv(liquidity * (sqrtPrice - sqrtLower), Q96);
  } else {
    amount1 = ceilDiv(liquidity * (sqrtUpper - sqrtLower), Q96);
  }
  return { amount0, amount1 };
}

// Liquidity at which `usdcIn` (after the pool fee) moves the spot USDC/tETH price up by `impactBps`.
export function liquidityForBuyImpact(sqrtPriceX96, usdcIn, impactBps) {
  const target = sqrt((sqrtPriceX96 * sqrtPriceX96 * 10_000n) / (10_000n + BigInt(impactBps)));
  const net = usdcIn * BigInt(1_000_000 - FEE) / 1_000_000n;
  return ceilDiv(net * target * sqrtPriceX96, Q96 * (sqrtPriceX96 - target));
}

export function warnNearEdge(position, usdcPerTEth, thresholdPct = 5) {
  if (!position) return [];
  const lowEdge = usdcPerTEthAtTick(position.tickUpper);
  const highEdge = usdcPerTEthAtTick(position.tickLower);
  const warnings = [];
  const toLow = (usdcPerTEth / lowEdge - 1) * 100;
  const toHigh = (highEdge / usdcPerTEth - 1) * 100;
  if (usdcPerTEth <= lowEdge || usdcPerTEth >= highEdge) {
    warnings.push("Pool price is OUTSIDE the concentrated range; trades will not execute. Run `npm run pool:recenter -- --execute`.");
  } else {
    if (toLow < thresholdPct) warnings.push(`Pool price is only ${toLow.toFixed(2)}% above the lower range edge ($${lowEdge.toFixed(2)}). Run \`npm run pool:recenter -- --execute\`.`);
    if (toHigh < thresholdPct) warnings.push(`Pool price is only ${toHigh.toFixed(2)}% below the upper range edge ($${highEdge.toFixed(2)}). Run \`npm run pool:recenter -- --execute\`.`);
  }
  return warnings;
}
