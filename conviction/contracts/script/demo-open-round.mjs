// Opens a status-quo-only Phase B round; legacy demo proposals require an explicit opt-in.
// Usage: npm run demo:open-round [-- --minutes 20] [-- --horizon 600] [-- --twap-window 300] [-- --test] [-- --with-demo-proposals] [-- --execute]
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
import { calculateRiskModel, fetchRecentEthCandles } from "../../agents/market-data.mjs";
import { readAgents } from "../../agents/config.mjs";
import { requiredProtocolSeed } from "../../agents/safety.mjs";
import { parseTwapWindowArg, resolveTwapWindow } from "./twap-window.mjs";
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
const withDemoProposals = args.includes("--with-demo-proposals");
const minutesIndex = args.indexOf("--minutes");
const horizonIndex = args.indexOf("--horizon");
const tradingMinutes = minutesIndex === -1
  ? Number(process.env.DEMO_TRADING_WINDOW_MINUTES ?? 15)
  : Number(args[minutesIndex + 1]);
if (!Number.isInteger(tradingMinutes) || tradingMinutes < 3 || tradingMinutes > 1_440) {
  throw new Error("Trading window must be between 3 and 1440 whole minutes.");
}
const horizonSeconds = horizonIndex === -1
  ? Number(process.env.DEMO_EVALUATION_WINDOW_SECONDS ?? 600)
  : Number(args[horizonIndex + 1]);
if (!Number.isInteger(horizonSeconds) || horizonSeconds < 60 || horizonSeconds > 86_400) {
  throw new Error("Evaluation window must be between 60 and 86400 whole seconds.");
}
const horizon = BigInt(horizonSeconds);
const TWAP_WINDOW = resolveTwapWindow(parseTwapWindowArg(args), tradingMinutes * 60);

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

const [bond, seed, perProposal, coinbase, candles, pool, keeperUsdc, legacyInfo] = await Promise.all([
  withDemoProposals
    ? read(contracts.quantumRound, roundAbi, "DEFAULT_BOND")
    : Promise.resolve(0n),
  read(contracts.quantumRound, roundAbi, "protocolLiquiditySeed"),
  read(contracts.quantumRound, roundAbi, "initialLiquidityPerProposal"),
  fetchCoinbasePrice(),
  fetchRecentEthCandles(),
  readPool(),
  read(contracts.usdc, usdcAbi, "balanceOf", [keeperAddress]),
  withDemoProposals
    ? Promise.all([
      read(contracts.usdc, usdcAbi, "balanceOf", [deployerAddress]),
      read(contracts.proposerRegistry, registryAbi, "agents", [deployerAddress]),
      read(contracts.proposerRegistry, registryAbi, "agents", [keeperAddress]),
    ])
    : Promise.resolve([0n, null, null]),
]);
const [deployerUsdc, deployerAgent, keeperAgent] = legacyInfo;

const riskModel = calculateRiskModel(candles, horizonSeconds);
const spot = usdcPerTEthFromSqrt(pool.sqrtPriceX96);
const oracle = Number(coinbase.priceUsdc) / 1e6;
const deviationBps = Math.abs(spot / oracle - 1) * 10_000;
const saved = readSavedPosition();
const managedLiquidity = saved ? await readPositionLiquidity(saved.tickLower, saved.tickUpper) : 0n;
const edgeWarnings = warnNearEdge(managedLiquidity > 0n ? saved : null, spot);
const needed = liquidityForBuyImpact(pool.sqrtPriceX96, 2_000_000n, 200);
const proposerCount = readAgents().filter((agent) => agent.type === "proposer").length;
const marketsNeeded = requiredProtocolSeed(perProposal, proposerCount);
const keeperNeed = gasReserveUsdc + (withDemoProposals ? bond : 0n);
const deployerNeed = withDemoProposals ? bond * 2n + gasReserveUsdc : 0n;

