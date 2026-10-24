import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const rpcUrl = process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.io";
const explorerUrl = "https://explorer.testnet.arc.io";
const deployerPrivateKey = process.env.DEPLOYER_PK;
const keeperPrivateKey = process.env.KEEPER_PK;
const expectedDeployer = "0xDA026fbF1F9a98632F52AA23F92c0041d6Ef3ac2";
const expectedKeeper = "0xE7DD9a5fafa5739B466C61914311e39717f7192c";
const usdcAddress = "0x3600000000000000000000000000000000000000";
const registryAddress = "0x181E2AFEe1005fDd3D02BC293D99d72dAd69b346";
const quantumRoundAddress = "0x82a666Fc211c6A9a2509F941eA974AB0a7dDDb41";
const vaultAddress = "0xe4CEE84aBfaB433E11E0F6C3845901D3Fb58b84D";
const oracleAddress = "0xb064CeEd9E9a74FfAf89C6DeaDF902876e2e456d";
const marketAddress = "0xEC6d767c62029A2868E1475873D9C2aE172F72df";
const demoPath = resolve("contracts/deployments/demo-round.md");
const startedAt = new Date().toISOString();
let recordCreated = false;

const previousRecord = existsSync(demoPath) ? readFileSync(demoPath, "utf8").trimEnd() : "";
const previousRuns = previousRecord
  ? previousRecord.includes("\n## Attempt ")
    ? previousRecord
    : previousRecord.replace(/^# Arc Testnet Demo Round\s*/, "# Arc Testnet Demo Round\n\n## Attempt 1\n\n")
  : "";
const attemptNumber = (previousRuns.match(/^## Attempt \d+/gm) ?? []).length + 1;

if (!deployerPrivateKey || !/^0x[0-9a-fA-F]{64}$/.test(deployerPrivateKey)) {
  throw new Error("Set DEPLOYER_PK in the private .env file.");
}
if (!keeperPrivateKey || !/^0x[0-9a-fA-F]{64}$/.test(keeperPrivateKey)) {
  throw new Error("Set KEEPER_PK in the private .env file.");
}
const chain = defineChain({
  id: 5_042_002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const deployer = privateKeyToAccount(deployerPrivateKey);
const keeper = privateKeyToAccount(keeperPrivateKey);
if (deployer.address.toLowerCase() !== expectedDeployer.toLowerCase()) {
  throw new Error("DEPLOYER_PK does not match the configured Arc Testnet admin.");
}
if (keeper.address.toLowerCase() !== expectedKeeper.toLowerCase()) {
  throw new Error("KEEPER_PK does not match the configured Arc Testnet keeper.");
}

const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const deployerClient = createWalletClient({ account: deployer, chain, transport: http(rpcUrl) });
const keeperClient = createWalletClient({ account: keeper, chain, transport: http(rpcUrl) });
const usdcAbi = parseAbi([
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);
const registryAbi = parseAbi([
  "function agents(address) view returns (string name,address wallet,bool active,uint256 proposalCount,uint256 winCount,int256 cumulativeReturn)",
  "function registerAgent(string name)",
]);
const roundAbi = parseAbi([
  "function DEFAULT_BOND() view returns (uint256)",
  "function KEEPER_ROLE() view returns (bytes32)",
  "function roundCount() view returns (uint256)",
  "function deposits(uint256 roundId,address user) view returns (uint256)",
  "function protocolLiquiditySeed() view returns (uint256)",
  "function initialLiquidityPerProposal() view returns (uint256)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
  "function openRound(uint64 tradingEnd,uint64 horizon,uint96 rMin,uint96 rMax,uint32 twapWindow)",
  "function propose(uint256 roundId,(uint16 tEthBps) target,string rationaleURI)",
  "function deposit(uint256 roundId,uint256 amount)",
  "function claimCredits(uint256 roundId,uint256 proposalId,uint256 amount)",
  "function buyLong(uint256 roundId,uint256 proposalId,uint256 creditsIn,uint256 minLongOut)",
  "function buyShort(uint256 roundId,uint256 proposalId,uint256 creditsIn,uint256 minSetsOut)",
  "function collapse(uint256 roundId)",
  "function rounds(uint256 roundId) view returns (uint256 id,uint64 tradingEnd,uint64 evaluationEnd,uint96 rMin,uint96 rMax,uint32 twapWindow,uint96 epsilon,uint256 proposalCount,uint256 winnerProposalId,bool collapsed,bool settled,int256 realisedReturn,uint256 totalDeposited,bool cancelled)",
  "function proposals(uint256 roundId,uint256 proposalId) view returns (uint256 id,address proposer,uint16 tEthBps,string rationaleURI,uint256 bondAmount,bool bondRefunded,bool isStatusQuo)",
  "function redeem(uint256 roundId)",
]);
const vaultAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function totalVaultUsdc() view returns (uint256)",
  "function totalVaultTEth() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function spotPriceTEthInUsdc() view returns (uint256)",
  "function fundVault(uint256 amount)",
  "function executeTrade(uint256 roundId,uint16 winnerTEthBps)",
  "function reportReturn(uint256 roundId)",
]);
const oracleAbi = parseAbi(["function updatePrice(int256 price_)"]);
const marketAbi = parseAbi(["function spotPrice(uint256 roundId,uint256 proposalId) view returns (uint256)"]);
const txRows = [];

function updateRecord(status) {
  const rows = txRows.map(({ label, hash }) => hash
    ? `| ${label} | [${hash}](${explorerUrl}/tx/${hash}) | Confirmed |`
    : `| ${label} | — | On-chain read |`);
  const currentRun = [
      `## Attempt ${attemptNumber}`,
      "",
      `Status: ${status}`,
      `Started: ${startedAt}`,
      `Deployer: \`${deployer.address}\``,
      `Keeper: \`${keeper.address}\``,
      "",
      "This run uses the current QuantumRound and replacement share-enabled WavefundVault. The selected 7.5% tETH allocation is executed by WavefundVault against the v4 pool, not through the smoke-test callback.",
      "",
      "| Action | Transaction | Result |",
      "|---|---|---|",
      ...rows,
      "",
    ].join("\n");
  writeFileSync(demoPath, `${previousRuns ? `${previousRuns}\n\n` : "# Arc Testnet Demo Round\n\n"}${currentRun}`);
}

async function send(label, client, address, abi, functionName, args) {
  const hash = await client.writeContract({
    account: client.account,
    chain,
    address,
    abi,
    functionName,
    args,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  txRows.push({ label, hash });
  updateRecord("Running");
  console.log(`${label}: ${hash}`);
  return hash;
}

async function ensureAllowance(client, owner, spender, amount) {
  const current = await publicClient.readContract({
    address: usdcAddress,
    abi: usdcAbi,
    functionName: "allowance",
    args: [owner, spender],
  });
  if (current >= amount) return;
  if (current > 0n) await send("Reset USDC approval", client, usdcAddress, usdcAbi, "approve", [spender, 0n]);
  await send("Approve USDC", client, usdcAddress, usdcAbi, "approve", [spender, amount]);
}

async function registerIfNeeded(client, account, label) {
  const agent = await publicClient.readContract({
    address: registryAddress,
    abi: registryAbi,
    functionName: "agents",
    args: [account],
  });
  if (agent[1] === "0x0000000000000000000000000000000000000000") {
    await send(`Register ${label} proposer`, client, registryAddress, registryAbi, "registerAgent", [label]);
    return;
  }
  if (!agent[2]) throw new Error(`${label} proposer registration exists but is inactive.`);
}

async function waitUntil(timestamp) {
  while (true) {
    const block = await publicClient.getBlock({ blockTag: "latest" });
    if (block.timestamp >= timestamp) return;
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 1_000));
  }
}

async function updateOracle() {
  const response = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Coinbase price request failed: HTTP ${response.status}`);

  const { data } = await response.json();
  const quote = data?.amount;
  if (typeof quote !== "string" || !/^\d+(\.\d+)?$/.test(quote)) {
    throw new Error("Coinbase returned an invalid ETH/USD price.");
  }
  const [whole, fraction = ""] = quote.split(".");
  if (fraction.length > 8 && /[1-9]/.test(fraction.slice(8))) {
    throw new Error("ETH/USD quote exceeds oracle precision.");
  }
  const price = BigInt(whole) * 100_000_000n + BigInt(fraction.slice(0, 8).padEnd(8, "0"));
  await send("Keeper oracle price update", keeperClient, oracleAddress, oracleAbi, "updatePrice", [price]);
  return price / 100n;
}

async function main() {
  const chainId = await publicClient.getChainId();
  if (chainId !== chain.id) throw new Error(`RPC chain ID ${chainId} is not Arc Testnet.`);

  const roundCount = await publicClient.readContract({
    address: quantumRoundAddress,
    abi: roundAbi,
    functionName: "roundCount",
  });
  let priorCancelledRoundId = 0n;
  let priorDeployerDeposit = 0n;
  let priorKeeperDeposit = 0n;
  if (roundCount > 0n) {
    const priorRound = await publicClient.readContract({
      address: quantumRoundAddress,
      abi: roundAbi,
      functionName: "rounds",
      args: [roundCount],
    });
    if (!priorRound[10] || !priorRound[13]) {
      throw new Error(`Round ${roundCount} is not both settled and canceled; refusing to start another demo.`);
    }
    priorCancelledRoundId = roundCount;
    [priorDeployerDeposit, priorKeeperDeposit] = await Promise.all([
      publicClient.readContract({
        address: quantumRoundAddress,
        abi: roundAbi,
        functionName: "deposits",
        args: [roundCount, deployer.address],
      }),
      publicClient.readContract({
        address: quantumRoundAddress,
        abi: roundAbi,
        functionName: "deposits",
        args: [roundCount, keeper.address],
      }),
    ]);
  }

  const [keeperRole, bond, seed, perProposal, deployerBalance, keeperBalance, vaultSupply] = await Promise.all([
    publicClient.readContract({ address: quantumRoundAddress, abi: roundAbi, functionName: "KEEPER_ROLE" }),
    publicClient.readContract({ address: quantumRoundAddress, abi: roundAbi, functionName: "DEFAULT_BOND" }),
    publicClient.readContract({ address: quantumRoundAddress, abi: roundAbi, functionName: "protocolLiquiditySeed" }),
    publicClient.readContract({ address: quantumRoundAddress, abi: roundAbi, functionName: "initialLiquidityPerProposal" }),
    publicClient.readContract({ address: usdcAddress, abi: usdcAbi, functionName: "balanceOf", args: [deployer.address] }),
    publicClient.readContract({ address: usdcAddress, abi: usdcAbi, functionName: "balanceOf", args: [keeper.address] }),
    publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "totalSupply" }),
  ]);
  const [initialVaultUsdc, vaultTEth, deployerVaultShares, keeperVaultShares] = await Promise.all([
    publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "totalVaultUsdc" }),
    publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "totalVaultTEth" }),
    publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "balanceOf", args: [deployer.address] }),
    publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "balanceOf", args: [keeper.address] }),
  ]);
  const [keeperAuthorized, vaultCode, oracleCode] = await Promise.all([
    publicClient.readContract({
      address: quantumRoundAddress,
      abi: roundAbi,
      functionName: "hasRole",
      args: [keeperRole, keeper.address],
    }),
    publicClient.getBytecode({ address: vaultAddress }),
    publicClient.getBytecode({ address: oracleAddress }),
  ]);
  if (!keeperAuthorized) throw new Error("Configured keeper lacks KEEPER_ROLE on QuantumRound.");
  if (!vaultCode || vaultCode === "0x" || !oracleCode || oracleCode === "0x") {
    throw new Error("The current vault or oracle deployment has no code.");
  }
  if (vaultTEth !== 0n || vaultSupply !== deployerVaultShares || keeperVaultShares !== 0n) {
    throw new Error("The vault has tETH or shares outside the deployer; refusing to use investor funds for the demo.");
  }
  if (seed < perProposal * 4n) throw new Error("QuantumRound seed cannot fund the status quo and three proposals.");
  if (deployerBalance < 4_000_000n || keeperBalance < 2_500_000n) {
    throw new Error("Insufficient USDC for the planned bonds, deposits, vault bootstrap, and fees.");
  }
  const spotPrice = await publicClient.readContract({
    address: vaultAddress,
    abi: vaultAbi,
    functionName: "spotPriceTEthInUsdc",
  });
  const quoteResponse = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", {
    signal: AbortSignal.timeout(10_000),
  });
  if (!quoteResponse.ok) throw new Error(`Coinbase price request failed: HTTP ${quoteResponse.status}`);
  const { data: quoteData } = await quoteResponse.json();
  const quoteText = quoteData?.amount;
  if (typeof quoteText !== "string" || !/^\d+(\.\d+)?$/.test(quoteText)) {
    throw new Error("Coinbase returned an invalid ETH/USD price.");
  }
  const [quoteWhole, quoteFraction = ""] = quoteText.split(".");
  if (quoteFraction.length > 8 && /[1-9]/.test(quoteFraction.slice(8))) {
    throw new Error("ETH/USD quote exceeds oracle precision.");
  }
  const expectedPrice = (BigInt(quoteWhole) * 100_000_000n
    + BigInt(quoteFraction.slice(0, 8).padEnd(8, "0"))) / 100n;
  const priceDifference = spotPrice > expectedPrice ? spotPrice - expectedPrice : expectedPrice - spotPrice;
  if (expectedPrice === 0n || priceDifference * 10_000n / expectedPrice > 3_500n) {
    throw new Error("The v4 pool spot is more than 350 bps from Coinbase; refusing to open a round without enough slippage headroom.");
  }

  recordCreated = true;
  updateRecord("Starting");

  if (priorCancelledRoundId > 0n) {
    if (priorDeployerDeposit > 0n) {
      await send(`Deployer redeems canceled round ${priorCancelledRoundId}`, deployerClient, quantumRoundAddress, roundAbi, "redeem", [priorCancelledRoundId]);
    }
    if (priorKeeperDeposit > 0n) {
      await send(`Keeper redeems canceled round ${priorCancelledRoundId}`, keeperClient, quantumRoundAddress, roundAbi, "redeem", [priorCancelledRoundId]);
    }
  }

  const vaultBootstrap = initialVaultUsdc < 100_000n ? 100_000n - initialVaultUsdc : 0n;
  if (vaultBootstrap > 0n) {
    await ensureAllowance(deployerClient, deployer.address, vaultAddress, vaultBootstrap);
    await send(`Fund new vault with ${vaultBootstrap} USDC base units`, deployerClient, vaultAddress, vaultAbi, "fundVault", [vaultBootstrap]);
  }

  await registerIfNeeded(deployerClient, deployer.address, "Wavefund Deployer");
  await registerIfNeeded(keeperClient, keeper.address, "Wavefund Keeper");
  await ensureAllowance(deployerClient, deployer.address, registryAddress, bond * 2n);
  await ensureAllowance(keeperClient, keeper.address, registryAddress, bond);

  const latestBlock = await publicClient.getBlock({ blockTag: "latest" });
  const roundId = roundCount + 1n;
  const tradingEnd = latestBlock.timestamp + 180n;
  const horizon = 60n;
  const twapWindow = 60;
  await send("Open round", keeperClient, quantumRoundAddress, roundAbi, "openRound", [
    tradingEnd,
    horizon,
    950_000_000_000_000_000n,
    1_050_000_000_000_000_000n,
    twapWindow,
  ]);

  await send("Proposal 1 (deployer)", deployerClient, quantumRoundAddress, roundAbi, "propose", [
    roundId,
    { tEthBps: 750 },
    "demo-round: measured 7.5% tETH allocation through WavefundVault",
  ]);
  await send("Proposal 2 (keeper)", keeperClient, quantumRoundAddress, roundAbi, "propose", [
    roundId,
    { tEthBps: 2_500 },
    "demo-round: defensive 25% tETH and 75% USDC",
  ]);
  await send("Proposal 3 (deployer)", deployerClient, quantumRoundAddress, roundAbi, "propose", [
    roundId,
    { tEthBps: 5_000 },
    "demo-round: growth 50% tETH and 50% USDC",
  ]);

  const userDeposit = 1_500_000n;
  await ensureAllowance(deployerClient, deployer.address, quantumRoundAddress, userDeposit);
  await ensureAllowance(keeperClient, keeper.address, quantumRoundAddress, userDeposit);
  await send("Deployer round deposit (1.5 USDC)", deployerClient, quantumRoundAddress, roundAbi, "deposit", [roundId, userDeposit]);
  await send("Keeper round deposit (1.5 USDC)", keeperClient, quantumRoundAddress, roundAbi, "deposit", [roundId, userDeposit]);
  await send("Deployer claims 1 USDC credits on proposal 1", deployerClient, quantumRoundAddress, roundAbi, "claimCredits", [
    roundId,
    1n,
    1_000_000n,
  ]);
  await send("Keeper claims 0.5 USDC credits on proposal 1", keeperClient, quantumRoundAddress, roundAbi, "claimCredits", [
    roundId,
    1n,
    500_000n,
  ]);

  await waitUntil(tradingEnd - 20n);
  await send("Deployer buys LONG with 1 USDC credits", deployerClient, quantumRoundAddress, roundAbi, "buyLong", [
    roundId,
    1n,
    1_000_000n,
    1n,
  ]);
  await send("Keeper buys SHORT with 0.5 USDC credits", keeperClient, quantumRoundAddress, roundAbi, "buyShort", [
    roundId,
    1n,
    500_000n,
    500_000n,
  ]);

  await waitUntil(tradingEnd);
  await send("Collapse round", keeperClient, quantumRoundAddress, roundAbi, "collapse", [roundId]);
  const round = await publicClient.readContract({
    address: quantumRoundAddress,
    abi: roundAbi,
    functionName: "rounds",
    args: [roundId],
  });
  const winnerId = round[8];
  const winnerProposal = await publicClient.readContract({
    address: quantumRoundAddress,
    abi: roundAbi,
    functionName: "proposals",
    args: [roundId, winnerId],
  });
  const targetTEthBps = Number(winnerProposal[2]);
  const observedSpot = await publicClient.readContract({
    address: marketAddress,
    abi: marketAbi,
    functionName: "spotPrice",
    args: [roundId, 1n],
  });
  txRows.push({ label: `Winner observed: proposal ${winnerId}, ${targetTEthBps} bps tETH; proposal 1 spot ${observedSpot}`, hash: "" });
  updateRecord("Running");

  await updateOracle();
  await send("WavefundVault executes winner allocation", keeperClient, vaultAddress, vaultAbi, "executeTrade", [
    roundId,
    targetTEthBps,
  ]);

  await waitUntil(round[2]);
  await updateOracle();
  await send("WavefundVault marks NAV and Resolver settles round", keeperClient, vaultAddress, vaultAbi, "reportReturn", [roundId]);

  await send("Deployer redeems", deployerClient, quantumRoundAddress, roundAbi, "redeem", [roundId]);
  await send("Keeper redeems", keeperClient, quantumRoundAddress, roundAbi, "redeem", [roundId]);

  const finalRound = await publicClient.readContract({
    address: quantumRoundAddress,
    abi: roundAbi,
    functionName: "rounds",
    args: [roundId],
  });
  const finalVaultUsdc = await publicClient.readContract({
    address: vaultAddress,
    abi: vaultAbi,
    functionName: "totalVaultUsdc",
  });
  const vaultShares = await publicClient.readContract({
    address: vaultAddress,
    abi: vaultAbi,
    functionName: "totalSupply",
  });
  txRows.push({ label: `Final state: round ${roundId} settled=${finalRound[10]}, winner=${finalRound[8]}, vault USDC=${finalVaultUsdc}, WAVE supply=${vaultShares}`, hash: "" });
  updateRecord("Complete");
}

main().catch((error) => {
  if (recordCreated) updateRecord("Failed; inspect confirmed transactions before continuing.");
  console.error(error);
  process.exitCode = 1;
});
