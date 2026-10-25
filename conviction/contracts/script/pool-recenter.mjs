// Owns the single concentrated USDC/tETH position used by WavefundVault, held by the deployer-owned v4 callback.
//   npm run pool:recenter                 plan only (read-only)
//   npm run pool:recenter -- --execute    remove old position, align to the oracle, re-add at -10% / +20%
//   npm run pool:recenter -- --remove --execute   withdraw the position and return the USDC/tETH to the deployer
//   npm run pool:recenter -- --measure    report price impact for 0.5 / 1 / 2 USDC trades
import { decodeAbiParameters, encodeAbiParameters, encodeFunctionData } from "viem";
import {
  accountFor,
  assertArcTestnet,
  callbackAbi,
  chain,
  confirm,
  deployment,
  erc20Abi,
  explorerUrl,
  fetchCoinbasePrice,
  publicClient,
  usdc,
  usdcAbi,
  walletClientFor,
} from "./demo-round-common.mjs";
import {
  FEE,
  MAX_TICK,
  MIN_TICK,
  Q96,
  TICK_SPACING,
  amountsForLiquidity,
  callbackAddress,
  ceilDiv,
  liquidityForBuyImpact,
  poolKey,
  poolKeyType,
  readPool,
  readPositionLiquidity,
  readSavedPosition,
  savePosition,
  sqrt,
  sqrtPriceAtTick,
  tickForUsdcPerTEth,
  usdcPerTEthAtTick,
  warnNearEdge,
} from "./pool-lib.mjs";

const { contracts } = deployment;
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : Number(args[index + 1]);
};
const execute = flag("--execute");
const removeOnly = flag("--remove");
const measureOnly = flag("--measure");
const lowerPct = option("--lower", 10); // range below the oracle price (USDC per tETH)
const upperPct = option("--upper", 20); // range above the oracle price
const targetUsdc = option("--impact-usdc", 2);
const targetBps = option("--impact-bps", 200);
const maxUsdcBudget = BigInt(Math.round(option("--max-usdc", 11) * 1_000_000));
const alignToleranceBps = 20n;

await assertArcTestnet();
const deployerAddress = deployment.admin;
const priorPosition = readSavedPosition();

function usdcPerTEthToSqrtX96(priceUsdc6) {
  return sqrt((10n ** 18n * Q96 * Q96) / priceUsdc6);
}

function plannedRange(oracleUsdc) {
  const tickLower = Math.floor(tickForUsdcPerTEth(oracleUsdc * (1 + upperPct / 100)) / TICK_SPACING) * TICK_SPACING;
  const tickUpper = Math.ceil(tickForUsdcPerTEth(oracleUsdc * (1 - lowerPct / 100)) / TICK_SPACING) * TICK_SPACING;
  return { tickLower, tickUpper, sqrtLower: sqrtPriceAtTick(tickLower), sqrtUpper: sqrtPriceAtTick(tickUpper) };
}

// Exact single-range swap math (the whole trade stays inside the concentrated position).
function simulateBuy(L, s0, usdcIn) {
  const net = usdcIn * BigInt(1_000_000 - FEE) / 1_000_000n;
  const sNew = (L * Q96 * s0) / (L * Q96 + net * s0);
  return { out: (L * (s0 - sNew)) / Q96, sNew };
}

function simulateSell(L, s0, tEthIn) {
  const net = tEthIn * BigInt(1_000_000 - FEE) / 1_000_000n;
  const sNew = s0 + (net * Q96) / L;
  return { out: (L * Q96 * (sNew - s0)) / (s0 * sNew), sNew };
}

function priceFromSqrt(sqrtX96) {
  const value = Number(sqrtX96) / Number(Q96);
  return 1e12 / (value * value);
}

