import { parseAbi } from "viem";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { openSync, readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  accountFor,
  assertArcTestnet,
  deployment,
  explorerUrl,
  fetchCoinbasePrice,
  publicClient,
  sendContract,
  walletClientFor,
} from "./demo-round-common.mjs";

const oracleAddress = deployment.contracts.priceOracle;
const keeperPrivateKey = process.env.KEEPER_PK;
const roundAddress = deployment.contracts.quantumRound;
const scriptPath = fileURLToPath(import.meta.url);
const processKey = `wavefund-oracle-arc-testnet-${oracleAddress?.toLowerCase() ?? "unset"}`;
const pidFile = `${tmpdir()}/${processKey}.pid`;
const logFile = `${tmpdir()}/${processKey}.log`;

if (!oracleAddress || !/^0x[0-9a-fA-F]{40}$/.test(oracleAddress)) {
  throw new Error("Set MOCK_PRICE_ORACLE_ADDRESS to the deployed oracle address.");
}
const account = accountFor(keeperPrivateKey, deployment.keeper, "keeper");
const walletClient = walletClientFor(account);
const roundAbi = parseAbi([
  "function roundCount() view returns (uint256)",
  "function rounds(uint256) view returns (uint256 id,uint64 tradingEnd,uint64 evaluationEnd,uint96 rMin,uint96 rMax,uint32 twapWindow,uint96 epsilon,uint256 proposalCount,uint256 winnerProposalId,bool collapsed,bool settled,int256 realisedReturn,uint256 totalDeposited,bool cancelled)",
]);

await assertArcTestnet();

async function updatePriceOnce() {
  const { quote, answer } = await fetchCoinbasePrice();
  const hash = await sendContract(
    "Keeper oracle price update",
    walletClient,
    oracleAddress,
    parseAbi(["function updatePrice(int256 price_)"]),
    "updatePrice",
    [answer],
  );
  console.log(`ETH/USD: $${quote}`);
  console.log(`Oracle update: ${explorerUrl}/tx/${hash}`);
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
