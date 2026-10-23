import { createPublicClient, createWalletClient, defineChain, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const rpcUrl = process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io";
const quantumRoundAddress = process.env.NEW_QUANTUM_ROUND_ADDRESS;
const deployerPrivateKey = process.env.DEPLOYER_PK;
const usdcAddress = "0x3600000000000000000000000000000000000000";
const gasPrice = 25_000_000_000n;

if (!quantumRoundAddress || !/^0x[0-9a-fA-F]{40}$/.test(quantumRoundAddress)) {
  throw new Error("Set NEW_QUANTUM_ROUND_ADDRESS to the new QuantumRound address.");
}
if (!deployerPrivateKey || !/^0x[0-9a-fA-F]{64}$/.test(deployerPrivateKey)) {
  throw new Error("Set DEPLOYER_PK to the deployment admin private key.");
}

const chain = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const account = privateKeyToAccount(deployerPrivateKey);
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

if ((await publicClient.getChainId()) !== chain.id) {
  throw new Error(`RPC is not Arc Testnet (chain ID ${chain.id}).`);
}

const roundAbi = parseAbi([
  "function MAX_PROPOSALS_PER_ROUND() view returns (uint256)",
  "function initialLiquidityPerProposal() view returns (uint256)",
  "function protocolLiquiditySeed() view returns (uint256)",
  "function setInitialLiquidityPerProposal(uint256 amount)",
  "function addProtocolLiquiditySeed(uint256 amount)",
]);
const usdcAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const roundAddress = quantumRoundAddress;

const seedAlreadyPresent = await publicClient.readContract({
  address: roundAddress,
  abi: roundAbi,
  functionName: "protocolLiquiditySeed",
});
if (seedAlreadyPresent !== 0n) throw new Error("Protocol seed is already present; refusing to seed twice.");

const balance = await publicClient.readContract({
  address: usdcAddress,
  abi: usdcAbi,
  functionName: "balanceOf",
  args: [account.address],
});
const proposalCap = await publicClient.readContract({
  address: roundAddress,
  abi: roundAbi,
  functionName: "MAX_PROPOSALS_PER_ROUND",
});
const seedBudget = (balance * 8_500n) / 10_000n;
const liquidityPerProposal = seedBudget / proposalCap;
const seedAmount = liquidityPerProposal * proposalCap;
if (liquidityPerProposal === 0n) throw new Error("USDC balance is too small to seed all proposal slots.");

const sendAndConfirm = async (hash) => {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Transaction reverted: ${hash}`);
};

const liquidityHash = await walletClient.writeContract({
  address: roundAddress,
  abi: roundAbi,
  functionName: "setInitialLiquidityPerProposal",
  args: [liquidityPerProposal],
  gas: 100_000n,
  gasPrice,
});
await sendAndConfirm(liquidityHash);

const allowance = await publicClient.readContract({
  address: usdcAddress,
  abi: usdcAbi,
  functionName: "allowance",
  args: [account.address, roundAddress],
});
if (allowance > 0n) {
  const resetHash = await walletClient.writeContract({
    address: usdcAddress,
    abi: usdcAbi,
    functionName: "approve",
    args: [roundAddress, 0n],
    gas: 100_000n,
    gasPrice,
  });
  await sendAndConfirm(resetHash);
}

const approvalHash = await walletClient.writeContract({
  address: usdcAddress,
  abi: usdcAbi,
  functionName: "approve",
  args: [roundAddress, seedAmount],
  gas: 100_000n,
  gasPrice,
});
await sendAndConfirm(approvalHash);

const seedHash = await walletClient.writeContract({
  address: roundAddress,
  abi: roundAbi,
  functionName: "addProtocolLiquiditySeed",
  args: [seedAmount],
  gas: 180_000n,
  gasPrice,
});
await sendAndConfirm(seedHash);

console.log(`Liquidity per proposal: ${liquidityPerProposal} USDC base units`);
console.log(`Protocol seed funded: ${seedAmount} USDC base units`);
console.log(`Approve: ${approvalHash}`);
console.log(`Seed: ${seedHash}`);