console.log(`Phase B round plan (${testMode ? "TEST mode" : "demo mode"})`);
console.log(`Oracle (Coinbase): ${oracle.toFixed(2)} USDC/tETH | pool spot: ${spot.toFixed(2)} | deviation ${(deviationBps / 100).toFixed(2)}% (limit 0.50%)`);
console.log(`Evaluation horizon: ${horizon}s; recent ${riskModel.sampleCount}-return 1m volatility gives ±${(riskModel.bandBps / 100).toFixed(2)}% bounds (raw 3σ ${(riskModel.rawBandBps / 100).toFixed(2)}%).`);
console.log(`Pool active liquidity: ${pool.liquidity} (a 2 USDC trade moving price < 2% needs ${needed})`);
console.log(`Protocol seed: ${usdc(seed)} USDC; status quo plus three agent markets require ${usdc(marketsNeeded)} USDC; no seed top-up is authorized.`);
console.log(`Keeper gas reserve: ${usdc(keeperNeed)} USDC (has ${usdc(keeperUsdc)}).`);
if (withDemoProposals) {
  console.log(`Legacy demo proposers: deployer ${usdc(deployerNeed)} USDC (has ${usdc(deployerUsdc)}), keeper bond included.`);
}
for (const warning of edgeWarnings) console.warn(`WARNING: ${warning}`);

const blockers = [];
if (deviationBps > 50 && !testMode) {
  blockers.push(`Pool is ${(deviationBps / 100).toFixed(2)}% off the oracle price. Run \`npm run pool:recenter -- --execute\` first.`);
}
if (pool.liquidity < needed * 99n / 100n && !testMode) {
  blockers.push("Pool depth is below the 2% / 2 USDC target. Run `npm run pool:recenter -- --execute`.");
}
if (seed < marketsNeeded) blockers.push("Protocol seed is below the four-market requirement; no top-up is authorized.");
if (keeperUsdc < keeperNeed) blockers.push("Keeper USDC balance is too low.");
if (withDemoProposals && (!deployerAgent[2] || !keeperAgent[2])) blockers.push("Legacy demo mode requires active deployer and keeper proposers.");
if (withDemoProposals && deployerUsdc < deployerNeed) blockers.push("Deployer USDC balance is too low for legacy demo proposals.");
if (blockers.length > 0) throw new Error(`Preflight blocked:\n- ${blockers.join("\n- ")}`);

if (!execute) {
  console.log("Read-only preflight complete. Rerun with --execute to open the round.");
  process.exit(0);
}
await confirm(
  `Open a ${tradingMinutes}-minute Phase B round ${withDemoProposals ? "with legacy demo proposals" : "with status quo only"} and start the oracle watcher.`,
  "EXECUTE DEMO ROUND",
);

const keeper = accountFor(process.env.KEEPER_PK, keeperAddress, "keeper");
const deployer = withDemoProposals ? accountFor(process.env.DEPLOYER_PK, deployerAddress, "deployer") : null;
const keeperClient = walletClientFor(keeper);
const deployerClient = deployer ? walletClientFor(deployer) : null;

if (withDemoProposals) {
  await ensureAllowance("Deployer bonds", deployerClient, contracts.usdc, deployer.address, contracts.proposerRegistry, bond * 2n, usdcAbi);
  await ensureAllowance("Keeper bond", keeperClient, contracts.usdc, keeper.address, contracts.proposerRegistry, bond, usdcAbi);
}

const block = await publicClient.getBlock({ blockTag: "latest" });
const tradingEnd = block.timestamp + BigInt(tradingMinutes * 60);
const roundId = roundCount + 1n;
await sendContract("Open Phase B round", keeperClient, contracts.quantumRound, roundAbi, "openRound", [
  tradingEnd,
  horizon,
  riskModel.rMin,
  riskModel.rMax,
  TWAP_WINDOW,
]);
if (withDemoProposals) {
  const proposals = [
    { client: deployerClient, label: "Legacy demo proposal 1 (20% tETH)", bps: 2_000, rationale: "Defensive test allocation at 20% tETH." },
    { client: keeperClient, label: "Legacy demo proposal 2 (50% tETH)", bps: 5_000, rationale: "Balanced test allocation at 50% tETH." },
    { client: deployerClient, label: "Legacy demo proposal 3 (80% tETH)", bps: 8_000, rationale: "Growth test allocation at 80% tETH." },
  ];
  for (const proposal of proposals) {
    await sendContract(proposal.label, proposal.client, contracts.quantumRound, roundAbi, "propose", [
      roundId,
      { tEthBps: proposal.bps },
      proposal.rationale,
    ]);
  }
}
startOracleWatcher();
console.log(`Round ${roundId} opened${withDemoProposals ? " with legacy demo proposals" : " with status quo only"}. Trading ends at ${new Date(Number(tradingEnd) * 1000).toISOString()} (TWAP window ${TWAP_WINDOW}s); the oracle watcher is running.`);