function measure(L, s0, oracleUsdc) {
  const spot = priceFromSqrt(s0);
  const rows = [];
  for (const size of [0.5, 1, 2]) {
    const usdcIn = BigInt(Math.round(size * 1_000_000));
    const buy = simulateBuy(L, s0, usdcIn);
    const buyExec = size / (Number(buy.out) / 1e18);
    rows.push({
      trade: `Buy tETH with ${size} USDC`,
      spotMove: `${((priceFromSqrt(buy.sNew) / spot - 1) * 100).toFixed(3)}%`,
      effective: `${((buyExec / spot - 1) * 100).toFixed(3)}%`,
    });
  }
  for (const size of [0.5, 1, 2]) {
    const tEthIn = BigInt(Math.round((size / oracleUsdc) * 1e18));
    const sell = simulateSell(L, s0, tEthIn);
    const sellExec = (Number(sell.out) / 1e6) / (Number(tEthIn) / 1e18);
    rows.push({
      trade: `Sell tETH worth ${size} USDC`,
      spotMove: `${((priceFromSqrt(sell.sNew) / spot - 1) * 100).toFixed(3)}%`,
      effective: `${((1 - sellExec / spot) * 100).toFixed(3)}%`,
    });
  }
  console.log("Price impact (spotMove = pool spot change; effective = execution price vs pre-trade spot incl. 0.30% fee):");
  console.table(rows);
}

async function fees() {
  const block = await publicClient.getBlock();
  return { maxFeePerGas: block.baseFeePerGas * 2n, maxPriorityFeePerGas: 1_000_000_000n };
}

async function callCallback(account, data) {
  const encoded = await publicClient.call({
    account,
    to: callbackAddress,
    data: encodeFunctionData({ abi: callbackAbi, functionName: "execute", args: [data] }),
  });
  if (!encoded.data || encoded.data === "0x") throw new Error("Callback simulation returned no data.");
  const result = decodeAbiParameters([{ type: "bytes" }], encoded.data)[0];
  return decodeAbiParameters([{ type: "int128" }, { type: "int128" }], result);
}

