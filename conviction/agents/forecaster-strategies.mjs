import { calculateRiskModel, estimateQuantFairProbability } from "./market-data.mjs";
import { assertTradeWithinCap, TRADE_CAP_USDC } from "./safety.mjs";

export const QUANT_THRESHOLD = 0.03;
export const GUARDIAN_THRESHOLD = 0.08;
export const GUARDIAN_FINAL_WINDOW_THRESHOLD = 0.05;
export const PER_TRADE_CAP_CREDITS = TRADE_CAP_USDC;
export const PER_PROPOSAL_CAP_CREDITS = 1_000_000n;
export const MIN_TRADE_CREDITS = 10_000n;
export const SLIPPAGE_BPS = 50n;
export const FAIR_PROBABILITY_MIN = 0.02;
export const FAIR_PROBABILITY_MAX = 0.98;
const CREDIT_TO_TOKEN_SCALE = 10n ** 12n;
const SEARCH_STEPS = 24;

const clamp = (value, lower, upper) => Math.min(upper, Math.max(lower, value));

export function applySlippage(quotedOut, slippageBps = SLIPPAGE_BPS) {
  if (typeof quotedOut !== "bigint" || quotedOut < 0n) throw new Error("Quoted output must be a nonnegative bigint.");
  return (quotedOut * (10_000n - slippageBps)) / 10_000n;
}

// Fair probability for one proposal: pFair = clamp((E[R] - rMin) / (rMax - rMin), 0.02, 0.98).
// estimateQuantFairProbability already halves the drift and caps its effect.
export function quantFairProbability({ tEthBps, rMin, rMax, horizonSeconds, candles }) {
  const risk = calculateRiskModel(candles, horizonSeconds);
  const estimate = estimateQuantFairProbability({
    tEthBps,
    rMin,
    rMax,
    horizonSeconds,
    meanLogReturnPerMinute: risk.meanLogReturnPerMinute,
    sigmaLogReturnPerMinute: risk.sigmaLogReturnPerMinute,
  });
  return {
    pFair: clamp(estimate.probability, FAIR_PROBABILITY_MIN, FAIR_PROBABILITY_MAX),
    expectedReturn: estimate.expectedPortfolioReturn,
    appliedDrift: estimate.appliedDrift,
    maxAbsoluteDrift: estimate.maxAbsoluteDrift,
    sigmaLogReturnPerMinute: risk.sigmaLogReturnPerMinute,
    meanLogReturnPerMinute: risk.meanLogReturnPerMinute,
  };
}

export function decideDirection({ pMarket, pFair, threshold }) {
  if (![pMarket, pFair, threshold].every(Number.isFinite) || threshold < 0) {
    throw new Error("Probabilities and threshold must be finite numbers.");
  }
  const gap = pFair - pMarket;
  if (Math.abs(gap) <= threshold + 1e-9) return { direction: "none", gap };
  return { direction: gap > 0 ? "long" : "short", gap };
}

export function guardianThreshold({ nowSeconds, tradingEnd, twapWindow, normal = GUARDIAN_THRESHOLD, finalWindow = GUARDIAN_FINAL_WINDOW_THRESHOLD }) {
  const inFinalWindow = nowSeconds >= Number(tradingEnd) - Number(twapWindow);
  return { inFinalWindow, threshold: inFinalWindow ? finalWindow : normal };
}

// Average execution price of the bought side, expressed as a LONG probability.
function averageLongPrice(direction, creditsIn, quotedOut) {
  const price = Number(creditsIn * CREDIT_TO_TOKEN_SCALE) / Number(quotedOut);
  return direction === "long" ? price : 1 - price;
}

// Sizes a buy so the marginal price moves roughly halfway toward pFair. Quotes give the average
// execution price; for a locally linear curve the marginal price moves about twice as far.
export async function sizeTrade({ direction, pMarket, pFair, quote, spentCredits = 0n }) {
  if (direction !== "long" && direction !== "short") throw new Error("Trade direction must be long or short.");
  const proposalRoom = PER_PROPOSAL_CAP_CREDITS - spentCredits;
  const available = proposalRoom < PER_TRADE_CAP_CREDITS ? proposalRoom : PER_TRADE_CAP_CREDITS;
  if (available < MIN_TRADE_CREDITS) {
    return { action: "none", reason: "Per-proposal cap of 1 credit is exhausted." };
  }
  const target = pMarket + (pFair - pMarket) / 2;
  const evaluate = async (creditsIn) => {
    const quotedOut = await quote(creditsIn);
    if (quotedOut <= 0n) return { creditsIn, quotedOut, withinTarget: false, impliedAfter: Number.NaN };
    const impliedAfter = pMarket + 2 * (averageLongPrice(direction, creditsIn, quotedOut) - pMarket);
    const withinTarget = direction === "long" ? impliedAfter <= target : impliedAfter >= target;
    return { creditsIn, quotedOut, withinTarget, impliedAfter };
  };

  let best = await evaluate(available);
  if (!best.withinTarget) {
    let low = MIN_TRADE_CREDITS;
    let high = available;
    const smallest = await evaluate(low);
    if (!smallest.withinTarget) {
      return { action: "none", reason: "Even the smallest trade would overshoot the halfway-to-fair target." };
    }
    best = smallest;
    for (let step = 0; step < SEARCH_STEPS && high - low > 1n; step += 1) {
      const middle = (low + high) / 2n;
      const candidate = await evaluate(middle);
      if (candidate.withinTarget) {
        best = candidate;
        low = middle;
      } else high = middle;
    }
  }
  assertTradeWithinCap(best.creditsIn);
  return {
    action: "buy",
    side: direction,
    creditsIn: best.creditsIn,
    quotedOut: best.quotedOut,
    minOut: applySlippage(best.quotedOut),
    expectedPMarketAfter: best.impliedAfter,
    targetPMarket: target,
  };
}

