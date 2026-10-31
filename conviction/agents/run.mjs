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
import { setActiveGasRound, writeAgentEvent } from "./logging.mjs";
import {
  applySlippage,
  buildForecasterCalls,
  buildRedeemCall,
  guardianThreshold,
  planGuardianAction,
  planQuantAction,
  PER_PROPOSAL_CAP_CREDITS,
  prioritizeByProjectedTwap,
  tooCloseToTradingEnd,
  QUANT_THRESHOLD,
  quantFairProbability,
} from "./forecaster-strategies.mjs";
import { fetchRecentEthCandles } from "./market-data.mjs";
import {
  calculateMeanReversionProposal,
  calculateMomentumProposal,
  calculateNewsProposal,
  fetchCryptoHeadlines,
  MIN_PROPOSAL_GAP_BPS,
  resolveDistinctProposal,
} from "./proposer-strategies.mjs";
import { FINAL_WINDOW_INTERVAL_SECONDS, nextAgentEvaluation } from "./scheduler.mjs";
import { runIndependentLoops } from "./loops.mjs";
import { loadRuntimeState, saveRuntimeState } from "./runtime-state.mjs";
import { assertPrincipalWithinCap, assertProposalCountWithinCap } from "./safety.mjs";
import { parseAbi } from "viem";
import { createAgentSigner } from "./signers.mjs";

const marketAbi = parseAbi([
  "function probabilities(uint256,uint256) view returns (uint256 longProbability, uint256 shortProbability)",
  "function quoteBuyLong(uint256,uint256,uint256) view returns (uint256)",
  "function quoteBuyShort(uint256,uint256,uint256) view returns (uint256)",
  "function quoteSellLong(uint256,uint256,uint256) view returns (uint256 creditsOut, uint256 longDust, uint256 shortDust)",
  "function quoteSellShort(uint256,uint256,uint256) view returns (uint256 creditsOut, uint256 longDust, uint256 shortDust)",
  "function probabilityTwap(uint256,uint256,uint256,uint256) view returns (uint256)",
]);
const proposalTokensAbi = parseAbi([
  "function creditToken(uint256,uint256) view returns (address)",
  "function longToken(uint256,uint256) view returns (address)",
  "function shortToken(uint256,uint256) view returns (address)",
]);
const erc20BalanceAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

const quantumAbi = parseAbi([
  "function deposits(uint256,address) view returns (uint256)",
  "function creditsClaimed(uint256,uint256,address) view returns (uint256)",
  "function DEFAULT_BOND() view returns (uint256)",
  "function proposalTokens() view returns (address)",
]);
const registryAbi = parseAbi([
  "function agents(address) view returns (string name, address wallet, bool active, uint256 proposalCount, uint256 winCount, int256 cumulativeReturn)",
]);
const usdcAbi = parseAbi([
  "function allowance(address,address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);
const EXPLORER_TX = "https://explorer.testnet.arc.io/tx/";
const FORECASTER_DEPOSIT_USDC = 2_000_000n;

const jsonSafe = (value) => JSON.parse(JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item)));

