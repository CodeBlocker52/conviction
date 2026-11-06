// Keeper service: drives every round through its lifecycle automatically.
//
//   npm run keeper:run -- [--poll 15] [--preset judge|full|demo3] [--open-every 60 --window 30 --horizon 600]
//
// While a round is active it runs the oracle watcher (60 s price updates). It then
//   (a) collapses as soon as trading ends,
//   (b) immediately runs the vault's trade (so evaluation measures a real period),
//   (c) reports and settles once the evaluation window ends,
//   (d) optionally opens the next round after settlement (--open-every <minutes>, or demo3's --open-every-seconds).
// Every transaction is logged. Ctrl+C stops cleanly (finishes the current step, stops the watcher).
import { closeSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { parseAbi } from "viem";
import {
  AlreadyDoneError,
  accountFor,
  assertArcTestnet,
  deployment,
  explorerUrl,
  fetchCoinbasePrice,
  publicClient,
  roundAbi,
  sendContract,
  startOracleWatcher,
  stopOracleWatcher,
  updateOracle,
  usdc,
  walletClientFor,
} from "./demo-round-common.mjs";
import { calculateRiskModel, fetchRecentEthCandles } from "../../agents/market-data.mjs";
import { readAgents } from "../../agents/config.mjs";
import { requiredProtocolSeed } from "../../agents/safety.mjs";
import { parseTwapWindowArg, resolveTwapWindow } from "./twap-window.mjs";
import { parsePresetArg } from "./presets.mjs";
import { resolveHorizonSeconds, resolveKeeperOpenIntervalSeconds, resolveTradingSeconds } from "./preset-timings.mjs";
import { KEEPER_LOCK_PATH } from "./round-open-guard.mjs";
import { agentRuntimeIsRunning } from "../../agents/runtime-lock.mjs";

const { contracts } = deployment;
const proposerCount = readAgents().filter((agent) => agent.type === "proposer").length;
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const preset = parsePresetArg(args);
const stopAfterRoundIndex = args.indexOf("--stop-after-round");
const stopAfterRound = stopAfterRoundIndex < 0 ? null : BigInt(args[stopAfterRoundIndex + 1]);
const pollSeconds = opt("poll", preset?.name === "demo3" ? 1 : 15);
// Explicit flags override the preset; without a preset the original defaults apply.
const openEverySeconds = resolveKeeperOpenIntervalSeconds({ args, preset });
const tradingSeconds = resolveTradingSeconds({ args, preset, defaultMinutes: 30, manualFlag: "window" });
const horizonSeconds = resolveHorizonSeconds({ args, preset });
if (!Number.isInteger(pollSeconds) || pollSeconds < 1 || pollSeconds > 300) {
  throw new Error("--poll must be a whole number between 1 and 300 seconds.");
}
const TWAP_WINDOW = resolveTwapWindow(parseTwapWindowArg(args) ?? preset?.twapWindow, tradingSeconds);

const vaultAbi = parseAbi([
  "function executeTrade(uint256,uint16)",
  "function reportReturn(uint256)",
  "error TradeAlreadyExecuted()",
  "error ReturnAlreadyReported()",
  "function roundState(uint256) view returns (uint256 startValueUsdc,uint256 tEthAtStart,uint256 usdcAtStart,uint256 startPriceUsdc,uint64 navTimestamp,bool executed,bool reported,bool cancelled)",
]);

const keeper = accountFor(process.env.KEEPER_PK, deployment.keeper, "keeper");
const keeperClient = walletClientFor(keeper);
const log = (message) => console.log(`${new Date().toISOString()}  ${message}`);

let stopping = false;
let watcherOn = false;
let lastSettledAt = Date.now();
const failures = new Map();

process.on("SIGINT", () => {
  if (stopping) process.exit(1);
  stopping = true;
  log("Ctrl+C received: finishing the current step, then stopping.");
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setWatcher(on) {
  if (on === watcherOn) return;
  try {
    if (on) startOracleWatcher();
    else stopOracleWatcher();
    watcherOn = on;
  } catch (error) {
    log(`Oracle watcher ${on ? "start" : "stop"} failed: ${error.message}`);
  }
}

async function tx(label, address, abi, functionName, argsList) {
  log(`-> ${label}`);
  const hash = await sendContract(label, keeperClient, address, abi, functionName, argsList);
  log(`   ${label}: ${explorerUrl}/tx/${hash}`);
  return hash;
}

async function readRound(id) {
  return publicClient.readContract({ address: contracts.quantumRound, abi: roundAbi, functionName: "rounds", args: [id] });
}

async function freshOracle() {
  const quote = await fetchCoinbasePrice();
  await updateOracle(keeperClient, quote.answer);
}

async function step() {
  const roundCount = await publicClient.readContract({ address: contracts.quantumRound, abi: roundAbi, functionName: "roundCount" });
  if (stopAfterRound !== null && roundCount >= stopAfterRound) {
    const target = await readRound(stopAfterRound);
    if (target[10] || target[13]) {
      log(`Round ${stopAfterRound} finished; stopping before opening another round.`);
      stopping = true;
      return;
    }
  }
  const now = BigInt((await publicClient.getBlock({ blockTag: "latest" })).timestamp);

  if (roundCount > 0n) {
    const round = await readRound(roundCount);
    const [, tradingEnd, evaluationEnd, , , , , , winnerId, collapsed, settled, , , cancelled] = round;

    if (!settled && !cancelled) {
      setWatcher(true);
      if (!collapsed) {
        if (now >= tradingEnd) {
          await tx(`Collapse round ${roundCount}`, contracts.quantumRound, roundAbi, "collapse", [roundCount]);
        }
        return;
      }
      const state = await publicClient.readContract({ address: contracts.vault, abi: vaultAbi, functionName: "roundState", args: [roundCount] });
      const [, , , , , executed, reported, vaultCancelled] = state;
      if (vaultCancelled) {
        log(`Round ${roundCount} was cancelled by the vault's slippage guard; deposits redeem at par.`);
        return;
      }
      if (!executed) {
        const winner = await publicClient.readContract({ address: contracts.quantumRound, abi: roundAbi, functionName: "proposals", args: [roundCount, winnerId] });
        log(`Round ${roundCount}: winner is proposal ${winnerId}${winner[6] ? " (status quo: the vault will not trade)" : ` (${winner[2]} bps tETH)`}`);
        await freshOracle();
        await tx(`Vault executes round ${roundCount}`, contracts.vault, vaultAbi, "executeTrade", [roundCount, Number(winner[2])]);
        return;
      }
      if (!reported && now >= evaluationEnd) {
        await freshOracle();
        await tx(`Vault reports and settles round ${roundCount}`, contracts.vault, vaultAbi, "reportReturn", [roundCount]);
        return;
      }
      return;
    }

    if (settled || cancelled) {
      if (watcherOn) {
        log(`Round ${roundCount} is ${cancelled ? "cancelled" : "settled"}; stopping the oracle watcher.`);
        lastSettledAt = Date.now();
        setWatcher(false);
      }
    }
  }

  if (openEverySeconds > 0 && Date.now() - lastSettledAt >= openEverySeconds * 1_000) {
    const [seed, perProposal] = await Promise.all([
      publicClient.readContract({ address: contracts.quantumRound, abi: roundAbi, functionName: "protocolLiquiditySeed" }),
      publicClient.readContract({ address: contracts.quantumRound, abi: roundAbi, functionName: "initialLiquidityPerProposal" }),
    ]);
    const requiredSeed = requiredProtocolSeed(perProposal, proposerCount);
    if (seed < requiredSeed) {
      log(`Cannot open the next round: reserve ${usdc(seed)} USDC is below the ${usdc(requiredSeed)} USDC required for status quo plus ${proposerCount} proposer markets; skipping this opening.`);
      lastSettledAt = Date.now();
      return;
    }
    const block = await publicClient.getBlock({ blockTag: "latest" });
    const riskModel = calculateRiskModel(await fetchRecentEthCandles(), horizonSeconds, {
      minimumHorizonSeconds: preset?.name === "demo3" ? 45 : 60,
    });
    log(
      `Opening with ${horizonSeconds}s evaluation horizon; recent ${riskModel.sampleCount}-return 1m volatility gives ±${(riskModel.bandBps / 100).toFixed(2)}% bounds (raw 3σ ${(riskModel.rawBandBps / 100).toFixed(2)}%).`,
    );
    await tx(`Open round ${roundCount + 1n} (${tradingSeconds}s window)`, contracts.quantumRound, roundAbi, "openRound", [
      block.timestamp + BigInt(tradingSeconds),
      BigInt(horizonSeconds),
      riskModel.rMin,
      riskModel.rMax,
      TWAP_WINDOW,
    ]);
    log("Round opened with the status-quo market only; proposers add theirs before the window closes.");
    lastSettledAt = Date.now();
  }
}

// Two keepers on one deployment race each other (round 13: both tried to collapse in the same second).
function acquireLock() {
  try {
    const pid = Number(readFileSync(KEEPER_LOCK_PATH, "utf8"));
    try {
      process.kill(pid, 0);
      throw new Error(`Another keeper (PID ${pid}) is already running; stop it first (lock ${KEEPER_LOCK_PATH}).`);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    rmSync(KEEPER_LOCK_PATH, { force: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const fd = openSync(KEEPER_LOCK_PATH, "wx", 0o600);
  writeSync(fd, String(process.pid));
  closeSync(fd);
}
acquireLock();
process.on("exit", () => rmSync(KEEPER_LOCK_PATH, { force: true }));

await assertArcTestnet();
log(`Keeper ${keeper.address} running on ${deployment.chainName}; poll ${pollSeconds}s${openEverySeconds ? `, next round ${openEverySeconds}s after settlement` : ""}.`);
if (!agentRuntimeIsRunning()) log("WARNING: No live agent runtime found. Start agents:run before the keeper so proposers can catch the next round.");
while (!stopping) {
  try {
    await step();
    failures.clear();
  } catch (error) {
    if (error instanceof AlreadyDoneError) {
      log(`${error.message}; re-reading state.`);
      await sleep(2_000);
      continue;
    }
    const key = String(error.shortMessage ?? error.message).split("\n")[0];
    const count = (failures.get(key) ?? 0) + 1;
    failures.set(key, count);
    log(`Step failed (${count}): ${key}`);
    if (count >= 5) {
      log("Same failure five times in a row: stopping so it can be investigated.");
      break;
    }
  }
  for (let waited = 0; waited < pollSeconds * 1000 && !stopping; waited += 500) await sleep(500);
}
setWatcher(false);
log("Keeper stopped.");
