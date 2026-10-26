// Opens a Phase B round for live testing. Addresses come from deployments/current.json.
// Usage: npm run demo:open-round [-- --minutes 20] [-- --test] [-- --execute]
import {
  accountFor,
  assertArcTestnet,
  confirm,
  deployment,
  ensureAllowance,
  fetchCoinbasePrice,
  publicClient,
  registryAbi,
  roundAbi,
  sendContract,
  startOracleWatcher,
  usdc,
  usdcAbi,
  walletClientFor,
} from "./demo-round-common.mjs";
import {
  liquidityForBuyImpact,
  readPool,
  readPositionLiquidity,
  readSavedPosition,
  usdcPerTEthFromSqrt,
  warnNearEdge,
} from "./pool-lib.mjs";

const { contracts } = deployment;
const deployerAddress = deployment.admin;
const keeperAddress = deployment.keeper;
const gasReserveUsdc = 100_000n;
const args = process.argv.slice(2);
const execute = args.includes("--execute");
const testMode = args.includes("--test");
const minutesIndex = args.indexOf("--minutes");
const tradingMinutes = minutesIndex === -1
  ? Number(process.env.DEMO_TRADING_WINDOW_MINUTES ?? 15)
  : Number(args[minutesIndex + 1]);
if (!Number.isInteger(tradingMinutes) || tradingMinutes < 3 || tradingMinutes > 1_440) {
  throw new Error("Trading window must be between 3 and 1440 whole minutes.");
}
const horizon = BigInt(Number(process.env.DEMO_EVALUATION_WINDOW_SECONDS ?? 300));
if (horizon < 60n || horizon > 86_400n) throw new Error("Evaluation window must be between 60 and 86400 seconds.");
const TWAP_WINDOW = 60;

const read = (address, abi, functionName, fnArgs = []) =>
  publicClient.readContract({ address, abi, functionName, args: fnArgs });

await assertArcTestnet();

const roundCount = await read(contracts.quantumRound, roundAbi, "roundCount");
if (roundCount > 0n) {
  const previous = await read(contracts.quantumRound, roundAbi, "rounds", [roundCount]);
  if (!previous[10] && !previous[13]) {
    throw new Error(`Round ${roundCount} is not settled; run \`npm run demo:close-round -- --execute\` first.`);
  }
}

const [bond, seed, perProposal, coinbase, pool, deployerUsdc, keeperUsdc, deployerAgent, keeperAgent] = await Promise.all([
  read(contracts.quantumRound, roundAbi, "DEFAULT_BOND"),
  read(contracts.quantumRound, roundAbi, "protocolLiquiditySeed"),
  read(contracts.quantumRound, roundAbi, "initialLiquidityPerProposal"),
  fetchCoinbasePrice(),
  readPool(),
  read(contracts.usdc, usdcAbi, "balanceOf", [deployerAddress]),
  read(contracts.usdc, usdcAbi, "balanceOf", [keeperAddress]),
  read(contracts.proposerRegistry, registryAbi, "agents", [deployerAddress]),
  read(contracts.proposerRegistry, registryAbi, "agents", [keeperAddress]),
]);

const spot = usdcPerTEthFromSqrt(pool.sqrtPriceX96);
const oracle = Number(coinbase.priceUsdc) / 1e6;
const deviationBps = Math.abs(spot / oracle - 1) * 10_000;
const saved = readSavedPosition();
const managedLiquidity = saved ? await readPositionLiquidity(saved.tickLower, saved.tickUpper) : 0n;
const edgeWarnings = warnNearEdge(managedLiquidity > 0n ? saved : null, spot);
const needed = liquidityForBuyImpact(pool.sqrtPriceX96, 2_000_000n, 200);
const marketsNeeded = perProposal * 4n;
const seedDeficit = marketsNeeded > seed ? marketsNeeded - seed : 0n;
const keeperNeed = seedDeficit + bond + gasReserveUsdc;
const deployerNeed = bond * 2n + gasReserveUsdc;

