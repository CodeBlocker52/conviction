// One-off migration helper for the superseded Phase B contracts in current.json.
//
// A migration round lets vault shareholders exit through the vault's normal decision boundary:
//   open   : opens a status-quo-only round, the keeper deposits a small amount (so the winning seed
//            is released when it redeems), and each holder queues a withdrawal.
//   finish : executes the vault's decision (processing the queued withdrawals), reports, settles and redeems.
//
// Usage (from the repo root):
//   node --env-file=.env contracts/script/migrate-old-vault.mjs open   --keeper-wave 2.0374 --deployer-wave 3 --execute --yes
//   node --env-file=.env contracts/script/migrate-old-vault.mjs finish --execute --yes
// Without --execute it only prints the plan.
import { parseAbi, parseUnits } from "viem";
import {
  accountFor,
  assertArcTestnet,
  confirm,
  deployment,
  ensureAllowance,
  explorerUrl,
  fetchCoinbasePrice,
  publicClient,
  roundAbi,
  sendContract,
  startOracleWatcher,
  stopOracleWatcher,
  updateOracle,
  usdc,
  usdcAbi,
  walletClientFor,
  waitUntil,
} from "./demo-round-common.mjs";

const { contracts } = deployment;
const args = process.argv.slice(2);
const mode = args[0];
const execute = args.includes("--execute");
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const migrationAbi = parseAbi([
  "function deposit(uint256,uint256)",
  "function redeem(uint256)",
  "function settle(uint256,int256)",
  "function totalVaultUsdc() view returns (uint256)",
  "function totalVaultTEth() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function requestWithdraw(uint256)",
  "function queuedWithdrawalShares(address) view returns (uint256)",
  "function executeTrade(uint256,uint16)",
  "function reportReturn(uint256)",
  "function navPerShare() view returns (uint256)",
]);

const DEPOSIT = 100_000n; // 0.1 USDC from the keeper so the winning seed releases on redeem
const TRADING_SECONDS = 360n;
const HORIZON = 60n;
const TWAP_WINDOW = 60;

async function snapshot(label) {
  const [vaultUsdc, vaultTEth, supply, dep, kep, seed] = await Promise.all([
    publicClient.readContract({ address: contracts.vault, abi: migrationAbi, functionName: "totalVaultUsdc" }),
    publicClient.readContract({ address: contracts.vault, abi: migrationAbi, functionName: "totalVaultTEth" }),
    publicClient.readContract({ address: contracts.vault, abi: migrationAbi, functionName: "totalSupply" }),
    publicClient.readContract({ address: contracts.vault, abi: migrationAbi, functionName: "balanceOf", args: [deployment.admin] }),
    publicClient.readContract({ address: contracts.vault, abi: migrationAbi, functionName: "balanceOf", args: [deployment.keeper] }),
    publicClient.readContract({ address: contracts.quantumRound, abi: roundAbi, functionName: "protocolLiquiditySeed" }),
  ]);
  const wallets = await Promise.all(
    [deployment.admin, deployment.keeper].map((address) =>
      publicClient.readContract({ address: contracts.usdc, abi: usdcAbi, functionName: "balanceOf", args: [address] }),
    ),
  );
  console.log(
    `[${label}] vault ${usdc(vaultUsdc)} USDC + ${usdc(vaultTEth, 18)} tETH | WAVE supply ${usdc(supply, 18)} ` +
      `(deployer ${usdc(dep, 18)}, keeper ${usdc(kep, 18)}) | reserve ${usdc(seed)} USDC | ` +
      `wallets deployer ${usdc(wallets[0])}, keeper ${usdc(wallets[1])} USDC`,
  );
}

async function currentRound() {
  const roundCount = await publicClient.readContract({ address: contracts.quantumRound, abi: roundAbi, functionName: "roundCount" });
  const round = await publicClient.readContract({ address: contracts.quantumRound, abi: roundAbi, functionName: "rounds", args: [roundCount] });
  return { roundCount, round };
}

await assertArcTestnet();
if (mode !== "open" && mode !== "finish") throw new Error("Usage: migrate-old-vault.mjs <open|finish> [--execute --yes]");
await snapshot("before");
const deployer = execute ? accountFor(process.env.DEPLOYER_PK, deployment.admin, "deployer") : null;
const keeper = execute ? accountFor(process.env.KEEPER_PK, deployment.keeper, "keeper") : null;
const deployerClient = deployer ? walletClientFor(deployer) : null;
const keeperClient = keeper ? walletClientFor(keeper) : null;