async function sendCallback(label, client, payload) {
  const hash = await client.sendTransaction({
    account: client.account,
    chain,
    to: callbackAddress,
    data: encodeFunctionData({ abi: callbackAbi, functionName: "execute", args: [payload] }),
    ...(await fees()),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  console.log(`${label}: ${explorerUrl}/tx/${hash}`);
  return hash;
}

async function approve(client, token, abi, amount, label) {
  const allowance = await publicClient.readContract({
    address: token, abi, functionName: "allowance", args: [client.account.address, callbackAddress],
  });
  if (allowance >= amount) return;
  const hash = await client.writeContract({
    account: client.account, chain, address: token, abi, functionName: "approve",
    args: [callbackAddress, amount], ...(await fees()),
  });
  await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  console.log(`${label} approval: ${explorerUrl}/tx/${hash}`);
}

const oracle = await fetchCoinbasePrice();
const oracleUsdc = Number(oracle.priceUsdc) / 1e6;
const pool = await readPool();
const fullRangeLiquidity = await readPositionLiquidity(MIN_TICK, MAX_TICK);
const existingLiquidity = priorPosition
  ? await readPositionLiquidity(priorPosition.tickLower, priorPosition.tickUpper)
  : 0n;
const deviationBps = Math.round(Math.abs(pool.usdcPerTEth / oracleUsdc - 1) * 10_000);

console.log(`Oracle (Coinbase): $${oracleUsdc.toFixed(2)}  |  pool spot: $${pool.usdcPerTEth.toFixed(2)} (${(deviationBps / 100).toFixed(2)}% off)`);
console.log(`Active liquidity ${pool.liquidity}; full-range dust ${fullRangeLiquidity}; managed position ${existingLiquidity}`);
for (const warning of warnNearEdge(priorPosition && existingLiquidity > 0n ? priorPosition : null, pool.usdcPerTEth)) {
  console.warn(`WARNING: ${warning}`);
}

if (measureOnly) {
  measure(pool.liquidity, pool.sqrtPriceX96, oracleUsdc);
  process.exit(0);
}

const oracleSqrt = usdcPerTEthToSqrtX96(oracle.priceUsdc);
const recovered = existingLiquidity > 0n
  ? amountsForLiquidity(
    existingLiquidity,
    pool.sqrtPriceX96,
    sqrtPriceAtTick(priorPosition.tickLower),
    sqrtPriceAtTick(priorPosition.tickUpper),
  )
  : { amount0: 0n, amount1: 0n };

if (removeOnly) {
  if (existingLiquidity === 0n) throw new Error("No managed concentrated position to remove.");
  console.log(`Remove plan: withdraw ~${usdc(recovered.amount0)} USDC and ~${usdc(recovered.amount1, 18)} tETH to the deployer.`);
  if (!execute) {
    console.log("Read-only. Re-run with --execute to withdraw.");
    process.exit(0);
  }
}

const range = plannedRange(oracleUsdc);
const totalTarget = liquidityForBuyImpact(oracleSqrt, BigInt(Math.round(targetUsdc * 1_000_000)), targetBps);
const newLiquidity = totalTarget > fullRangeLiquidity ? totalTarget - fullRangeLiquidity : 0n;
const needed = amountsForLiquidity(newLiquidity, oracleSqrt, range.sqrtLower, range.sqrtUpper);
const capUsdc = needed.amount0 * 1_005n / 1_000n + 1n;
const capTEth = needed.amount1 * 1_005n / 1_000n + 1n;

// Alignment swap uses only the full-range dust liquidity, so it is cheap after the managed position is removed.
let align = null;
if (BigInt(deviationBps) > alignToleranceBps && fullRangeLiquidity > 0n) {
  if (pool.sqrtPriceX96 > oracleSqrt) {
    // Pool tETH too cheap in USDC terms is sqrt price above target: USDC in lowers sqrt price.
    const amountIn = ceilDiv(fullRangeLiquidity * Q96 * (pool.sqrtPriceX96 - oracleSqrt), pool.sqrtPriceX96 * oracleSqrt);
    align = { zeroForOne: true, amountIn: amountIn * 1_100n / 1_000n + 1_000n, token: "USDC" };
  } else {
    const amountIn = ceilDiv(fullRangeLiquidity * (oracleSqrt - pool.sqrtPriceX96), Q96);
    align = { zeroForOne: false, amountIn: amountIn * 1_100n / 1_000n + 1_000n, token: "tETH" };
  }
}

if (!removeOnly) {
  console.log(`Range: -${lowerPct}% / +${upperPct}% of oracle => $${usdcPerTEthAtTick(range.tickUpper).toFixed(2)} .. $${usdcPerTEthAtTick(range.tickLower).toFixed(2)} (ticks ${range.tickLower}..${range.tickUpper})`);
  console.log(`Target depth: ${targetUsdc} USDC moves spot < ${targetBps / 100}%  =>  total liquidity ${totalTarget}`);
  console.log(`Position needs ${usdc(needed.amount0)} USDC + ${usdc(needed.amount1, 18)} tETH (caps ${usdc(capUsdc)} / ${usdc(capTEth, 18)})`);
  console.log(`Reused from the old position: ${usdc(recovered.amount0)} USDC + ${usdc(recovered.amount1, 18)} tETH`);
  if (align) console.log(`Alignment swap: up to ${usdc(align.amountIn, align.token === "USDC" ? 6 : 18)} ${align.token} (unused input is not taken)`);
  const [usdcBalance, tEthBalance] = await Promise.all([
    publicClient.readContract({ address: contracts.usdc, abi: usdcAbi, functionName: "balanceOf", args: [deployerAddress] }),
    publicClient.readContract({ address: contracts.testAsset, abi: erc20Abi, functionName: "balanceOf", args: [deployerAddress] }),
  ]);
  const freshUsdc = capUsdc > recovered.amount0 ? capUsdc - recovered.amount0 : 0n;
  console.log(`New USDC required from the deployer wallet: ${usdc(freshUsdc)} (budget ${usdc(maxUsdcBudget)}; balance ${usdc(usdcBalance)})`);
  if (capUsdc > maxUsdcBudget) throw new Error(`Position needs ${usdc(capUsdc)} USDC, above the ${usdc(maxUsdcBudget)} budget.`);
  if (usdcBalance + recovered.amount0 < capUsdc + (align?.token === "USDC" ? align.amountIn : 0n)) throw new Error("Deployer USDC is insufficient.");
  if (tEthBalance + recovered.amount1 < capTEth) throw new Error("Deployer tETH is insufficient.");
  measure(newLiquidity + fullRangeLiquidity, oracleSqrt, oracleUsdc);
  if (!execute) {
    console.log("Read-only plan complete. Re-run with --execute to send transactions.");
    process.exit(0);
  }
}

await confirm(removeOnly ? "Withdraw the managed USDC/tETH position." : "Remove, align and re-add the managed USDC/tETH position.", "RECENTER POOL");
const deployer = accountFor(process.env.DEPLOYER_PK, deployerAddress, "deployer");
const client = walletClientFor(deployer);
const owner = await publicClient.readContract({ address: callbackAddress, abi: callbackAbi, functionName: "owner" });
if (owner.toLowerCase() !== deployer.address.toLowerCase()) throw new Error("The deployer does not own the v4 callback.");

if (existingLiquidity > 0n) {
  const payload = encodeAbiParameters(
    [{ type: "uint8" }, poolKeyType, { type: "address" }, { type: "int24" }, { type: "int24" }, { type: "uint128" }],
    [2, poolKey, deployer.address, priorPosition.tickLower, priorPosition.tickUpper, existingLiquidity],
  );
  const [d0, d1] = await callCallback(deployer.address, payload);
  console.log(`Simulated removal returns ${usdc(d0)} USDC and ${usdc(d1, 18)} tETH`);
  await sendCallback("Remove managed position", client, payload);
  savePosition({ ...priorPosition, liquidity: "0", removedAt: new Date().toISOString() });
}
if (removeOnly) {
  console.log("Position removed.");
  process.exit(0);
}

if (align) {
  const token = align.zeroForOne ? contracts.usdc : contracts.testAsset;
  await approve(client, token, align.zeroForOne ? usdcAbi : erc20Abi, align.amountIn, `${align.token} (align)`);
  const sqrtLimit = align.zeroForOne ? oracleSqrt - 1n : oracleSqrt + 1n;
  const payload = encodeAbiParameters(
    [{ type: "uint8" }, poolKeyType, { type: "address" }, { type: "bool" }, { type: "int256" }, { type: "uint160" }],
    [1, poolKey, deployer.address, align.zeroForOne, align.amountIn, sqrtLimit],
  );
  await callCallback(deployer.address, payload);
  await sendCallback("Align pool to oracle", client, payload);
}

const aligned = await readPool();
const alignedBps = Math.round(Math.abs(aligned.usdcPerTEth / oracleUsdc - 1) * 10_000);
if (alignedBps > 50) throw new Error(`Pool is still ${alignedBps} bps from the oracle after alignment; position not added.`);
const finalNeeded = amountsForLiquidity(newLiquidity, aligned.sqrtPriceX96, range.sqrtLower, range.sqrtUpper);
const finalCapUsdc = finalNeeded.amount0 * 1_010n / 1_000n + 1n;
const finalCapTEth = finalNeeded.amount1 * 1_010n / 1_000n + 1n;
if (finalCapUsdc > maxUsdcBudget) throw new Error("Aligned position would exceed the USDC budget.");
await approve(client, contracts.usdc, usdcAbi, finalCapUsdc, "USDC (liquidity)");
await approve(client, contracts.testAsset, erc20Abi, finalCapTEth, "tETH (liquidity)");
const addPayload = encodeAbiParameters(
  [
    { type: "uint8" }, poolKeyType, { type: "address" }, { type: "int24" }, { type: "int24" },
    { type: "int256" }, { type: "uint256" }, { type: "uint256" },
  ],
  [0, poolKey, deployer.address, range.tickLower, range.tickUpper, newLiquidity, finalCapUsdc, finalCapTEth],
);
const [a0, a1] = await callCallback(deployer.address, addPayload);
console.log(`Simulated add costs ${usdc(-a0)} USDC and ${usdc(-a1, 18)} tETH`);
const hash = await sendCallback("Add concentrated position", client, addPayload);

const onChain = await readPositionLiquidity(range.tickLower, range.tickUpper);
if (onChain !== newLiquidity) throw new Error(`Position liquidity mismatch: ${onChain} vs ${newLiquidity}`);
savePosition({
  owner: callbackAddress,
  salt: "0x0",
  tickLower: range.tickLower,
  tickUpper: range.tickUpper,
  liquidity: newLiquidity.toString(),
  centerUsdcPerTEth: oracleUsdc,
  lowerPct,
  upperPct,
  addTx: hash,
  updatedAt: new Date().toISOString(),
});
const final = await readPool();
console.log(`Done. Pool spot $${final.usdcPerTEth.toFixed(2)}, active liquidity ${final.liquidity}`);
measure(final.liquidity, final.sqrtPriceX96, oracleUsdc);
