// Deliberate manipulation test for the Guardian. The deployer deposits 1 USDC, claims 1 credit in one
// proposal, then buys LONG with it at the start of the final TWAP window to push pLong up.
// Usage (after settlement: --redeem): node --env-file=.env contracts/script/demo-manipulate.mjs --proposal 2 [--at-seconds-before-end 45] [--execute]
// The strike is timed so its CONFIRMED transaction lands that many seconds before trading ends: the script
// submits early by the measured confirmation latency of the deposit/claim/nudge transactions (default 6 s).
import { parseAbi } from "viem";
import {
  accountFor,
  assertArcTestnet,
  deployment,
  ensureAllowance,
  publicClient,
  roundAbi,
  sendContract,
  usdc,
  waitUntil,
  walletClientFor,
} from "./demo-round-common.mjs";

const CREDITS = 1_000_000n;
const args = process.argv.slice(2);
const execute = args.includes("--execute");
const valueOf = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const redeemOnly = args.includes("--redeem");
const proposalId = BigInt(valueOf("--proposal", redeemOnly ? "0" : "-1"));
const strikeBefore = Number(valueOf("--at-seconds-before-end", valueOf("--strike-before", "55")));
// Optional early SHORT nudge so an agent opens a LONG position that it can later trim; the nudge plus the strike stay within 1 credit.
const nudgeCredits = BigInt(Math.round(Number(valueOf("--nudge", "0")) * 1e6));
const strikeCredits = CREDITS - nudgeCredits;
if (nudgeCredits < 0n || nudgeCredits >= CREDITS) throw new Error("--nudge must be between 0 and 1 credit.");
if (proposalId < 0n) throw new Error("Pass --proposal <id>.");
if (!Number.isInteger(strikeBefore) || strikeBefore < 5 || strikeBefore > 600) throw new Error("--at-seconds-before-end must be 5 to 600 seconds.");

const abi = parseAbi([
  "function deposit(uint256,uint256)",
  "function claimCredits(uint256,uint256,uint256)",
  "function buyLong(uint256,uint256,uint256,uint256)",
  "function buyShort(uint256,uint256,uint256,uint256)",
  "function redeem(uint256)",
]);
const balanceAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const marketAbi = parseAbi([
  "function probabilities(uint256,uint256) view returns (uint256,uint256)",
  "function quoteBuyLong(uint256,uint256,uint256) view returns (uint256)",
  "function quoteBuyShort(uint256,uint256,uint256) view returns (uint256)",
]);
const { quantumRound, market, usdc: usdcAddress } = deployment.contracts;

await assertArcTestnet();
const deployer = accountFor(process.env.DEPLOYER_PK, deployment.admin, "deployer");
const wallet = walletClientFor(deployer);
const roundId = await publicClient.readContract({ address: quantumRound, abi: roundAbi, functionName: "roundCount" });
const round = await publicClient.readContract({ address: quantumRound, abi: roundAbi, functionName: "rounds", args: [roundId] });
const tradingEnd = Number(round[1]);
if (redeemOnly) {
  const balance = () => publicClient.readContract({ address: usdcAddress, abi: balanceAbi, functionName: "balanceOf", args: [deployer.address] });
  const before = await balance();
  await sendContract("deployer redeem", wallet, quantumRound, abi, "redeem", [roundId]);
  console.log(`Deployer USDC ${usdc(before)} -> ${usdc(await balance())} after redeem.`);
  process.exit(0);
}
const pLong = async () => Number((await publicClient.readContract({ address: market, abi: marketAbi, functionName: "probabilities", args: [roundId, proposalId] }))[0]) / 1e18;
console.log(`Round ${roundId}, proposal ${proposalId}: pLong ${(await pLong()).toFixed(4)}; strike at ${new Date((tradingEnd - strikeBefore) * 1000).toISOString()}.`);
if (!execute) process.exit(0);

await ensureAllowance("manipulation deposit", wallet, usdcAddress, deployer.address, quantumRound, CREDITS);
await sendContract("manipulation deposit 1 USDC", wallet, quantumRound, abi, "deposit", [roundId, CREDITS]);
const latencyStart = Date.now();
await sendContract("manipulation claim 1 credit", wallet, quantumRound, abi, "claimCredits", [roundId, proposalId, CREDITS]);
const latencySeconds = Math.min(15, (Date.now() - latencyStart) / 1000);

if (nudgeCredits > 0n) {
  const nudgeBefore = await pLong();
  const nudgeQuote = await publicClient.readContract({ address: market, abi: marketAbi, functionName: "quoteBuyShort", args: [roundId, proposalId, nudgeCredits] });
  await sendContract("nudge buy SHORT", wallet, quantumRound, abi, "buyShort", [roundId, proposalId, nudgeCredits, (nudgeQuote * 9_950n) / 10_000n]);
  console.log(`Nudge: pLong ${nudgeBefore.toFixed(4)} -> ${(await pLong()).toFixed(4)} with ${usdc(nudgeCredits)} credits SHORT at ${new Date().toISOString()}.`);
}
// The claim above took `claimLatencySeconds`; the strike is submitted that much earlier so it CONFIRMS at the target time.
await waitUntil(BigInt(tradingEnd - strikeBefore - Math.ceil(latencySeconds)));
const before = await pLong();
const quoted = await publicClient.readContract({ address: market, abi: marketAbi, functionName: "quoteBuyLong", args: [roundId, proposalId, strikeCredits] });
const minOut = (quoted * 9_950n) / 10_000n;
const submittedAt = Date.now();
const strikeHash = await sendContract("manipulation strike buy LONG", wallet, quantumRound, abi, "buyLong", [roundId, proposalId, strikeCredits, minOut]);
const strikeReceipt = await publicClient.getTransactionReceipt({ hash: strikeHash });
const strikeBlock = await publicClient.getBlock({ blockNumber: strikeReceipt.blockNumber });
const after = await pLong();
console.log(`Manipulation: pLong ${before.toFixed(4)} -> ${after.toFixed(4)} (quoted ${quoted}, min ${minOut}). Deposit ${usdc(CREDITS)} USDC.`);
console.log(`Strike submitted ${new Date(submittedAt).toISOString()}; CONFIRMED in block ${strikeReceipt.blockNumber} at ${new Date(Number(strikeBlock.timestamp) * 1000).toISOString()}, ${tradingEnd - Number(strikeBlock.timestamp)} s before trading end (target ${strikeBefore} s).`);
