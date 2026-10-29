import { closeSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertArcTestnet,
  deployment,
  publicClient,
  roundAbi,
} from "../contracts/script/demo-round-common.mjs";
import { readAgents } from "./config.mjs";
import { writeAgentEvent } from "./logging.mjs";
import { nextAgentEvaluation } from "./scheduler.mjs";
import { createAgentSigner } from "./signers.mjs";
import { loadRuntimeState, saveRuntimeState } from "./runtime-state.mjs";
import { assertProposalCountWithinCap } from "./safety.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);
let execute = false;
let dryRunRequested = false;
let once = false;
let pollSeconds = 10;
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--execute") execute = true;
  else if (arg === "--dry-run") dryRunRequested = true;
  else if (arg === "--once") once = true;
  else if (arg === "--poll") {
    const value = args[index + 1];
    if (!value || !/^\d+$/.test(value)) throw new Error("--poll needs a whole-number seconds value.");
    pollSeconds = Number(value);
    index += 1;
  } else throw new Error(`Unsupported option: ${arg}.`);
}
const dryRun = !execute;
if (!Number.isInteger(pollSeconds) || pollSeconds < 1 || pollSeconds > 300) {
  throw new Error("--poll must be a whole number between 1 and 300 seconds.");
}
if (dryRunRequested && execute) throw new Error("Choose either --dry-run or --execute, not both.");
if (execute && process.env.AGENT_LIVE_TRANSACTIONS_APPROVED !== "true") {
  throw new Error("Agent transactions are disabled until AGENT_LIVE_TRANSACTIONS_APPROVED=true is explicitly approved.");
}

const log = (event) => writeAgentEvent(event);
const agents = readAgents();
const statePath = resolve(dirname(scriptPath), ".runtime-state.json");
const lockPath = resolve(dirname(scriptPath), ".runtime.lock");
const state = dryRun ? { version: 1, rounds: {} } : loadRuntimeState(statePath);
const signers = new Map();
if (execute) {
  for (const agent of agents) signers.set(agent.id, createAgentSigner(agent, process.env, log));
}

function saveState() {
  if (!dryRun) saveRuntimeState(state, statePath);
}

function safeErrorMessage(error) {
  let message = error instanceof Error ? error.message : "Unknown runtime error.";
  for (const key of [
    "CIRCLE_API_KEY",
    "CIRCLE_ENTITY_SECRET",
    "DEPLOYER_PK",
    "KEEPER_PK",
    ...Object.keys(process.env).filter((name) => name.endsWith("_PRIVATE_KEY")),
  ]) {
    const secret = process.env[key];
    if (secret) message = message.replaceAll(secret, "[redacted]");
  }
  return message;
}

async function observeRound() {
  const [roundCount, block] = await Promise.all([
    publicClient.readContract({
      address: deployment.contracts.quantumRound,
      abi: roundAbi,
      functionName: "roundCount",
    }),
    publicClient.getBlock({ blockTag: "latest" }),
  ]);
  if (roundCount === 0n) {
    log({ type: "idle", reason: "No round has been opened yet.", dryRun });
    return;
  }
  const result = await publicClient.readContract({
    address: deployment.contracts.quantumRound,
    abi: roundAbi,
    functionName: "rounds",
    args: [roundCount],
  });
  const round = {
    id: roundCount.toString(),
    tradingEnd: result[1],
    evaluationEnd: result[2],
    rMin: result[3],
    rMax: result[4],
    proposalCount: Number(result[7]),
    collapsed: result[9],
    settled: result[10],
    cancelled: result[13],
  };
  assertProposalCountWithinCap(round.proposalCount);
  if (round.settled || round.cancelled) {
    log({
      type: "round_closed",
      roundId: round.id,
      status: round.cancelled ? "cancelled" : "settled",
      dryRun,
    });
    return;
  }

  const chainTimestamp = Number(block.timestamp);
  const roundState = state.rounds[round.id] ?? {};
  let changed = false;
  for (const agent of agents) {
    const previous = roundState[agent.id] ?? {};
    const evaluation = nextAgentEvaluation(agent, round, chainTimestamp, previous);
    if (!evaluation) continue;

    roundState[agent.id] = evaluation.nextState;
    changed = true;
    log({
      type: "evaluation",
      roundId: round.id,
      agentId: agent.id,
      agentName: agent.name,
      agentType: agent.type,
      cadence: evaluation.cadence,
      intendedAction: agent.type === "proposer" ? "evaluate-and-propose" : "evaluate-markets",
      publicAddress: agent.address,
      status: agent.address ? "strategy_pending" : "wallet_not_provisioned",
      reason: "Decision strategies are deferred to Steps 3 and 4; no agent action is submitted in Step 2.",
      dryRun,
      signerBackend: execute ? (process.env.AGENT_SIGNER_BACKEND ?? "circle") : undefined,
    });
  }
  if (changed) {
    state.rounds[round.id] = roundState;
    saveState();
  }
}

async function main() {
  await assertArcTestnet();
  log({
    type: "runtime_started",
    chain: deployment.chainName,
    mode: dryRun ? "dry-run" : "execute",
    pollSeconds,
    configuredSigners: signers.size,
    agents: agents.map(({ id, name, type, address }) => ({ id, name, type, address })),
    signerBackend: execute ? (process.env.AGENT_SIGNER_BACKEND ?? "circle") : "not initialized in dry-run",
  });
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
    log({ type: "shutdown_requested", reason: "SIGINT; finishing the current read cycle." });
  });
  let failures = 0;
  const waitForNextCycle = async (durationMs) => {
    for (let remaining = durationMs; remaining > 0 && !stopping; remaining -= 500) {
      await new Promise((resolve_) => setTimeout(resolve_, Math.min(remaining, 500)));
    }
  };
  do {
    try {
      await observeRound();
      failures = 0;
    } catch (error) {
      failures += 1;
      const backoffSeconds = Math.min(pollSeconds * 2 ** (failures - 1), 120);
      log({ type: "runtime_error", error: safeErrorMessage(error), retryInSeconds: backoffSeconds, dryRun });
      if (once) throw error;
      await waitForNextCycle(backoffSeconds * 1_000);
      continue;
    }
    if (once) break;
    if (!stopping) await waitForNextCycle(pollSeconds * 1_000);
  } while (!stopping);
  log({ type: "runtime_stopped" });
}

try {
  let lockFd;
  try {
    if (execute) {
      try {
        lockFd = openSync(lockPath, "wx", 0o600);
      } catch (error) {
        if (error.code === "EEXIST") {
          throw new Error(`Another agent runtime holds ${lockPath}; verify it is stopped before removing a stale lock.`);
        }
        throw error;
      }
      writeFileSync(lockFd, String(process.pid), "utf8");
    }
    await main();
  } finally {
    if (lockFd !== undefined) {
      closeSync(lockFd);
      unlinkSync(lockPath);
    }
  }
} catch (error) {
  console.error(`Agent runtime failed: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
}
