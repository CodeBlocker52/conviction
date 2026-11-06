// Read-only demo-day check. Sends no transactions.
//   npm run demo:preflight
import { deployment, fetchCoinbasePrice, oracleAbi, publicClient, roundAbi, usdc, usdcAbi } from "./demo-round-common.mjs";
import { readAgents } from "../../agents/config.mjs";
import { requiredProtocolSeed } from "../../agents/safety.mjs";
import { readPool, usdcPerTEthFromSqrt } from "./pool-lib.mjs";

// Conservative gas per round (USDC) from measured logs, and the balance each role must keep untouched.
export const PER_ROUND_GAS = { proposer: 0.15, quant: 0.1, guardian: 0.1 };
export const HEADROOM = { proposer: 1.5, forecaster: 2.1 };
const MAX_ORACLE_AGE_SECONDS = 300;
const MAX_POOL_DEVIATION = 0.005;

export function roundsAffordable(balanceUsdc, role, gasPerRound) {
  const headroom = role === "proposer" ? HEADROOM.proposer : HEADROOM.forecaster;
  return Math.max(0, Math.floor((balanceUsdc - headroom) / gasPerRound));
}

export async function readPreflightContracts(client, contracts, agents, admin, keeper) {
  const balances = [...agents.map((agent) => agent.address), admin, keeper].map((address) => ({
    address: contracts.usdc, abi: usdcAbi, functionName: "balanceOf", args: [address],
  }));
  const results = await client.multicall({
    contracts: [
      ...balances,
      { address: contracts.quantumRound, abi: roundAbi, functionName: "protocolLiquiditySeed" },
      { address: contracts.quantumRound, abi: roundAbi, functionName: "initialLiquidityPerProposal" },
      { address: contracts.quantumRound, abi: roundAbi, functionName: "roundCount" },
      { address: contracts.priceOracle, abi: oracleAbi, functionName: "latestPrice" },
    ],
    allowFailure: false,
    batchSize: 64_000,
  });
  const offset = balances.length;
  return {
    balances: results.slice(0, offset),
    reserve: results[offset],
    perProposal: results[offset + 1],
    count: results[offset + 2],
    oracle: results[offset + 3],
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { contracts } = deployment;
  const problems = [];
  const agents = readAgents();
  const data = await readPreflightContracts(publicClient, contracts, agents, deployment.admin, deployment.keeper);

  console.log("Agents (USDC balance, judge rounds affordable)");
  for (const [index, agent] of agents.entries()) {
    const role = agent.type === "proposer" ? "proposer" : "forecaster";
    const gas = agent.name === "Quant" ? PER_ROUND_GAS.quant : agent.name === "Guardian" ? PER_ROUND_GAS.guardian : PER_ROUND_GAS.proposer;
    const bal = Number(data.balances[index]) / 1e6;
    const rounds = roundsAffordable(bal, role, gas);
    console.log(`  ${agent.name.padEnd(15)} ${bal.toFixed(4).padStart(9)} USDC  ~${rounds} rounds`);
    if (rounds < 3) problems.push(`Top up ${agent.name} (only ~${rounds} rounds affordable).`);
  }

  const deployerBal = Number(data.balances[agents.length]) / 1e6;
  const keeperBal = Number(data.balances[agents.length + 1]) / 1e6;
  console.log(`Deployer ${deployerBal.toFixed(4)} USDC, keeper ${keeperBal.toFixed(4)} USDC`);
  if (keeperBal < 1) problems.push("Keeper balance is below 1 USDC; top it up for gas.");

  const { reserve, perProposal, count } = data;
  const proposerCount = agents.filter((agent) => agent.type === "proposer").length;
  const needed = requiredProtocolSeed(perProposal, proposerCount);
  console.log(`Protocol reserve ${usdc(reserve)} USDC; a round needs ${usdc(needed)} USDC`);
  if (reserve < needed) problems.push("Reserve is below one round's need: addProtocolLiquiditySeed from the deployer.");

  const [price, pool] = await Promise.all([
    fetchCoinbasePrice(),
    readPool(),
  ]);
  const oracle = Number(price.priceUsdc) / 1e6;
  const spot = usdcPerTEthFromSqrt(pool.sqrtPriceX96);
  const deviation = Math.abs(spot / oracle - 1);
  console.log(`Pool ${spot.toFixed(2)} vs Coinbase ${oracle.toFixed(2)}: ${(deviation * 100).toFixed(3)}% off`);
  if (deviation > MAX_POOL_DEVIATION) problems.push("Pool is more than 0.5% off: npm run pool:recenter -- --max-new-usdc 1 --execute --yes");

  const [, , updatedAt] = data.oracle;
  const block = await publicClient.getBlock();
  const age = Number(block.timestamp) - Number(updatedAt);
  console.log(`On-chain oracle age ${age}s (the keeper's watcher refreshes it every 60 s)`);
  if (age > MAX_ORACLE_AGE_SECONDS) problems.push("Oracle is stale: npm run oracle:update (or start keeper:run, which runs the watcher).");

  if (count > 0n) {
    const last = await publicClient.readContract({ address: contracts.quantumRound, abi: roundAbi, functionName: "rounds", args: [count] });
    if (!last[10] && !last[13]) {
      const message = `Round ${count} is still open; let keeper:run settle it first.`;
      if (process.argv.includes("--allow-open-round")) console.log(`WARNING: ${message}`);
      else problems.push(message);
    }
  }
  console.log(`ANTHROPIC_API_KEY set: ${process.env.ANTHROPIC_API_KEY ? "yes" : "no"}${process.env.ANTHROPIC_API_KEY ? "" : " (News will use its fallback)"}`);

  console.log(problems.length ? `\nNOT READY:\n- ${problems.join("\n- ")}` : "\nREADY");
  process.exitCode = problems.length ? 1 : 0;
}
