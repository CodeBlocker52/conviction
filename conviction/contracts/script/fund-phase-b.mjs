import {
  accountFor,
  assertArcTestnet,
  deployment,
  ensureAllowance,
  explorerUrl,
  publicClient,
  sendContract,
  usdcAbi,
  walletClientFor,
} from "./demo-round-common.mjs";
import { parseAbi, parseUnits } from "viem";

// Funds the Phase B round seed and the vault bootstrap. Usage:
//   node --env-file=.env contracts/script/fund-phase-b.mjs --seed-usdc=20 --vault-usdc=5
// Requires NEW_QUANTUM_ROUND and NEW_VAULT in the environment.
const round = process.env.NEW_QUANTUM_ROUND;
const vault = process.env.NEW_VAULT;
const argument = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const seed = parseUnits(argument("seed-usdc") ?? "0", 6);
const vaultAmount = parseUnits(argument("vault-usdc") ?? "0", 6);
if (round?.toLowerCase() !== deployment.contracts.quantumRound.toLowerCase()
  || vault?.toLowerCase() !== deployment.contracts.vault.toLowerCase()) {
  throw new Error("Set NEW_QUANTUM_ROUND and NEW_VAULT.");
}
const account = accountFor(process.env.DEPLOYER_PK, deployment.admin, "deployer");
const walletClient = walletClientFor(account);
await assertArcTestnet();

const roundAbi = parseAbi([
  "function addProtocolLiquiditySeed(uint256)",
  "function protocolLiquiditySeed() view returns (uint256)",
]);
const vaultAbi = parseAbi(["function fundVault(uint256)"]);

const balance = await publicClient.readContract({
  address: deployment.contracts.usdc,
  abi: usdcAbi,
  functionName: "balanceOf",
  args: [account.address],
});
if (balance < seed + vaultAmount) throw new Error("Deployer USDC balance is too low.");
const existingSeed = await publicClient.readContract({
  address: round,
  abi: roundAbi,
  functionName: "protocolLiquiditySeed",
});
if (existingSeed !== 0n) throw new Error("New QuantumRound already has a reserve; refusing to fund it twice.");

if (seed > 0n) {
  await ensureAllowance("Round seed", walletClient, deployment.contracts.usdc, account.address, round, seed);
  await sendContract("Fund protocol reserve", walletClient, round, roundAbi, "addProtocolLiquiditySeed", [seed]);
}
if (vaultAmount > 0n) {
  await ensureAllowance("Vault bootstrap", walletClient, deployment.contracts.usdc, account.address, vault, vaultAmount);
  await sendContract("Fund vault", walletClient, vault, vaultAbi, "fundVault", [vaultAmount]);
}
console.log(
  "protocolLiquiditySeed:",
  await publicClient.readContract({ address: round, abi: roundAbi, functionName: "protocolLiquiditySeed" }),
);