if (mode === "open") {
  const keeperWave = parseUnits(opt("--keeper-wave") ?? "0", 18);
  const deployerWave = parseUnits(opt("--deployer-wave") ?? "0", 18);
  const { roundCount, round } = await currentRound();
  if (!round[10] && !round[13]) throw new Error(`Round ${roundCount} is still open; settle it first.`);
  const [vaultUsdc, vaultTEth, supply, quote] = await Promise.all([
    publicClient.readContract({ address: contracts.vault, abi: migrationAbi, functionName: "totalVaultUsdc" }),
    publicClient.readContract({ address: contracts.vault, abi: migrationAbi, functionName: "totalVaultTEth" }),
    publicClient.readContract({ address: contracts.vault, abi: migrationAbi, functionName: "totalSupply" }),
    fetchCoinbasePrice(),
  ]);
  const navUsdc = vaultUsdc + (vaultTEth * quote.priceUsdc) / 10n ** 18n;
  const payout = ((keeperWave + deployerWave) * navUsdc) / supply;
  console.log(`Plan: round ${roundCount + 1n}: keeper deposit ${usdc(DEPOSIT)} USDC; queue withdrawals keeper ${usdc(keeperWave, 18)} + deployer ${usdc(deployerWave, 18)} WAVE`);
  console.log(`Estimated payout ${usdc(payout)} USDC against ${usdc(vaultUsdc)} USDC liquid (the vault cannot pay a shortfall from tETH).`);
  if (payout > vaultUsdc) throw new Error("Queued withdrawals exceed the vault's liquid USDC; reduce them.");
  if (!execute) process.exit(0);
  await confirm("Open the migration round and queue the withdrawals.", "OPEN MIGRATION ROUND");

  const block = await publicClient.getBlock({ blockTag: "latest" });
  const tradingEnd = block.timestamp + TRADING_SECONDS;
  const roundId = roundCount + 1n;
  await sendContract("Open migration round", keeperClient, contracts.quantumRound, roundAbi, "openRound", [
    tradingEnd,
    HORIZON,
    950_000_000_000_000_000n,
    1_050_000_000_000_000_000n,
    TWAP_WINDOW,
  ]);
  await ensureAllowance("Keeper round deposit", keeperClient, contracts.usdc, keeper.address, contracts.quantumRound, DEPOSIT, usdcAbi);
  await sendContract("Keeper deposits 0.1 USDC into the round", keeperClient, contracts.quantumRound, migrationAbi, "deposit", [roundId, DEPOSIT]);
  if (keeperWave > 0n) {
    await sendContract("Keeper queues WAVE withdrawal", keeperClient, contracts.vault, migrationAbi, "requestWithdraw", [keeperWave]);
  }
  if (deployerWave > 0n) {
    await sendContract("Deployer queues WAVE withdrawal", deployerClient, contracts.vault, migrationAbi, "requestWithdraw", [deployerWave]);
  }
  startOracleWatcher();
  console.log(`Round ${roundId} open; trading ends ${new Date(Number(tradingEnd) * 1000).toISOString()}.`);
  await waitUntil(tradingEnd);
  await sendContract(`Collapse round ${roundId}`, keeperClient, contracts.quantumRound, roundAbi, "collapse", [roundId]);
  const collapsed = await currentRound();
  if (collapsed.round[13]) throw new Error("Round was cancelled at collapse; stop and report.");
  console.log(`Collapsed; winner proposal ${collapsed.round[8]}. Run pool:recenter, then "finish".`);
  await snapshot("after collapse");
}

if (mode === "finish") {
  const { roundCount, round } = await currentRound();
  if (!round[9]) throw new Error("Round is not collapsed.");
  if (round[13]) throw new Error("Round was cancelled; stop and report.");
  console.log(`Plan: executeTrade + reportReturn round ${roundCount}, settle, keeper redeems.`);
  if (!execute) process.exit(0);
  await confirm("Execute the vault decision (processes queued withdrawals).", "EXECUTE MIGRATION DECISION");

  const quote = await fetchCoinbasePrice();
  await updateOracle(keeperClient, quote.answer);
  await sendContract(`Vault executeTrade (round ${roundCount}, status quo)`, keeperClient, contracts.vault, migrationAbi, "executeTrade", [roundCount, 0]);
  const afterTrade = (await currentRound()).round;
  if (afterTrade[13]) throw new Error("Round cancelled by the vault guard; withdrawals were NOT processed. Stop and report.");
  await snapshot("after executeTrade");

  await waitUntil(afterTrade[2]);
  const settleQuote = await fetchCoinbasePrice();
  await updateOracle(keeperClient, settleQuote.answer);
  await sendContract(`Vault reportReturn (round ${roundCount})`, keeperClient, contracts.vault, migrationAbi, "reportReturn", [roundCount]);
  if (!(await currentRound()).round[10]) throw new Error("Round not settled after reportReturn.");
  await sendContract("Keeper redeems its 0.1 USDC deposit", keeperClient, contracts.quantumRound, migrationAbi, "redeem", [roundCount]);
  stopOracleWatcher();
  await snapshot("after redeem");
  console.log(`Explorer: ${explorerUrl}/address/${contracts.quantumRound}`);
}
