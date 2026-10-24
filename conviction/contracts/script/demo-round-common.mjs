import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const deployment = JSON.parse(
  readFileSync(new URL("../deployments/current.json", import.meta.url), "utf8"),
);
export const explorerUrl = deployment.explorerUrl;
export const rpcUrl = process.env.ARC_RPC_URL ?? deployment.rpcUrl;
export const chain = defineChain({
  id: deployment.chainId,
  name: deployment.chainName,
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
export const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

export const roundAbi = parseAbi([
  "function DEFAULT_BOND() view returns (uint256)",
  "function KEEPER_ROLE() view returns (bytes32)",
  "function roundCount() view returns (uint256)",
  "function rounds(uint256) view returns (uint256 id,uint64 tradingEnd,uint64 evaluationEnd,uint96 rMin,uint96 rMax,uint32 twapWindow,uint96 epsilon,uint256 proposalCount,uint256 winnerProposalId,bool collapsed,bool settled,int256 realisedReturn,uint256 totalDeposited,bool cancelled)",
  "function proposals(uint256,uint256) view returns (uint256 id,address proposer,uint16 tEthBps,string rationaleURI,uint256 bondAmount,bool bondRefunded,bool isStatusQuo)",
  "function protocolLiquiditySeed() view returns (uint256)",
  "function initialLiquidityPerProposal() view returns (uint256)",
  "function addProtocolLiquiditySeed(uint256)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function openRound(uint64,uint64,uint96,uint96,uint32)",
  "function propose(uint256,(uint16 tEthBps),string)",
  "function collapse(uint256)",
  "function roundEvaluationEnd(uint256) view returns (uint64)",
]);
export const vaultAbi = parseAbi([
  "function hasRole(bytes32,address) view returns (bool)",
  "function spotPriceTEthInUsdc() view returns (uint256)",
  "function totalVaultUsdc() view returns (uint256)",
  "function totalVaultTEth() view returns (uint256)",
  "function executeTrade(uint256,uint16)",
  "function reportReturn(uint256)",
]);
export const usdcAbi = parseAbi([
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);
export const erc20Abi = parseAbi([
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);
export const registryAbi = parseAbi([
  "function agents(address) view returns (string name,address wallet,bool active,uint256 proposalCount,uint256 winCount,int256 cumulativeReturn)",
]);
export const oracleAbi = parseAbi([
  "function latestPrice() view returns (int256 price_,uint8 priceDecimals,uint64 updatedAt)",
  "function updatePrice(int256)",
]);
export const callbackAbi = parseAbi([
  "function owner() view returns (address)",
  "function execute(bytes) returns (bytes result)",
]);
export const poolManagerAbi = parseAbi([
  "function extsload(bytes32) view returns (bytes32)",
]);

export function accountFor(privateKey, expectedAddress, label) {
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error(`Set ${label === "deployer" ? "DEPLOYER_PK" : "KEEPER_PK"} in the private .env file.`);
  }
  const account = privateKeyToAccount(privateKey);
  if (account.address.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error(`${label} private key does not match current.json.`);
  }
  return account;
}

export function walletClientFor(account) {
  return createWalletClient({ account, chain, transport: http(rpcUrl) });
}

export async function assertArcTestnet() {
  const chainId = await publicClient.getChainId();
  if (chainId !== deployment.chainId) {
    throw new Error(`RPC chain ID ${chainId} is not ${deployment.chainName} (${deployment.chainId}).`);
  }
}

export async function sendContract(label, walletClient, address, abi, functionName, args) {
  const hash = await walletClient.writeContract({
    account: walletClient.account,
    chain,
    address,
    abi,
    functionName,
    args,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  console.log(`${label}: ${explorerUrl}/tx/${hash}`);
  return hash;
}

export async function ensureAllowance(label, walletClient, token, owner, spender, amount, abi = usdcAbi) {
  const current = await publicClient.readContract({
    address: token,
    abi,
    functionName: "allowance",
    args: [owner, spender],
  });
  if (current >= amount) return;
  if (current > 0n) await sendContract(`${label} reset approval`, walletClient, token, abi, "approve", [spender, 0n]);
  await sendContract(`${label} approval`, walletClient, token, abi, "approve", [spender, amount]);
}

export async function fetchCoinbasePrice() {
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
    throw new Error("Coinbase quote exceeds the oracle's 8-decimal precision.");
  }
  const answer = BigInt(whole) * 100_000_000n + BigInt(fraction.slice(0, 8).padEnd(8, "0"));
  const priceUsdc = answer / 100n;
  if (priceUsdc <= 0n) throw new Error("Coinbase returned a nonpositive ETH/USD price.");
  return { quote, answer, priceUsdc };
}

export async function updateOracle(walletClient, answer) {
  return sendContract(
    "Keeper oracle price update",
    walletClient,
    deployment.contracts.priceOracle,
    oracleAbi,
    "updatePrice",
    [answer],
  );
}

export async function waitUntil(timestamp) {
  while (true) {
    const block = await publicClient.getBlock({ blockTag: "latest" });
    if (block.timestamp >= timestamp) return;
    const remainingMs = Number(timestamp - block.timestamp) * 1_000;
    await new Promise((resolve) => setTimeout(resolve, Math.min(remainingMs, 10_000)));
  }
}

export async function confirm(prompt, expectedText) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Execution requires an interactive terminal so the transaction plan can be confirmed.");
  }
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  let answer;
  try {
    answer = await terminal.question(`${prompt}\nType ${expectedText} to continue: `);
  } finally {
    terminal.close();
  }
  if (answer !== expectedText) throw new Error("Confirmation did not match; no next action was sent.");
}

export function startOracleWatcher() {
  runWatcherCommand("start");
}

export function stopOracleWatcher() {
  runWatcherCommand("stop");
}

function runWatcherCommand(mode) {
  const scriptPath = new URL("./update-oracle.mjs", import.meta.url);
  const result = spawnSync(process.execPath, [fileURLToPath(scriptPath), mode], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw new Error(`Could not ${mode} the oracle watcher: ${result.error.message}`, { cause: result.error });
  if (result.status !== 0) throw new Error(`Oracle watcher ${mode} exited with status ${result.status}.`);
}

export function usdc(value, decimals = 6) {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
