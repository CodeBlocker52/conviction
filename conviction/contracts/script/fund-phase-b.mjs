import { createPublicClient, createWalletClient, defineChain, http, parseAbi, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Funds the Phase B round seed and the vault bootstrap. Usage:
//   node --env-file=.env contracts/script/fund-phase-b.mjs --seed-usdc=20 --vault-usdc=5
// Requires NEW_QUANTUM_ROUND and NEW_VAULT in the environment.
const rpcUrl = process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io";
const usdcAddress = "0x3600000000000000000000000000000000000000";
const round = process.env.NEW_QUANTUM_ROUND;
const vault = process.env.NEW_VAULT;
const argument = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const seed = parseUnits(argument("seed-usdc") ?? "0", 6);
const vaultAmount = parseUnits(argument("vault-usdc") ?? "0", 6);
if (!/^0x[0-9a-fA-F]{40}$/.test(round ?? "") || !/^0x[0-9a-fA-F]{40}$/.test(vault ?? "")) {
  throw new Error("Set NEW_QUANTUM_ROUND and NEW_VAULT.");
}
if (!/^0x[0-9a-fA-F]{64}$/.test(process.env.DEPLOYER_PK ?? "")) throw new Error("Set DEPLOYER_PK.");

const chain = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const account = privateKeyToAccount(process.env.DEPLOYER_PK);
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
if ((await publicClient.getChainId()) !== chain.id) throw new Error("RPC is not Arc Testnet.");

const usdcAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
const roundAbi = parseAbi([
  "function addProtocolLiquiditySeed(uint256)",
  "function protocolLiquiditySeed() view returns (uint256)",
]);
const vaultAbi = parseAbi(["function fundVault(uint256)"]);

const fees = { maxFeePerGas: 150_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n };
const hashes = {};
async function send(label, address, abi, functionName, args) {
  const hash = await walletClient.writeContract({ address, abi, functionName, args, ...fees });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  hashes[label] = hash;
  console.log(`${label}: ${hash}`);
}

const balance = await publicClient.readContract({ address: usdcAddress, abi: usdcAbi, functionName: "balanceOf", args: [account.address] });
if (balance < seed + vaultAmount) throw new Error("Deployer USDC balance is too low.");

if (seed > 0n) {
  await send("approve round seed", usdcAddress, usdcAbi, "approve", [round, seed]);
  await send("addProtocolLiquiditySeed", round, roundAbi, "addProtocolLiquiditySeed", [seed]);
}
if (vaultAmount > 0n) {
  await send("approve vault", usdcAddress, usdcAbi, "approve", [vault, vaultAmount]);
  await send("fundVault", vault, vaultAbi, "fundVault", [vaultAmount]);
}
console.log(
  "protocolLiquiditySeed:",
  await publicClient.readContract({ address: round, abi: roundAbi, functionName: "protocolLiquiditySeed" }),
);