console.log(`Phase B round plan (${testMode ? "TEST mode" : "demo mode"})`);
console.log(`Oracle (Coinbase): ${oracle.toFixed(2)} USDC/tETH | pool spot: ${spot.toFixed(2)} | deviation ${(deviationBps / 100).toFixed(2)}% (limit 0.50%)`);
console.log(`Pool active liquidity: ${pool.liquidity} (a 2 USDC trade moving price < 2% needs ${needed})`);
console.log(`Protocol seed: ${usdc(seed)} USDC; four markets need ${usdc(marketsNeeded)} USDC; keeper top-up ${usdc(seedDeficit)} USDC`);
console.log(`Bonds (refunded after collapse): deployer ${usdc(bond * 2n)} USDC, keeper ${usdc(bond)} USDC`);
console.log(`Needed: deployer ${usdc(deployerNeed)} USDC (has ${usdc(deployerUsdc)}), keeper ${usdc(keeperNeed)} USDC (has ${usdc(keeperUsdc)})`);
for (const warning of edgeWarnings) console.warn(`WARNING: ${warning}`);

const blockers = [];
if (deviationBps > 50 && !testMode) {
  blockers.push(`Pool is ${(deviationBps / 100).toFixed(2)}% off the oracle price. Run \`npm run pool:recenter -- --execute\` first.`);
}
if (pool.liquidity < needed * 99n / 100n && !testMode) {
  blockers.push("Pool depth is below the 2% / 2 USDC target. Run `npm run pool:recenter -- --execute`.");
}
if (!deployerAgent[2] || !keeperAgent[2]) blockers.push("Deployer and keeper must both be active proposers in ProposerRegistry.");
if (deployerUsdc < deployerNeed) blockers.push("Deployer USDC balance is too low.");
if (keeperUsdc < keeperNeed) blockers.push("Keeper USDC balance is too low.");
if (blockers.length > 0) throw new Error(`Preflight blocked:\n- ${blockers.join("\n- ")}`);

if (!execute) {
  console.log("Read-only preflight complete. Rerun with --execute to open the round.");
  process.exit(0);
}
await confirm(`Open a ${tradingMinutes}-minute Phase B round with three proposals and start the oracle watcher.`, "EXECUTE DEMO ROUND");

const deployer = accountFor(process.env.DEPLOYER_PK, deployerAddress, "deployer");
const keeper = accountFor(process.env.KEEPER_PK, keeperAddress, "keeper");
const deployerClient = walletClientFor(deployer);
const keeperClient = walletClientFor(keeper);

if (seedDeficit > 0n) {
  await ensureAllowance("Keeper seed top-up", keeperClient, contracts.usdc, keeper.address, contracts.quantumRound, seedDeficit, usdcAbi);
  await sendContract(`Keeper adds ${usdc(seedDeficit)} USDC protocol seed`, keeperClient, contracts.quantumRound, roundAbi, "addProtocolLiquiditySeed", [seedDeficit]);
}
await ensureAllowance("Deployer bonds", deployerClient, contracts.usdc, deployer.address, contracts.proposerRegistry, bond * 2n, usdcAbi);
await ensureAllowance("Keeper bond", keeperClient, contracts.usdc, keeper.address, contracts.proposerRegistry, bond, usdcAbi);

const block = await publicClient.getBlock({ blockTag: "latest" });
const tradingEnd = block.timestamp + BigInt(tradingMinutes * 60);
const roundId = roundCount + 1n;
await sendContract("Open Phase B round", keeperClient, contracts.quantumRound, roundAbi, "openRound", [
  tradingEnd,
  horizon,
  950_000_000_000_000_000n,
  1_050_000_000_000_000_000n,
  TWAP_WINDOW,
]);
const proposals = [
  { client: deployerClient, label: "Proposal 1 (deployer, 20% tETH)", bps: 2_000, rationale: "Defensive: cut ETH exposure to 20% and hold 80% USDC to limit drawdown while volatility is elevated." },
  { client: keeperClient, label: "Proposal 2 (keeper, 50% tETH)", bps: 5_000, rationale: "Balanced: rebalance to a 50/50 USDC and tETH split to participate in upside while keeping a stable reserve." },
  { client: deployerClient, label: "Proposal 3 (deployer, 80% tETH)", bps: 8_000, rationale: "Growth: raise ETH exposure to 80% to capture momentum, accepting higher volatility over the evaluation window." },
];
for (const proposal of proposals) {
  await sendContract(proposal.label, proposal.client, contracts.quantumRound, roundAbi, "propose", [roundId, { tEthBps: proposal.bps }, proposal.rationale]);
}

startOracleWatcher();
console.log(`Round ${roundId} opened. Trading ends at ${new Date(Number(tradingEnd) * 1000).toISOString()}; the oracle watcher is running.`);
