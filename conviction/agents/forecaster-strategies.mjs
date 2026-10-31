import { calculateRiskModel, estimateQuantFairProbability } from "./market-data.mjs";
import { assertTradeWithinCap, TRADE_CAP_USDC } from "./safety.mjs";

export const QUANT_THRESHOLD = 0.005;
export const GUARDIAN_THRESHOLD = 0.03;
export const GUARDIAN_FINAL_WINDOW_THRESHOLD = 0.01;
export const PER_TRADE_CAP_CREDITS = TRADE_CAP_USDC;
export const PER_PROPOSAL_CAP_CREDITS = 2_000_000n;
export const MIN_TRADE_CREDITS = 10_000n;
export const SLIPPAGE_BPS = 50n;
export const FAIR_PROBABILITY_MIN = 0.02;
export const FAIR_PROBABILITY_MAX = 0.98;
// Circle transactions take several seconds to land, so live trades stop shortly before trading closes.
export const SUBMISSION_BUFFER_SECONDS = 15;
export const tooCloseToTradingEnd = ({ nowSeconds, tradingEnd, buffer = SUBMISSION_BUFFER_SECONDS }) =>
  nowSeconds >= Number(tradingEnd) - buffer;
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

// Shared bisection: the largest size in [MIN, max] whose implied post-trade price still does not overshoot the target.
async function searchLargestWithinTarget({ min, max, evaluate }) {
  let best = await evaluate(max);
  if (best.withinTarget) return best;
  let low = min;
  let high = max;
  const smallest = await evaluate(low);
  if (!smallest.withinTarget) return null;
  best = smallest;
  for (let step = 0; step < SEARCH_STEPS && high - low > 1n; step += 1) {
    const middle = (low + high) / 2n;
    const candidate = await evaluate(middle);
    if (candidate.withinTarget) {
      best = candidate;
      low = middle;
    } else high = middle;
  }
  return best;
}

