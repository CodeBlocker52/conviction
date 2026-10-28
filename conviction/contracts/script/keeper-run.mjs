// Keeper service: drives every round through its lifecycle automatically.
//
//   npm run keeper:run -- [--poll 15] [--open-every 60 --window 30 --horizon 300]
//
// While a round is active it runs the oracle watcher (60 s price updates). It then
//   (a) collapses as soon as trading ends,
//   (b) immediately runs the vault's trade (so evaluation measures a real period),
//   (c) reports and settles once the evaluation window ends,
//   (d) optionally opens the next round (--open-every <minutes> after the previous round settled).
// Every transaction is logged. Ctrl+C stops cleanly (finishes the current step, stops the watcher).
import { parseAbi } from "viem";
import {
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

const { contracts } = deployment;
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const pollSeconds = opt("poll", 15);
const openEveryMinutes = opt("open-every", 0);
const windowMinutes = opt("window", 30);
const horizonSeconds = opt("horizon", 300);
const TWAP_WINDOW = 60;

const vaultAbi = parseAbi([
  "function executeTrade(uint256,uint16)",
  "function reportReturn(uint256)",
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

  if (openEveryMinutes > 0 && Date.now() - lastSettledAt >= openEveryMinutes * 60_000) {
    const [seed, perProposal] = await Promise.all([
      publicClient.readContract({ address: contracts.quantumRound, abi: roundAbi, functionName: "protocolLiquiditySeed" }),
      publicClient.readContract({ address: contracts.quantumRound, abi: roundAbi, functionName: "initialLiquidityPerProposal" }),
    ]);
    if (seed < perProposal) {
      log(`Cannot open the next round: reserve ${usdc(seed)} USDC is below the ${usdc(perProposal)} USDC seed.`);
      lastSettledAt = Date.now();
      return;
    }
    const block = await publicClient.getBlock({ blockTag: "latest" });
    await tx(`Open round ${roundCount + 1n} (${windowMinutes} min window)`, contracts.quantumRound, roundAbi, "openRound", [
      block.timestamp + BigInt(windowMinutes * 60),
      BigInt(horizonSeconds),
      950_000_000_000_000_000n,
      1_050_000_000_000_000_000n,
      TWAP_WINDOW,
    ]);
    log("Round opened with the status-quo market only; proposers add theirs before the window closes.");
    lastSettledAt = Date.now();
  }
}

await assertArcTestnet();
log(`Keeper ${keeper.address} running on ${deployment.chainName}; poll ${pollSeconds}s${openEveryMinutes ? `, next round ${openEveryMinutes} min after settlement` : ""}.`);
while (!stopping) {
  try {
    await step();
    failures.clear();
  } catch (error) {
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
