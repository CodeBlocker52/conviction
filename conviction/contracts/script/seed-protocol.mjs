import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  parseAbi,
  parseUnits,
  stringToBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const rpcUrl = process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io";
const quantumRoundAddress = process.env.NEW_QUANTUM_ROUND_ADDRESS;
const vaultAddress = process.env.NEW_WAVEFUND_VAULT_ADDRESS;
const deployerPrivateKey = process.env.DEPLOYER_PK;
const usdcAddress = "0x3600000000000000000000000000000000000000";
const gasPrice = 25_000_000_000n;

if (!quantumRoundAddress || !/^0x[0-9a-fA-F]{40}$/.test(quantumRoundAddress)) {
  throw new Error("Set NEW_QUANTUM_ROUND_ADDRESS to the new QuantumRound address.");
}
if (!deployerPrivateKey || !/^0x[0-9a-fA-F]{64}$/.test(deployerPrivateKey)) {
  throw new Error("Set DEPLOYER_PK to the deployment admin private key.");
}

const vaultFundingArgument = process.argv.find((argument) => argument.startsWith("--vault-funding-usdc="));
const vaultFundingText = vaultFundingArgument?.slice("--vault-funding-usdc=".length) ?? "0";
if (!/^\d+(\.\d{1,6})?$/.test(vaultFundingText)) {
  throw new Error("Set --vault-funding-usdc to a non-negative USDC amount with up to 6 decimals.");
}
const vaultFundingAmount = parseUnits(vaultFundingText, 6);
if (vaultFundingAmount > 0n && (!vaultAddress || !/^0x[0-9a-fA-F]{40}$/.test(vaultAddress))) {
  throw new Error("Set NEW_WAVEFUND_VAULT_ADDRESS when funding the vault.");
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
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function setInitialLiquidityPerProposal(uint256 amount)",
  "function addProtocolLiquiditySeed(uint256 amount)",
]);
const vaultAbi = parseAbi([
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function fundVault(uint256 amount)",
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

const adminRole = `0x${"0".repeat(64)}`;
const keeperRole = keccak256(stringToBytes("KEEPER_ROLE"));
const [isAdmin, isKeeper] = await Promise.all([
  publicClient.readContract({
    address: roundAddress,
    abi: roundAbi,
    functionName: "hasRole",
    args: [adminRole, account.address],
  }),
  publicClient.readContract({
    address: roundAddress,
    abi: roundAbi,
    functionName: "hasRole",
    args: [keeperRole, account.address],
  }),
]);
if (!isAdmin || !isKeeper) throw new Error("DEPLOYER_PK must hold QuantumRound admin and keeper roles.");

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
if (seedAmount + vaultFundingAmount > balance) {
  throw new Error("USDC balance cannot cover the proposal seed and requested vault funding.");
}

if (vaultFundingAmount > 0n) {
  const vaultCode = await publicClient.getBytecode({ address: vaultAddress });
  if (!vaultCode || vaultCode === "0x") throw new Error("NEW_WAVEFUND_VAULT_ADDRESS has no deployed code.");

  const isVaultAdmin = await publicClient.readContract({
    address: vaultAddress,
    abi: vaultAbi,
    functionName: "hasRole",
    args: [adminRole, account.address],
  });
  if (!isVaultAdmin) throw new Error("DEPLOYER_PK must hold the WavefundVault admin role.");
}

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
let approvalResetHash;
if (allowance > 0n) {
  approvalResetHash = await walletClient.writeContract({
    address: usdcAddress,
    abi: usdcAbi,
    functionName: "approve",
    args: [roundAddress, 0n],
    gas: 100_000n,
    gasPrice,
  });
  await sendAndConfirm(approvalResetHash);
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

let vaultApprovalResetHash;
let vaultApprovalHash;
let vaultFundingHash;
if (vaultFundingAmount > 0n) {
  const vaultAllowance = await publicClient.readContract({
    address: usdcAddress,
    abi: usdcAbi,
    functionName: "allowance",
    args: [account.address, vaultAddress],
  });
  if (vaultAllowance > 0n) {
    vaultApprovalResetHash = await walletClient.writeContract({
      address: usdcAddress,
      abi: usdcAbi,
      functionName: "approve",
      args: [vaultAddress, 0n],
      gas: 100_000n,
      gasPrice,
    });
    await sendAndConfirm(vaultApprovalResetHash);
  }

  vaultApprovalHash = await walletClient.writeContract({
    address: usdcAddress,
    abi: usdcAbi,
    functionName: "approve",
    args: [vaultAddress, vaultFundingAmount],
    gas: 100_000n,
    gasPrice,
  });
  await sendAndConfirm(vaultApprovalHash);

  vaultFundingHash = await walletClient.writeContract({
    address: vaultAddress,
    abi: vaultAbi,
    functionName: "fundVault",
    args: [vaultFundingAmount],
    gas: 180_000n,
    gasPrice,
  });
  await sendAndConfirm(vaultFundingHash);
}

console.log(`Liquidity per proposal: ${liquidityPerProposal} USDC base units`);
console.log(`Protocol seed funded: ${seedAmount} USDC base units`);
if (approvalResetHash) console.log(`Seed approval reset: ${approvalResetHash}`);
console.log(`Approve: ${approvalHash}`);
console.log(`Seed: ${seedHash}`);
if (vaultFundingAmount > 0n) {
  console.log(`Vault funded: ${vaultFundingAmount} USDC base units`);
  if (vaultApprovalResetHash) console.log(`Vault approval reset: ${vaultApprovalResetHash}`);
  console.log(`Vault approve: ${vaultApprovalHash}`);
  console.log(`Vault funding: ${vaultFundingHash}`);
}
