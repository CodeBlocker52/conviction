import { encodeAbiParameters, keccak256, toHex, type Address, type Hex } from "viem";
import { addresses, poolManagerAbi, publicClient } from "./contracts";

export const MIN_PROBABILITY = 0.01;
export const MAX_PROBABILITY = 0.99;
const Q96 = 2 ** 96;

export type PoolKeyTuple = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
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
} as const;

export function poolIdOf(key: PoolKeyTuple): Hex {
  return keccak256(encodeAbiParameters([poolKeyType], [key]));
}

async function extsload(slot: bigint) {
  return BigInt(await publicClient.readContract({
    address: addresses.poolManager,
    abi: poolManagerAbi,
    functionName: "extsload",
    args: [toHex(slot, { size: 32 })],
  }));
}

// Uniswap v4-core stores _pools at slot 6: slot0 at the base slot, liquidity three words later.
export async function readPoolState(key: PoolKeyTuple) {
  const base = BigInt(keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }],
    [poolIdOf(key), 6n],
  )));
  const [slot0, liquidityWord] = await Promise.all([extsload(base), extsload(base + 3n)]);
  return {
    sqrtPriceX96: slot0 & ((1n << 160n) - 1n),
    liquidity: liquidityWord & ((1n << 128n) - 1n),
  };
}

// The hook defines pLong as price/(1+price) when LONG is currency0, otherwise 1/(1+price).
export function probabilityFromSqrt(sqrtPriceX96: bigint, longIsCurrency0: boolean) {
  const sqrt = Number(sqrtPriceX96) / Q96;
  const price = sqrt * sqrt;
  return longIsCurrency0 ? price / (1 + price) : 1 / (1 + price);
}

// Single-range constant-liquidity step used only to preview pLong after a trade; the adapter's quote decides the amounts.
export function probabilityAfterSwap(params: {
  sqrtPriceX96: bigint;
  liquidity: bigint;
  fee: number;
  zeroForOne: boolean;
  amountIn: bigint;
  longIsCurrency0: boolean;
}) {
  const sqrt = Number(params.sqrtPriceX96) / Q96;
  const liquidity = Number(params.liquidity);
  if (liquidity === 0) return null;
  const netIn = Number(params.amountIn) * (1 - params.fee / 1_000_000);
  const nextSqrt = params.zeroForOne
    ? (liquidity * sqrt) / (liquidity + netIn * sqrt)
    : sqrt + netIn / liquidity;
  const price = nextSqrt * nextSqrt;
  return params.longIsCurrency0 ? price / (1 + price) : 1 / (1 + price);
}

export function outsideBounds(probability: number | null) {
  return probability !== null && (probability < MIN_PROBABILITY || probability > MAX_PROBABILITY);
}

export const BOUNDARY_MESSAGE =
  "This trade would push the market past the 0.01–0.99 probability boundary, where liquidity ends. Try a smaller amount.";
