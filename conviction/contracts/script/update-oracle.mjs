import { createPublicClient, createWalletClient, defineChain, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { openSync, readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rpcUrl = process.env.ARC_RPC_URL ?? process.env.ARC_TESTNET_RPC ?? "https://rpc.testnet.arc.io";
const oracleAddress = process.env.MOCK_PRICE_ORACLE_ADDRESS ?? "0xb064CeEd9E9a74FfAf89C6DeaDF902876e2e456d";
const keeperPrivateKey = process.env.KEEPER_PK;
const roundAddress = process.env.NEW_QUANTUM_ROUND_ADDRESS ?? "0x82a666Fc211c6A9a2509F941eA974AB0a7dDDb41";
const scriptPath = fileURLToPath(import.meta.url);
const processKey = `wavefund-oracle-arc-testnet-${oracleAddress?.toLowerCase() ?? "unset"}`;
const pidFile = `${tmpdir()}/${processKey}.pid`;
const logFile = `${tmpdir()}/${processKey}.log`;

if (!oracleAddress || !/^0x[0-9a-fA-F]{40}$/.test(oracleAddress)) {
  throw new Error("Set MOCK_PRICE_ORACLE_ADDRESS to the deployed oracle address.");
}
if (!keeperPrivateKey || !/^0x[0-9a-fA-F]{64}$/.test(keeperPrivateKey)) {
  throw new Error("Set KEEPER_PK to the keeper private key.");
}

const chain = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const account = privateKeyToAccount(keeperPrivateKey);
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
const roundAbi = parseAbi([
  "function roundCount() view returns (uint256)",
  "function rounds(uint256) view returns (uint256 id,uint64 tradingEnd,uint64 evaluationEnd,uint96 rMin,uint96 rMax,uint32 twapWindow,uint96 epsilon,uint256 proposalCount,uint256 winnerProposalId,bool collapsed,bool settled,int256 realisedReturn,uint256 totalDeposited,bool cancelled)",
]);

if ((await publicClient.getChainId()) !== chain.id) {
  throw new Error(`RPC is not Arc Testnet (chain ID ${chain.id}).`);
}

async function updatePriceOnce() {
  const response = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Coinbase price request failed: HTTP ${response.status}`);

  const { data } = await response.json();
  const priceUsd = data?.amount;
  if (typeof priceUsd !== "string" || !/^\d+(\.\d+)?$/.test(priceUsd)) {
    throw new Error("Coinbase returned an invalid ETH/USD price.");
  }

  const [whole, fraction = ""] = priceUsd.split(".");
  if (fraction.length > 8 && /[1-9]/.test(fraction.slice(8))) {
    throw new Error("ETH/USD quote exceeds the oracle's 8-decimal precision.");
  }
  const price = BigInt(whole) * 100_000_000n + BigInt(fraction.slice(0, 8).padEnd(8, "0"));
  if (price <= 0n) throw new Error("ETH/USD price must be positive.");

  const hash = await walletClient.writeContract({
    address: oracleAddress,
    abi: parseAbi(["function updatePrice(int256 price_)"]),
    functionName: "updatePrice",
    args: [price],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Oracle update reverted: ${hash}`);

  console.log(`ETH/USD: $${priceUsd}`);
  console.log(`Oracle update: ${hash}`);
}

async function hasOpenRound() {
  const roundCount = await publicClient.readContract({
    address: roundAddress,
    abi: roundAbi,
    functionName: "roundCount",
  });
  if (roundCount === 0n) return false;

  const round = await publicClient.readContract({
    address: roundAddress,
    abi: roundAbi,
    functionName: "rounds",
    args: [roundCount],
  });
  return round.id !== 0n && !round.settled && !round.cancelled;
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function watchOpenRound() {
  const abortController = new AbortController();
  process.once("SIGINT", () => abortController.abort());
  process.once("SIGTERM", () => abortController.abort());

  while (!abortController.signal.aborted) {
    if (await hasOpenRound()) {
      await updatePriceOnce();
    } else {
      console.log("No active round; oracle updates paused.");
    }
    if (!abortController.signal.aborted) {
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          abortController.signal.removeEventListener("abort", onAbort);
          resolve();
        }, 60_000);
        const onAbort = () => {
          clearTimeout(timeout);
          resolve();
        };
        abortController.signal.addEventListener("abort", onAbort, { once: true });
      });
    }
  }
}

function getManagedProcess() {
  if (!existsSync(pidFile)) return null;
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`Invalid oracle watcher PID file: ${pidFile}`);
  try {
    const command = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).trim();
    if (!command) return null;
    if (!command.includes(scriptPath) || !command.includes("--run-open-round-watch")) {
      throw new Error(`PID ${pid} is not the Wavefund oracle watcher; refusing to signal it.`);
    }
    return pid;
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && error.status !== 0) return null;
    throw error;
  }
}

const mode = process.argv[2];
if (mode === "start") {
  const existingPid = getManagedProcess();
  if (existingPid) {
    console.log(`Oracle watcher already running (PID ${existingPid}).`);
  } else {
    if (existsSync(pidFile)) unlinkSync(pidFile);

    const output = openSync(logFile, "a");
    const child = spawn(process.execPath, [scriptPath, "--run-open-round-watch"], {
      detached: true,
      stdio: ["ignore", output, output],
      env: process.env,
    });
    await once(child, "spawn");
    child.unref();
    writeFileSync(pidFile, `${child.pid}\n`, { flag: "wx" });
    console.log(`Oracle watcher started (PID ${child.pid}).`);
    console.log(`Log: ${logFile}`);
  }
} else if (mode === "stop") {
  const pid = getManagedProcess();
  if (!pid) {
    if (existsSync(pidFile)) unlinkSync(pidFile);
    console.log("Oracle watcher is not running.");
  } else {
    process.kill(pid, "SIGTERM");
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (!getManagedProcess()) {
        if (existsSync(pidFile)) unlinkSync(pidFile);
        console.log("Oracle watcher stopped.");
        break;
      }
      await sleep(100);
    }
    if (getManagedProcess()) throw new Error(`Oracle watcher PID ${pid} did not stop within 30 seconds.`);
  }
} else if (mode === "--run-open-round-watch") {
  await watchOpenRound();
} else if (mode === "watch") {
  await watchOpenRound();
} else {
  await updatePriceOnce();
}
