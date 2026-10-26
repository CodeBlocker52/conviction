import { parseAbi } from "viem";
import {
  accountFor,
  assertArcTestnet,
  confirm,
  deployment,
  explorerUrl,
  fetchCoinbasePrice,
  publicClient,
  roundAbi,
  sendContract,
  stopOracleWatcher,
  updateOracle,
  usdc,
  vaultAbi,
  walletClientFor,
  waitUntil,
} from "./demo-round-common.mjs";

const { contracts } = deployment;
const args = process.argv.slice(2);
const execute = args.includes("--execute");
const keeper = execute
  ? accountFor(process.env.KEEPER_PK, deployment.keeper, "keeper")
  : null;
const keeperClient = keeper ? walletClientFor(keeper) : null;

async function main() {
  await assertArcTestnet();
  const roundCount = await publicClient.readContract({
    address: contracts.quantumRound,
    abi: roundAbi,
    functionName: "roundCount",
  });
  if (roundCount === 0n) throw new Error("No round has been opened.");

  let round = await publicClient.readContract({
    address: contracts.quantumRound,
    abi: roundAbi,
    functionName: "rounds",
    args: [roundCount],
  });
  if (round[13]) {
    console.log(`Round ${roundCount} was canceled; user deposits can be redeemed at par.`);
    if (execute) stopOracleWatcher();
    return;
  }
  if (round[10]) {
    console.log(`Round ${roundCount} is already settled.`);
    if (execute) stopOracleWatcher();
    return;
  }

  const block = await publicClient.getBlock({ blockTag: "latest" });
  const timeUntilCollapse = round[9] ? 0n : round[1] > block.timestamp ? round[1] - block.timestamp : 0n;
  const marketAbi = parseAbi(["function probabilities(uint256,uint256) view returns (uint256,uint256)"]);
  if (!round[9]) {
    for (let id = 0n; id < round[7]; id += 1n) {
      try {
        const [pLong] = await publicClient.readContract({ address: contracts.market, abi: marketAbi, functionName: "probabilities", args: [roundCount, id] });
        console.log(`Proposal ${id}: pLong ${(Number(pLong) / 1e16).toFixed(2)}%`);
      } catch {
        console.log(`Proposal ${id}: pLong unavailable`);
      }
    }
  }
  const keeperRole = await publicClient.readContract({
    address: contracts.quantumRound,
    abi: roundAbi,
    functionName: "KEEPER_ROLE",
  });
  const [coinbase, vaultUsdc, vaultTEth, keeperAuthorized] = await Promise.all([
    fetchCoinbasePrice(),
    publicClient.readContract({
      address: contracts.vault,
      abi: vaultAbi,
      functionName: "totalVaultUsdc",
    }),
    publicClient.readContract({
      address: contracts.vault,
      abi: vaultAbi,
      functionName: "totalVaultTEth",
    }),
    publicClient.readContract({
      address: contracts.vault,
      abi: vaultAbi,
      functionName: "hasRole",
      args: [keeperRole, deployment.keeper],
    }),
  ]);
  if (!keeperAuthorized) throw new Error("The configured keeper does not have KEEPER_ROLE on WavefundVault.");
  const currentTEthValue = vaultTEth * coinbase.priceUsdc / 10n ** 18n;
  const nav = vaultUsdc + currentTEthValue;
  console.log(`Round: ${roundCount}`);
  console.log(`Trading end: ${new Date(Number(round[1]) * 1_000).toISOString()}`);
  console.log(`Time until collapse is available: ${timeUntilCollapse} seconds`);
  console.log(`Fresh Coinbase ETH/USD quote: $${coinbase.quote}`);
  console.log(`Vault holdings: ${usdc(vaultUsdc)} USDC and ${usdc(vaultTEth, 18)} tETH`);
  console.log(`Oracle-marked vault NAV estimate: ${usdc(nav)} USDC`);

  if (!execute) {
    console.log("Read-only close preflight complete. Rerun with --execute to collapse and settle this round.");
    return;
  }

  try {
    await confirm(
      `The script will wait for the trading window, collapse round ${roundCount}, execute its winning vault allocation, wait through evaluation, and settle it.`,
      `CLOSE ROUND ${roundCount}`,
    );

    if (!round[9]) {
      await waitUntil(round[1]);
      await sendContract(
        `Collapse round ${roundCount}`,
        keeperClient,
        contracts.quantumRound,
        roundAbi,
        "collapse",
        [roundCount],
      );
      round = await publicClient.readContract({
        address: contracts.quantumRound,
        abi: roundAbi,
        functionName: "rounds",
        args: [roundCount],
      });
    }

    if (round[13]) {
      console.log(`Round ${roundCount} was canceled during collapse; deposits are redeemable at par.`);
      return;
    }
    const winnerId = round[8];
    const winner = await publicClient.readContract({
      address: contracts.quantumRound,
      abi: roundAbi,
      functionName: "proposals",
      args: [roundCount, winnerId],
    });
    const targetBps = Number(winner[2]);
    const [latestQuote, currentUsdc, currentTEth] = await Promise.all([
      fetchCoinbasePrice(),
      publicClient.readContract({
        address: contracts.vault,
        abi: vaultAbi,
        functionName: "totalVaultUsdc",
      }),
      publicClient.readContract({
        address: contracts.vault,
        abi: vaultAbi,
        functionName: "totalVaultTEth",
      }),
    ]);
    const currentValue = currentTEth * latestQuote.priceUsdc / 10n ** 18n;
    const totalValue = currentUsdc + currentValue;
    const targetTEthValue = totalValue * BigInt(targetBps) / 10_000n;
    const changeValue = targetTEthValue > currentValue
      ? targetTEthValue - currentValue
      : currentValue - targetTEthValue;
    const swapDirection = targetTEthValue > currentValue ? "USDC to tETH" : "tETH to USDC";
    const estimatedSwapAmount = targetTEthValue > currentValue
      ? changeValue
      : changeValue * 10n ** 18n / latestQuote.priceUsdc;
    console.log(`Winner: proposal ${winnerId}, ${targetBps / 100}% tETH (${winner[3]})`);
    console.log(`Estimated pre-trade NAV: ${usdc(totalValue)} USDC`);
    console.log(`Estimated vault rebalance: ${swapDirection}, about ${usdc(estimatedSwapAmount, swapDirection === "USDC to tETH" ? 6 : 18)} input units.`);

    await confirm(
      "The next transaction marks NAV and allows WavefundVault to trade the winner's allocation through the v4 pool; a 500 bps slippage breach cancels the round safely.",
      "EXECUTE WINNER ALLOCATION",
    );
    await updateOracle(keeperClient, latestQuote.answer);
    await sendContract(
      `WavefundVault executes proposal ${winnerId} (${targetBps} bps tETH)`,
      keeperClient,
      contracts.vault,
      vaultAbi,
      "executeTrade",
      [roundCount, targetBps],
    );
    round = await publicClient.readContract({
      address: contracts.quantumRound,
      abi: roundAbi,
      functionName: "rounds",
      args: [roundCount],
    });
    if (round[13]) {
      console.log(`Vault slippage protection canceled round ${roundCount}; deposits are redeemable at par.`);
      return;
    }

    await waitUntil(round[2]);
    const settlementQuote = await fetchCoinbasePrice();
    await updateOracle(keeperClient, settlementQuote.answer);
    await sendContract(
      `WavefundVault reports NAV and settles round ${roundCount}`,
      keeperClient,
      contracts.vault,
      vaultAbi,
      "reportReturn",
      [roundCount],
    );
    const settledRound = await publicClient.readContract({
      address: contracts.quantumRound,
      abi: roundAbi,
      functionName: "rounds",
      args: [roundCount],
    });
    if (!settledRound[10]) throw new Error(`Round ${roundCount} was not settled after reportReturn.`);
    console.log(`Round ${roundCount} settled with return ratio ${settledRound[11]}.`);
    console.log(`Explorer: ${explorerUrl}/address/${contracts.quantumRound}`);
  } finally {
    const finalRound = await publicClient.readContract({
      address: contracts.quantumRound,
      abi: roundAbi,
      functionName: "rounds",
      args: [roundCount],
    });
    if (finalRound[10] || finalRound[13]) stopOracleWatcher();
  }
}

await main();