export async function planQuantAction({ proposalId, pMarket, pFair, threshold = QUANT_THRESHOLD, quoteFor, spentCredits = 0n }) {
  const { direction, gap } = decideDirection({ pMarket, pFair, threshold });
  const base = { agent: "Quant", proposalId, pMarket, pFair, gap, threshold };
  if (direction === "none") {
    return { ...base, action: "none", reason: `|pMarket - pFair| = ${Math.abs(gap).toFixed(4)} is within ${threshold}.` };
  }
  const sized = await sizeTrade({ direction, pMarket, pFair, quote: quoteFor(direction), spentCredits });
  if (sized.action === "none") return { ...base, ...sized };
  return {
    ...base,
    ...sized,
    claimCredits: sized.creditsIn,
    reason: `Market ${direction === "long" ? "below" : "above"} fair value by ${Math.abs(gap).toFixed(4)}; buying ${direction.toUpperCase()}.`,
  };
}

export async function planGuardianAction({
  proposalId,
  pMarket,
  pFair,
  window,
  quantPlan = null,
  quoteFor,
  spentCredits = 0n,
}) {
  const { inFinalWindow, threshold } = window;
  const quantTraded = quantPlan?.action === "buy";
  const effectiveMarket = quantTraded ? quantPlan.expectedPMarketAfter : pMarket;
  const { direction, gap } = decideDirection({ pMarket: effectiveMarket, pFair, threshold });
  const base = {
    agent: "Guardian",
    proposalId,
    pMarket,
    pFair,
    gap: pFair - pMarket,
    threshold,
    inFinalWindow,
    effectivePMarket: effectiveMarket,
  };
  if (direction === "none") {
    return {
      ...base,
      action: "none",
      reason: quantTraded
        ? `Quant's trade already brings the price within ${threshold} of pFair.`
        : `Deviation ${Math.abs(gap).toFixed(4)} is within the ${inFinalWindow ? "final-window" : "normal"} threshold ${threshold}.`,
    };
  }
  const sized = await sizeTrade({ direction, pMarket: effectiveMarket, pFair, quote: quoteFor(direction), spentCredits });
  if (sized.action === "none") return { ...base, ...sized };
  return {
    ...base,
    ...sized,
    claimCredits: sized.creditsIn,
    reason: `Intervention on proposal ${proposalId}: deviation ${Math.abs(gap).toFixed(4)} exceeds ${threshold}; buying ${direction.toUpperCase()} toward pFair.`,
  };
}

export function buildForecasterCalls({ roundContract, marketContract, roundId, plan, needsDeposit, depositUsdc = 1_000_000n }) {
  const calls = [];
  if (needsDeposit) {
    calls.push({ address: roundContract, signature: "deposit(uint256,uint256)", args: [roundId, depositUsdc], label: "deposit" });
  }
  if (plan.action === "buy") {
    calls.push({
      address: roundContract,
      signature: "claimCredits(uint256,uint256,uint256)",
      args: [roundId, BigInt(plan.proposalId), plan.claimCredits],
      label: `claim proposal ${plan.proposalId}`,
    });
    calls.push({
      address: roundContract,
      signature: plan.side === "long"
        ? "buyLong(uint256,uint256,uint256,uint256)"
        : "buyShort(uint256,uint256,uint256,uint256)",
      args: [roundId, BigInt(plan.proposalId), plan.creditsIn, plan.minOut],
      label: `buy ${plan.side} proposal ${plan.proposalId}`,
    });
  }
  return calls;
}

export function buildRedeemCall({ roundContract, roundId }) {
  return { address: roundContract, signature: "redeem(uint256)", args: [roundId], label: "redeem" };
}

// Not exercised until the live round: redeem is only valid after the round settles.
export async function redeemAfterSettlement(signer, { roundContract, roundId }) {
  return signer.executeContractCall(buildRedeemCall({ roundContract, roundId }));
}