// Sizes a buy so the marginal price moves all the way to pFair (fraction 1). Quotes give the average
// execution price; for a locally linear curve the marginal price moves about twice as far.
export async function sizeTrade({ direction, pMarket, pFair, quote, spentCredits = 0n, fraction = 1 }) {
  if (direction !== "long" && direction !== "short") throw new Error("Trade direction must be long or short.");
  const proposalRoom = PER_PROPOSAL_CAP_CREDITS - spentCredits;
  const available = proposalRoom < PER_TRADE_CAP_CREDITS ? proposalRoom : PER_TRADE_CAP_CREDITS;
  if (available < MIN_TRADE_CREDITS) {
    return { action: "none", reason: `Per-proposal cap of ${Number(PER_PROPOSAL_CAP_CREDITS) / 1e6} credits is exhausted.` };
  }
  const target = pMarket + (pFair - pMarket) * fraction;
  const evaluate = async (creditsIn) => {
    const quotedOut = await quote(creditsIn);
    if (quotedOut <= 0n) return { creditsIn, quotedOut, withinTarget: false, impliedAfter: Number.NaN };
    const impliedAfter = pMarket + 2 * (averageLongPrice(direction, creditsIn, quotedOut) - pMarket);
    const withinTarget = direction === "long" ? impliedAfter <= target : impliedAfter >= target;
    return { creditsIn, quotedOut, withinTarget, impliedAfter };
  };
  const best = await searchLargestWithinTarget({ min: MIN_TRADE_CREDITS, max: available, evaluate });
  if (!best) return { action: "none", reason: "Even the smallest trade would overshoot the pFair target." };
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

// Sizes a sell of an existing position (LONG sold when the market is above fair, SHORT sold when below).
// Same all-the-way-to-pFair target, capped by the holding and by the 1 credit per-trade cap in token terms.
export async function sizeSell({ sellSide, pMarket, pFair, held, quote, fraction = 1 }) {
  if (sellSide !== "long" && sellSide !== "short") throw new Error("Sell side must be long or short.");
  const minTokens = MIN_TRADE_CREDITS * CREDIT_TO_TOKEN_SCALE;
  const capTokens = PER_TRADE_CAP_CREDITS * CREDIT_TO_TOKEN_SCALE;
  const available = held < capTokens ? held : capTokens;
  if (available < minTokens) return { action: "none", reason: `No ${sellSide.toUpperCase()} position large enough to sell.` };
  const target = pMarket + (pFair - pMarket) * fraction;
  const evaluate = async (tokensIn) => {
    const creditsOut = await quote(tokensIn);
    if (creditsOut <= 0n) return { tokensIn, creditsOut, withinTarget: false, impliedAfter: Number.NaN };
    const averagePrice = Number(creditsOut * CREDIT_TO_TOKEN_SCALE) / Number(tokensIn);
    // Selling LONG pushes the LONG price down; selling SHORT pushes the LONG price up.
    const impliedAfter = sellSide === "long"
      ? pMarket - 2 * (pMarket - averagePrice)
      : pMarket + 2 * ((1 - pMarket) - averagePrice);
    const withinTarget = sellSide === "long" ? impliedAfter >= target : impliedAfter <= target;
    return { tokensIn, creditsOut, withinTarget, impliedAfter };
  };
  const best = await searchLargestWithinTarget({ min: minTokens, max: available, evaluate });
  if (!best) return { action: "none", reason: "Even the smallest sale would overshoot the pFair target." };
  return {
    action: "sell",
    side: sellSide,
    tokensIn: best.tokensIn,
    quotedOut: best.creditsOut,
    minOut: applySlippage(best.creditsOut),
    expectedPMarketAfter: best.impliedAfter,
    targetPMarket: target,
  };
}

// Trims an existing opposite position first (sell), otherwise opens a new one (buy).
async function chooseTrade({ direction, pMarket, pFair, quoteFor, spentCredits, holdings, sellQuoteFor, creditBalance }) {
  const opposite = direction === "short" ? "long" : "short";
  const held = holdings?.[opposite] ?? 0n;
  if (sellQuoteFor && held > 0n) {
    const sold = await sizeSell({ sellSide: opposite, pMarket, pFair, held, quote: sellQuoteFor(opposite) });
    if (sold.action === "sell") return sold;
  }
  const sized = await sizeTrade({ direction, pMarket, pFair, quote: quoteFor(direction), spentCredits });
  if (sized.action !== "buy") return sized;
  const shortfall = sized.creditsIn - (creditBalance ?? 0n);
  return { ...sized, claimCredits: shortfall > 0n ? shortfall : 0n };
}

const describeTrade = (plan) => (plan.action === "sell" ? `selling ${plan.side.toUpperCase()}` : `buying ${plan.side.toUpperCase()}`);

export async function planQuantAction({
  proposalId, pMarket, pFair, threshold = QUANT_THRESHOLD, quoteFor, spentCredits = 0n, holdings, sellQuoteFor, creditBalance = 0n,
}) {
  const { direction, gap } = decideDirection({ pMarket, pFair, threshold });
  const base = { agent: "Quant", proposalId, pMarket, pFair, gap, threshold };
  if (direction === "none") {
    return { ...base, action: "none", reason: `|pMarket - pFair| = ${Math.abs(gap).toFixed(4)} is within ${threshold}.` };
  }
  const sized = await chooseTrade({ direction, pMarket, pFair, quoteFor, spentCredits, holdings, sellQuoteFor, creditBalance });
  if (sized.action === "none") return { ...base, ...sized };
  return {
    ...base,
    ...sized,
    reason: `Market ${direction === "long" ? "below" : "above"} fair value by ${Math.abs(gap).toFixed(4)}; ${describeTrade(sized)}.`,
  };
}

// Orders proposals so the one currently leading on projected final-window TWAP is handled first.
export function prioritizeByProjectedTwap(entries) {
  return [...entries].sort((left, right) => (right.projectedTwap - left.projectedTwap) || (left.proposalId - right.proposalId));
}

export async function planGuardianAction({
  proposalId,
  pMarket,
  pFair,
  window,
  quantPlan = null,
  quoteFor,
  spentCredits = 0n,
  holdings,
  sellQuoteFor,
  creditBalance = 0n,
  isLeader = false,
  projectedTwap,
}) {
  const { inFinalWindow, threshold } = window;
  const quantTraded = quantPlan?.action === "buy" || quantPlan?.action === "sell";
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
    isLeader,
    projectedTwap,
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
  const sized = await chooseTrade({
    direction, pMarket: effectiveMarket, pFair, quoteFor, spentCredits, holdings, sellQuoteFor, creditBalance,
  });
  if (sized.action === "none") return { ...base, ...sized };
  return {
    ...base,
    ...sized,
    reason: `Intervention on proposal ${proposalId}${isLeader ? " (leading on projected TWAP)" : ""}: deviation ${Math.abs(gap).toFixed(4)} exceeds ${threshold}; ${describeTrade(sized)} toward pFair.`,
  };
}

export function buildForecasterCalls({ roundContract, marketContract, roundId, plan, needsDeposit, depositUsdc = 2_000_000n }) {
  const calls = [];
  if (needsDeposit) {
    calls.push({ address: roundContract, signature: "deposit(uint256,uint256)", args: [roundId, depositUsdc], label: "deposit" });
  }
  if (plan.action === "buy") {
    const claim = plan.claimCredits ?? plan.creditsIn;
    if (claim > 0n) {
      calls.push({
        address: roundContract,
        signature: "claimCredits(uint256,uint256,uint256)",
        args: [roundId, BigInt(plan.proposalId), claim],
        label: `claim proposal ${plan.proposalId}`,
      });
    }
    calls.push({
      address: roundContract,
      signature: plan.side === "long"
        ? "buyLong(uint256,uint256,uint256,uint256)"
        : "buyShort(uint256,uint256,uint256,uint256)",
      args: [roundId, BigInt(plan.proposalId), plan.creditsIn, plan.minOut],
      label: `buy ${plan.side} proposal ${plan.proposalId}`,
    });
  }
  if (plan.action === "sell") {
    calls.push({
      address: roundContract,
      signature: plan.side === "long"
        ? "sellLong(uint256,uint256,uint256,uint256)"
        : "sellShort(uint256,uint256,uint256,uint256)",
      args: [roundId, BigInt(plan.proposalId), plan.tokensIn, plan.minOut],
      label: `sell ${plan.side} proposal ${plan.proposalId}`,
    });
  }
  return calls;
}

export function buildRedeemCall({ roundContract, roundId }) {
  return { address: roundContract, signature: "redeem(uint256)", args: [roundId], label: "redeem" };
}

// Redeem is only valid after the round settles.
export async function redeemAfterSettlement(signer, { roundContract, roundId }) {
  return signer.executeContractCall(buildRedeemCall({ roundContract, roundId }));
}
