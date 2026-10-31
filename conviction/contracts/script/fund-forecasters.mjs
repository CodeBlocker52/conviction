// Sends USDC from the deployer to the Quant and Guardian wallets, or with --group proposers to the proposer wallets (public addresses from agents/agents.json).
// Usage: node --env-file=.env contracts/script/fund-forecasters.mjs [--group forecasters|proposers] [--amount 1.25] [--execute]
import { readFileSync } from "node:fs";
import { parseAbi, parseUnits } from "viem";
import {
  accountFor,
  assertArcTestnet,
  deployment,
  publicClient,
  sendContract,
  usdc,
  usdcAbi,
  walletClientFor,
} from "./demo-round-common.mjs";

const MAX_PER_WALLET = parseUnits("1.25", 6);
const args = process.argv.slice(2);
const execute = args.includes("--execute");
const amountIndex = args.indexOf("--amount");
const amount = parseUnits(amountIndex >= 0 ? args[amountIndex + 1] : "1.25", 6);
if (amount === 0n || amount > MAX_PER_WALLET) throw new Error("Amount per wallet must be above 0 and at most 1.25 USDC.");

const transferAbi = parseAbi(["function transfer(address,uint256) returns (bool)"]);
const agents = JSON.parse(readFileSync(new URL("../../agents/agents.json", import.meta.url), "utf8")).agents;
const groupIndex = args.indexOf("--group");
const group = groupIndex >= 0 ? args[groupIndex + 1] : "forecasters";
if (!["forecasters", "proposers"].includes(group)) throw new Error("--group must be forecasters or proposers.");
const targets = agents.filter(({ type }) => type === group.slice(0, -1));
if (targets.length !== (group === "proposers" ? 3 : 2)) throw new Error(`Unexpected number of ${group} in agents.json.`);

await assertArcTestnet();
const deployer = accountFor(process.env.DEPLOYER_PK, deployment.admin, "deployer");
const wallet = walletClientFor(deployer);
const balanceOf = (address) => publicClient.readContract({ address: deployment.contracts.usdc, abi: usdcAbi, functionName: "balanceOf", args: [address] });
const deployerBalance = await balanceOf(deployer.address);
console.log(`Deployer ${usdc(deployerBalance)} USDC; sending ${usdc(amount)} to each of ${targets.map(({ name }) => name).join(", ")}.`);
for (const { name, address } of targets) console.log(`${name} ${address}: ${usdc(await balanceOf(address))} before.`);
if (!execute) {
  console.log("Dry run only. Rerun with --execute to send.");
  process.exit(0);
}
for (const { name, address } of targets) {
  await sendContract(`fund ${name}`, wallet, deployment.contracts.usdc, transferAbi, "transfer", [address, amount]);
  console.log(`${name} ${usdc(await balanceOf(address))} after.`);
}