const scriptPath = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);
let execute = false;
let dryRunRequested = false;
let once = false;
let agentFilter = null;
let pollSeconds = 10;
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--execute") execute = true;
  else if (arg === "--dry-run") dryRunRequested = true;
  else if (arg === "--once") once = true;
  else if (arg === "--agents") {
    const value = args[index + 1];
    if (!value) throw new Error("--agents needs a comma-separated list of agent names, proposers or forecasters.");
    agentFilter = value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
    index += 1;
  } else if (arg === "--poll") {
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

const log = (event) => writeAgentEvent(event);
const agents = readAgents().filter((agent) => !agentFilter
  || agentFilter.includes(agent.name.toLowerCase())
  || agentFilter.includes(`${agent.type}s`));
if (agents.length === 0) throw new Error("No configured agent matches --agents.");
const statePath = resolve(dirname(scriptPath), ".runtime-state.json");
const lockPath = resolve(dirname(scriptPath), ".runtime.lock");
const state = dryRun ? { version: 1, rounds: {} } : loadRuntimeState(statePath);

function saveState() {
  if (!dryRun) saveRuntimeState(state, statePath);
}

const signers = new Map();
const signerFor = (agent) => {
  if (!signers.has(agent.id)) signers.set(agent.id, createAgentSigner(agent, process.env, log));
  return signers.get(agent.id);
};

// Every on-chain failure is fatal: the runtime stops and reports instead of retrying in a loop.
async function submit(agent, call) {
  try {
    const result = await signerFor(agent).executeContractCall(call);
    const transaction = { label: call.label, hash: result.hash, explorerUrl: `${EXPLORER_TX}${result.hash}` };
    log({ type: "agent_transaction", agentId: agent.id, agentName: agent.name, ...transaction });
    return transaction;
  } catch (error) {
    const failure = new Error(`${agent.name} ${call.label} failed: ${safeErrorMessage(error)}`);
    failure.fatal = true;
    throw failure;
  }
}

const readAllowance = (owner, spender) => publicClient.readContract({
  address: deployment.contracts.usdc,
  abi: usdcAbi,
  functionName: "allowance",
  args: [owner, spender],
});

async function ensureApproval(agent, spender, amount, label) {
  const transactions = [];
  if ((await readAllowance(agent.address, spender)) < amount) {
    transactions.push(await submit(agent, {
      address: deployment.contracts.usdc,
      signature: "approve(address,uint256)",
      args: [spender, amount],
      label,
    }));
  }
  return transactions;
}

async function executeProposal({ agent, round, roundCount, resolved, existingProposals }) {
  const owner = agent.address.toLowerCase();
  if (existingProposals.some((proposal) => String(proposal[1]).toLowerCase() === owner)) {
    return { executed: false, note: "This agent already has a proposal in the round; not proposing again.", transactions: [] };
  }
  const transactions = [];
  const info = await publicClient.readContract({
    address: deployment.contracts.proposerRegistry,
    abi: registryAbi,
    functionName: "agents",
    args: [agent.address],
  });
  if (info[1] === "0x0000000000000000000000000000000000000000") {
    transactions.push(await submit(agent, {
      address: deployment.contracts.proposerRegistry,
      signature: "registerAgent(string)",
      args: [agent.name],
      label: "register proposer",
    }));
  } else if (!info[2]) {
    throw Object.assign(new Error(`${agent.name} is registered but deactivated.`), { fatal: true });
  }
  const bond = await publicClient.readContract({
    address: deployment.contracts.quantumRound,
    abi: quantumAbi,
    functionName: "DEFAULT_BOND",
  });
  assertPrincipalWithinCap("proposer", bond);
  transactions.push(...await ensureApproval(agent, deployment.contracts.proposerRegistry, bond, "approve bond"));
  transactions.push(await submit(agent, {
    address: deployment.contracts.quantumRound,
    signature: "propose(uint256,(uint16),string)",
    args: [roundCount, [resolved.tEthBps], resolved.rationale],
    label: `propose ${resolved.tEthBps} bps`,
  }));
  return { executed: true, transactions };
}

async function ensureForecasterDeposit(agent, roundCount) {
  const current = await publicClient.readContract({
    address: deployment.contracts.quantumRound,
    abi: quantumAbi,
    functionName: "deposits",
    args: [roundCount, agent.address],
  });
  if (current > 0n) return [];
  assertPrincipalWithinCap("forecaster", FORECASTER_DEPOSIT_USDC);
  const transactions = await ensureApproval(agent, deployment.contracts.quantumRound, FORECASTER_DEPOSIT_USDC, "approve deposit");
  transactions.push(await submit(agent, {
    address: deployment.contracts.quantumRound,
    signature: "deposit(uint256,uint256)",
    args: [roundCount, FORECASTER_DEPOSIT_USDC],
    label: "deposit 2 USDC",
  }));
  return transactions;
}

async function redeemForecasters({ round, roundCount, roundState }) {
  const redeemed = roundState.redeemed ??= {};
  for (const agent of agents.filter(({ type }) => type === "forecaster")) {
    if (redeemed[agent.id]) continue;
    const deposited = await publicClient.readContract({
      address: deployment.contracts.quantumRound,
      abi: quantumAbi,
      functionName: "deposits",
      args: [roundCount, agent.address],
    });
    if (deposited === 0n) {
      redeemed[agent.id] = true;
      continue;
    }
    const before = await publicClient.readContract({ address: deployment.contracts.usdc, abi: usdcAbi, functionName: "balanceOf", args: [agent.address] });
    const transaction = await submit(agent, buildRedeemCall({ roundContract: deployment.contracts.quantumRound, roundId: roundCount }));
    const after = await publicClient.readContract({ address: deployment.contracts.usdc, abi: usdcAbi, functionName: "balanceOf", args: [agent.address] });
    redeemed[agent.id] = true;
    state.rounds[round.id] = roundState;
    saveState();
    log(jsonSafe({
      type: "forecaster_redeem",
      roundId: round.id,
      agentId: agent.id,
      agentName: agent.name,
      deposited,
      usdcBalanceBefore: before,
      usdcBalanceAfter: after,
      transaction,
    }));
  }
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

async function observeRound({ agentFilter = () => true, handlesRedeem = true } = {}) {
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
  setActiveGasRound(roundCount);
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
    twapWindow: Number(result[5]),
    proposalCount: Number(result[7]),
    collapsed: result[9],
    settled: result[10],
    cancelled: result[13],
  };
  assertProposalCountWithinCap(round.proposalCount);
  if (round.settled || round.cancelled) {
    if (execute && round.settled && handlesRedeem) {
      const closedState = state.rounds[round.id] ??= {};
      await redeemForecasters({ round, roundCount, roundState: closedState });
      saveState();
    }
    log({
      type: "round_closed",
      roundId: round.id,
      status: round.cancelled ? "cancelled" : "settled",
      dryRun,
    });
    return;
  }

  const chainTimestamp = Number(block.timestamp);
  const roundState = state.rounds[round.id] ??= {};
  const existingProposals = await Promise.all(
    Array.from({ length: round.proposalCount }, (_, proposalIndex) =>
      publicClient.readContract({
        address: deployment.contracts.quantumRound,
        abi: roundAbi,
        functionName: "proposals",
        args: [roundCount, BigInt(proposalIndex)],
      }),
    ),
  );
  const consideredProposals = existingProposals.map((proposal, proposalIndex) => ({
    id: proposalIndex,
    tEthBps: Number(proposal[2]),
    source: proposal[6] ? "status-quo" : "on-chain",
  }));
  let changed = false;
  const evaluations = [];
  for (const agent of agents.filter(agentFilter)) {
    const previous = roundState[agent.id] ?? {};
    const evaluation = nextAgentEvaluation(agent, round, chainTimestamp, previous);
    if (!evaluation) continue;

    evaluations.push({ agent, evaluation });
  }

  const proposerEvaluations = evaluations.filter(({ agent }) => agent.type === "proposer");
  if (proposerEvaluations.length > 0) {
    const candles = await fetchRecentEthCandles();
    const momentumDecision = calculateMomentumProposal(candles);
    let headlines;
    let rssError;
    if (proposerEvaluations.some(({ agent }) => agent.name === "News")) {
      try {
        headlines = await fetchCryptoHeadlines();
      } catch (error) {
        headlines = [];
        rssError = safeErrorMessage(error);
      }
    }

    for (const { agent, evaluation } of proposerEvaluations) {
      let decision;
      if (agent.name === "Momentum") decision = momentumDecision;
      else if (agent.name === "Mean-reversion") decision = calculateMeanReversionProposal(candles);
      else if (agent.name === "News") {
        decision = await calculateNewsProposal({
          headlines,
          marketSignal: momentumDecision.signal,
          apiKey: rssError ? undefined : process.env.ANTHROPIC_API_KEY,
          unavailableReason: rssError ? `RSS unavailable: ${rssError}` : undefined,
        });
      } else {
        throw new Error(`No proposer strategy is configured for ${agent.name}.`);
      }
      const resolved = resolveDistinctProposal(decision, consideredProposals, MIN_PROPOSAL_GAP_BPS);
      let execution = { executed: false, transactions: [] };
      if (execute && !resolved.skip) {
        execution = await executeProposal({ agent, round, roundCount, resolved, existingProposals });
        if (execution.executed) {
          const count = Number(await publicClient.readContract({
            address: deployment.contracts.quantumRound, abi: roundAbi, functionName: "rounds", args: [roundCount],
          }).then((value) => value[7]));
          existingProposals.push(await publicClient.readContract({
            address: deployment.contracts.quantumRound, abi: roundAbi, functionName: "proposals", args: [roundCount, BigInt(count - 1)],
          }));
          execution.proposalId = count - 1;
        }
      }
      if (!resolved.skip) {
        consideredProposals.push({
          id: `dry-run-${agent.id}`,
          tEthBps: resolved.tEthBps,
          source: "earlier-dry-run-agent",
        });
      }
      log({
        type: "proposer_decision",
        roundId: round.id,
        agentId: agent.id,
        agentName: agent.name,
        publicAddress: agent.address,
        cadence: evaluation.cadence,
        rawTEthBps: resolved.rawTEthBps,
        tEthBps: resolved.tEthBps,
        shifted: resolved.shifted,
        shiftReason: resolved.reason,
        rationale: resolved.rationale,
        source: decision.source ?? "market-data",
        fallbackReason: decision.fallbackReason,
        signal: decision.signal,
        distinctCheck: {
          skip: resolved.skip,
          minGapBps: MIN_PROPOSAL_GAP_BPS,
          comparedAgainst: consideredProposals.filter((proposal) => proposal.id !== `dry-run-${agent.id}`)
            .map(({ id, source, tEthBps }) => ({ id, source, tEthBps })),
        },
        dryRun,
        submitted: execution.executed,
        proposalId: execution.proposalId,
        executionNote: execution.note,
        transactions: execution.transactions,
      });
      roundState[agent.id] = evaluation.nextState;
      state.rounds[round.id] = roundState;
      saveState();
      changed = true;
    }
  }

  const forecasterEvaluations = evaluations
    .filter(({ agent }) => agent.type === "forecaster")
    .sort((left, right) => Number(right.agent.name === "Quant") - Number(left.agent.name === "Quant"));
  if (forecasterEvaluations.length > 0) {
    await runForecasters({ round, roundCount, roundState, forecasterEvaluations, existingProposals, chainTimestamp });
    changed = true;
  }
  if (changed) {
    state.rounds[round.id] = roundState;
    saveState();
  }
}

let lastGoodCandles = null;
const MAX_CACHED_CANDLE_AGE_MS = 10 * 60_000;
const FINAL_WINDOW_CACHE_MS = 120_000;

// Forecasters reuse the last good candles for up to 10 minutes if Coinbase is briefly stale, so a
// transient outage cannot silence them inside the final TWAP window. Inside that window a candle set
// under 2 minutes old is used without refetching, because every second counts. Drift is shrunk, so this is safe.
async function forecasterCandles({ inFinalWindow = false } = {}) {
  if (inFinalWindow && lastGoodCandles && Date.now() - lastGoodCandles.at <= FINAL_WINDOW_CACHE_MS) {
    return lastGoodCandles.candles;
  }
  try {
    const candles = await fetchRecentEthCandles();
    lastGoodCandles = { candles, at: Date.now() };
    return candles;
  } catch (error) {
    if (lastGoodCandles && Date.now() - lastGoodCandles.at <= MAX_CACHED_CANDLE_AGE_MS) {
      log({ type: "candles_cached", reason: safeErrorMessage(error), ageSeconds: Math.round((Date.now() - lastGoodCandles.at) / 1000) });
      return lastGoodCandles.candles;
    }
    throw error;
  }
}

const tokenAddressCache = new Map();
async function proposalTokenAddresses(roundCount, proposalId) {
  const key = `${roundCount}:${proposalId}`;
  if (tokenAddressCache.has(key)) return tokenAddressCache.get(key);
  const tokens = await publicClient.readContract({ address: deployment.contracts.quantumRound, abi: quantumAbi, functionName: "proposalTokens" });
  const read = (functionName) => publicClient.readContract({ address: tokens, abi: proposalTokensAbi, functionName, args: [roundCount, BigInt(proposalId)] });
  const [credit, long, short] = await Promise.all([read("creditToken"), read("longToken"), read("shortToken")]);
  const addresses = { credit, long, short };
  tokenAddressCache.set(key, addresses);
  return addresses;
}

async function readHoldings(agent, roundCount, proposalId) {
  const addresses = await proposalTokenAddresses(roundCount, proposalId);
  const balance = (address) => publicClient.readContract({ address, abi: erc20BalanceAbi, functionName: "balanceOf", args: [agent.address] });
  const [credit, long, short] = await Promise.all([balance(addresses.credit), balance(addresses.long), balance(addresses.short)]);
  return { credit, long, short };
}

// Claims credits in every proposal up to the per-proposal cap right after the deposit, so a later trade is
// a single transaction. Claims cost only gas: credits in losing proposals carry no value and a claim never
// reduces a deposit's redeemable value in a proposal that does not win.
async function ensurePreClaims(agent, roundCount, proposalCount) {
  const transactions = [];
  for (let proposalId = 0; proposalId < proposalCount; proposalId += 1) {
    const claimed = await publicClient.readContract({
      address: deployment.contracts.quantumRound,
      abi: quantumAbi,
      functionName: "creditsClaimed",
      args: [roundCount, BigInt(proposalId), agent.address],
    });
    const room = PER_PROPOSAL_CAP_CREDITS - claimed;
    if (room > 0n) {
      transactions.push(await submit(agent, {
        address: deployment.contracts.quantumRound,
        signature: "claimCredits(uint256,uint256,uint256)",
        args: [roundCount, BigInt(proposalId), room],
        label: `pre-claim ${room} credit units proposal ${proposalId}`,
      }));
    }
  }
  return transactions;
}

async function runForecasters({ round, roundCount, roundState, forecasterEvaluations, existingProposals, chainTimestamp }) {
  const cycleStartMs = Date.now();
  const chainNow = () => chainTimestamp + Math.floor((Date.now() - cycleStartMs) / 1000);
  const horizonSeconds = Number(round.evaluationEnd - round.tradingEnd);
  const windowAt = () => guardianThreshold({ nowSeconds: chainNow(), tradingEnd: round.tradingEnd, twapWindow: round.twapWindow });
  const candles = await forecasterCandles({ inFinalWindow: windowAt().inFinalWindow });
  const spent = roundState.forecasterSpent ??= {};
  const deposited = roundState.forecasterDeposited ??= {};
  const quantPlans = new Map();
  const readMarket = async (proposalId) => {
    const [longProbability] = await publicClient.readContract({
      address: deployment.contracts.market,
      abi: marketAbi,
      functionName: "probabilities",
      args: [roundCount, BigInt(proposalId)],
    });
    return Number(longProbability) / 1e18;
  };
  const readProjectedTwap = async (proposalId) => Number(await publicClient.readContract({
    address: deployment.contracts.market,
    abi: marketAbi,
    functionName: "probabilityTwap",
    args: [roundCount, BigInt(proposalId), 0n, 0n],
  })) / 1e18;
  const quoteFor = (proposalId) => (direction) => (creditsIn) => publicClient.readContract({
    address: deployment.contracts.market,
    abi: marketAbi,
    functionName: direction === "long" ? "quoteBuyLong" : "quoteBuyShort",
    args: [roundCount, BigInt(proposalId), creditsIn],
  });
  const sellQuoteFor = (proposalId) => (side) => async (tokensIn) => (await publicClient.readContract({
    address: deployment.contracts.market,
    abi: marketAbi,
    functionName: side === "long" ? "quoteSellLong" : "quoteSellShort",
    args: [roundCount, BigInt(proposalId), tokensIn],
  }))[0];

  for (const { agent, evaluation } of forecasterEvaluations) {
    const agentSpent = spent[agent.id] ??= {};
    let depositTransactions = [];
    if (execute && existingProposals.length > 0) {
      depositTransactions = await ensureForecasterDeposit(agent, roundCount);
      if (depositTransactions.length > 0) {
        log({ type: "forecaster_deposit", roundId: round.id, agentId: agent.id, agentName: agent.name, transactions: depositTransactions });
      }
      if (!roundState.preClaimed?.[agent.id] && !tooCloseToTradingEnd({ nowSeconds: chainNow(), tradingEnd: round.tradingEnd, buffer: 45 })) {
        const claims = await ensurePreClaims(agent, roundCount, existingProposals.length);
        (roundState.preClaimed ??= {})[agent.id] = existingProposals.length;
        state.rounds[round.id] = roundState;
        saveState();
        if (claims.length > 0) log({ type: "forecaster_preclaim", roundId: round.id, agentId: agent.id, agentName: agent.name, transactions: claims });
      }
    }

    // Fresh snapshot per agent so Guardian sees prices after any Quant trade; the leader on projected TWAP goes first.
    const snapshot = await Promise.all(existingProposals.map(async (proposal, proposalId) => ({
      proposalId,
      pMarket: await readMarket(proposalId),
      projectedTwap: await readProjectedTwap(proposalId),
    })));
    const ordered = prioritizeByProjectedTwap(snapshot);
    const leaderId = ordered.find(({ proposalId }) => proposalId > 0)?.proposalId;

    for (const { proposalId, pMarket: snapshotMarket, projectedTwap } of ordered) {
      const proposal = existingProposals[proposalId];
      const tEthBps = Number(proposal[2]);
      const fair = quantFairProbability({ tEthBps, rMin: round.rMin, rMax: round.rMax, horizonSeconds, candles });
      const window = windowAt();
      // Re-read the price right before deciding: an earlier trade in this cycle may have moved it.
      const pMarket = proposalId === ordered[0].proposalId ? snapshotMarket : await readMarket(proposalId);
      const holdings = execute ? await readHoldings(agent, roundCount, proposalId) : { credit: 0n, long: 0n, short: 0n };
      const spentCredits = BigInt(agentSpent[proposalId] ?? "0");
      const common = {
        proposalId,
        pMarket,
        pFair: fair.pFair,
        quoteFor: quoteFor(proposalId),
        sellQuoteFor: execute ? sellQuoteFor(proposalId) : undefined,
        spentCredits,
        holdings,
        creditBalance: holdings.credit,
      };
      const plan = agent.name === "Quant"
        ? await planQuantAction({ ...common, threshold: Number(process.env.QUANT_THRESHOLD ?? QUANT_THRESHOLD) })
        : await planGuardianAction({
          ...common,
          window,
          quantPlan: quantPlans.get(proposalId) ?? null,
          isLeader: proposalId === leaderId,
          projectedTwap,
        });
      const needsDeposit = plan.action === "buy" && !deposited[agent.id] && !execute;
      let transactions = [];
      let executedQuote;
      let pMarketAfter;
      const blockedByDeadline = execute && plan.action !== "none"
        && tooCloseToTradingEnd({ nowSeconds: chainNow(), tradingEnd: round.tradingEnd });
      if (blockedByDeadline) {
        plan.reason = `${plan.reason} Not submitted: under 15 s of trading left, too close to the deadline for Circle to confirm.`;
        plan.action = "none";
      }
      if (plan.action === "buy" || plan.action === "sell") {
        if (!execute) {
          if (plan.action === "buy") agentSpent[proposalId] = (spentCredits + plan.creditsIn).toString();
          deposited[agent.id] = true;
        } else {
          const calls = buildForecasterCalls({
            roundContract: deployment.contracts.quantumRound,
            marketContract: deployment.contracts.market,
            roundId: roundCount,
            plan,
            needsDeposit: false,
          });
          const trade = calls.pop();
          for (const call of calls) transactions.push(await submit(agent, call));
          // Re-quote right before trading so the minimum output reflects the live market, then apply 0.5% slippage.
          executedQuote = plan.action === "buy"
            ? await quoteFor(proposalId)(plan.side)(plan.creditsIn)
            : await sellQuoteFor(proposalId)(plan.side)(plan.tokensIn);
          if (executedQuote <= 0n) throw Object.assign(new Error(`${agent.name}: adapter quote returned zero output.`), { fatal: true });
          trade.args[3] = applySlippage(executedQuote);
          transactions.push(await submit(agent, trade));
          if (plan.action === "buy") agentSpent[proposalId] = (spentCredits + plan.creditsIn).toString();
          state.rounds[round.id] = roundState;
          saveState();
          pMarketAfter = await readMarket(proposalId);
        }
      }
      // After a live Quant trade Guardian re-reads real prices; in dry-run it reasons over the Quant's planned price.
      if (agent.name === "Quant") quantPlans.set(proposalId, execute && plan.action !== "none" ? null : plan);
      log(jsonSafe({
        type: agent.name === "Guardian" && plan.action !== "none" ? "guardian_intervention" : "forecaster_decision",
        roundId: round.id,
        agentId: agent.id,
        agentName: agent.name,
        publicAddress: agent.address,
        cadence: evaluation.cadence,
        proposalId,
        proposalTEthBps: tEthBps,
        pMarket,
        pFair: fair.pFair,
        gap: plan.gap,
        threshold: plan.threshold,
        inFinalWindow: window.inFinalWindow,
        projectedTwap,
        leadingOnProjectedTwap: proposalId === leaderId,
        holdings: execute ? { credit: holdings.credit, long: holdings.long, short: holdings.short } : undefined,
        intendedAction: plan.action === "buy"
          ? [needsDeposit ? "deposit 2 USDC (once per round)" : null, plan.claimCredits > 0n ? `claim ${plan.claimCredits} credit units for proposal ${proposalId}` : "use pre-claimed credits", `buy ${plan.side}`].filter(Boolean)
          : plan.action === "sell" ? [`sell ${plan.side} (trim position)`] : ["none"],
        creditsIn: plan.creditsIn,
        tokensIn: plan.tokensIn,
        quotedOut: plan.quotedOut,
        minOut: plan.minOut,
        expectedPMarketAfter: plan.expectedPMarketAfter,
        reason: plan.reason,
        quantumMarketsNote: "One deposit backs independent credit claims in every proposal this agent trades.",
        fairValue: {
          expectedReturn: fair.expectedReturn,
          appliedDrift: fair.appliedDrift,
          maxAbsoluteDrift: fair.maxAbsoluteDrift,
          sigmaLogReturnPerMinute: fair.sigmaLogReturnPerMinute,
        },
        ...(execute ? { executedQuote, executedMinOut: executedQuote === undefined ? undefined : applySlippage(executedQuote), pMarketAfter, transactions } : {}),
        dryRun,
        submitted: transactions.length > 0,
      }));
    }
    roundState[agent.id] = evaluation.nextState;
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
    liveSubmissionsEnabled: execute,
    agents: agents.map(({ id, name, type, address }) => ({ id, name, type, address })),
    signerBackend: execute ? (process.env.AGENT_SIGNER_BACKEND ?? "circle") : "not initialized in dry-run",
  });
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
    log({ type: "shutdown_requested", reason: "SIGINT; finishing the current read cycle." });
  });
  // Live mode runs proposers, Quant and Guardian as independent loops so one agent's pending
  // transaction never delays another. Dry-run keeps one sequential loop so the Guardian can reason over the Quant's plan.
  const loops = execute
    ? [
      { name: "proposers", tick: () => observeRound({ agentFilter: (agent) => agent.type !== "forecaster", handlesRedeem: true }) },
      ...agents.filter((agent) => agent.type === "forecaster").map((agent) => ({
        name: agent.name,
        pollSeconds: Math.min(pollSeconds, FINAL_WINDOW_INTERVAL_SECONDS),
        tick: () => observeRound({ agentFilter: (candidate) => candidate.id === agent.id, handlesRedeem: false }),
      })),
    ]
    : [{ name: "all", tick: () => observeRound() }];
  try {
    await runIndependentLoops({
      loops,
      pollSeconds,
      once,
      isStopping: () => stopping,
      requestStop: () => { stopping = true; },
      onError: ({ name, error, backoffSeconds }) => log({ type: "runtime_error", loop: name, error: safeErrorMessage(error), retryInSeconds: backoffSeconds, dryRun }),
    });
  } catch (error) {
    if (error.fatal) {
      log({ type: "fatal_error", error: safeErrorMessage(error), note: "Stopping without retry; inspect the failed transaction before restarting." });
    }
    throw error;
  }
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
