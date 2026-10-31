// Adds USDC to QuantumRound.protocolLiquiditySeed from the deployer wallet.
// Usage: node --env-file=.env contracts/script/seed-top-up.mjs --amount 10 [--execute]
import { keccak256, parseAbi, parseUnits, stringToBytes } from "viem";
import {
  accountFor,
  assertArcTestnet,
  deployment,
  ensureAllowance,
  publicClient,
  sendContract,
  usdc,
  usdcAbi,
  walletClientFor,
} from "./demo-round-common.mjs";

const MAX_AMOUNT = parseUnits("10", 6);
const args = process.argv.slice(2);
const execute = args.includes("--execute");
const amountIndex = args.indexOf("--amount");
const amountText = amountIndex >= 0 ? args[amountIndex + 1] : undefined;
if (!amountText || !/^\d+(\.\d{1,6})?$/.test(amountText)) throw new Error("Pass --amount <USDC>, for example --amount 10.");
const amount = parseUnits(amountText, 6);
if (amount === 0n || amount > MAX_AMOUNT) throw new Error("Amount must be above 0 and at most 10 USDC.");

const abi = parseAbi([
  "function protocolLiquiditySeed() view returns (uint256)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function addProtocolLiquiditySeed(uint256)",
]);
const round = deployment.contracts.quantumRound;

await assertArcTestnet();
const deployer = accountFor(process.env.DEPLOYER_PK, deployment.admin, "deployer");
const wallet = walletClientFor(deployer);
const isKeeper = await publicClient.readContract({
  address: round,
  abi,
  functionName: "hasRole",
  args: [keccak256(stringToBytes("KEEPER_ROLE")), deployer.address],
});
if (!isKeeper) throw new Error("The deployer does not hold KEEPER_ROLE; addProtocolLiquiditySeed would revert.");

const [balance, before] = await Promise.all([
  publicClient.readContract({ address: deployment.contracts.usdc, abi: usdcAbi, functionName: "balanceOf", args: [deployer.address] }),
  publicClient.readContract({ address: round, abi, functionName: "protocolLiquiditySeed" }),
]);
console.log(`Deployer USDC ${usdc(balance)}; reserve before ${usdc(before)}; adding ${usdc(amount)}.`);
if (balance < amount + 200_000n) throw new Error("Deployer needs the amount plus about 0.2 USDC for gas.");
if (!execute) {
  console.log("Dry run only. Rerun with --execute to send.");
  process.exit(0);
}

await ensureAllowance("approve reserve top-up", wallet, deployment.contracts.usdc, deployer.address, round, amount);
await sendContract("add protocol liquidity seed", wallet, round, abi, "addProtocolLiquiditySeed", [amount]);
const after = await publicClient.readContract({ address: round, abi, functionName: "protocolLiquiditySeed" });
console.log(`Reserve after ${usdc(after)}.`);
if (after - before !== amount) throw new Error("Reserve change does not match the amount sent.");
