import test from "node:test";
import assert from "node:assert/strict";
import {
  applySlippage,
  QUANT_THRESHOLD,
  buildForecasterCalls,
  buildRedeemCall,
  decideDirection,
  guardianThreshold,
  planGuardianAction,
  planQuantAction,
  quantFairProbability,
  sizeTrade,
  tooCloseToTradingEnd,
} from "./forecaster-strategies.mjs";

function candles(returns, initialPrice = 2_500) {
  const rows = [];
  let close = initialPrice;
  for (let index = 0; index <= returns.length; index += 1) {
    rows.push([1_800_000_000 + index * 60, close, close, close, close, 1]);
    if (index < returns.length) close *= Math.exp(returns[index]);
  }
  return rows;
}

const noisy = (drift) => candles(Array.from({ length: 60 }, (_, index) => drift + (index % 2 ? 0.0008 : -0.0008)));
const bounds = { rMin: 990_000_000_000_000_000n, rMax: 1_010_000_000_000_000_000n, horizonSeconds: 600 };

// Mocked adapter: buying with `c` credits at price p gives c / p tokens plus a linear impact of `slope` per credit.
function mockQuote(price, slope = 0.02) {
  return (direction) => async (creditsIn) => {
    const credits = Number(creditsIn) / 1e6;
    const base = direction === "long" ? price : 1 - price;
    const average = direction === "long" ? price + (slope * credits) / 2 : base + (slope * credits) / 2;
    return BigInt(Math.round((credits / average) * 1e18));
  };
}

test("fair value uses shrunk, capped drift and clamps to 0.02-0.98", () => {
  const flat = quantFairProbability({ ...bounds, tEthBps: 5_000, candles: noisy(0) });
  const up = quantFairProbability({ ...bounds, tEthBps: 5_000, candles: noisy(0.0004) });
  const huge = quantFairProbability({ ...bounds, tEthBps: 9_000, candles: noisy(0.05) });
  assert.ok(up.pFair > flat.pFair);
  assert.ok(Math.abs(up.appliedDrift - up.meanLogReturnPerMinute * 10 * 0.5) < 1e-9 || up.appliedDrift === up.maxAbsoluteDrift);
  assert.equal(huge.appliedDrift, huge.maxAbsoluteDrift);
  const tight = quantFairProbability({
    tEthBps: 10_000, rMin: 999_999_000_000_000_000n, rMax: 1_000_001_000_000_000_000n, horizonSeconds: 600, candles: noisy(0.0004),
  });
  assert.ok(tight.pFair === 0.98 || tight.pFair === 0.02);
  const low = quantFairProbability({
    tEthBps: 10_000, rMin: 1_100_000_000_000_000_000n, rMax: 1_200_000_000_000_000_000n, horizonSeconds: 600, candles: noisy(0),
  });
  assert.equal(low.pFair, 0.02);
});

test("direction and threshold logic", () => {
  assert.deepEqual(decideDirection({ pMarket: 0.4, pFair: 0.5, threshold: 0.03 }).direction, "long");
  assert.deepEqual(decideDirection({ pMarket: 0.6, pFair: 0.5, threshold: 0.03 }).direction, "short");
  assert.equal(decideDirection({ pMarket: 0.48, pFair: 0.5, threshold: 0.03 }).direction, "none");
  assert.equal(decideDirection({ pMarket: 0.47, pFair: 0.5, threshold: 0.03 }).direction, "none");
  assert.equal(decideDirection({ pMarket: 0.469, pFair: 0.5, threshold: 0.03 }).direction, "long");
  assert.throws(() => decideDirection({ pMarket: Number.NaN, pFair: 0.5, threshold: 0.03 }));
});

test("trade sizing moves price all the way toward pFair and uses quote views", async () => {
  const quote = mockQuote(0.4, 0.2);
  const sized = await sizeTrade({ direction: "long", pMarket: 0.4, pFair: 0.5, quote: quote("long") });
  assert.equal(sized.action, "buy");
  assert.ok(sized.expectedPMarketAfter <= 0.5 + 1e-6);
  assert.ok(sized.expectedPMarketAfter > 0.45);
  assert.equal(sized.targetPMarket, 0.5);
  assert.equal(sized.minOut, applySlippage(sized.quotedOut));
  assert.equal(sized.minOut, (sized.quotedOut * 9_950n) / 10_000n);
  const short = await sizeTrade({ direction: "short", pMarket: 0.6, pFair: 0.5, quote: mockQuote(0.6, 0.2)("short") });
  assert.equal(short.action, "buy");
  assert.ok(short.expectedPMarketAfter >= 0.5 - 1e-6);
  assert.ok(short.expectedPMarketAfter < 0.55);
  const half = await sizeTrade({ direction: "long", pMarket: 0.4, pFair: 0.5, quote: quote("long"), fraction: 0.5 });
  assert.ok(half.expectedPMarketAfter <= 0.45 + 1e-6);
  assert.ok(half.creditsIn < sized.creditsIn);
});

test("per-trade and per-proposal caps are enforced", async () => {
  const deep = mockQuote(0.2, 0.0001)("long");
  const big = await sizeTrade({ direction: "long", pMarket: 0.2, pFair: 0.9, quote: deep });
  assert.equal(big.creditsIn, 500_000n);
  const partial = await sizeTrade({ direction: "long", pMarket: 0.2, pFair: 0.9, quote: deep, spentCredits: 800_000n });
  assert.equal(partial.creditsIn, 200_000n);
  const exhausted = await sizeTrade({ direction: "long", pMarket: 0.2, pFair: 0.9, quote: deep, spentCredits: 1_000_000n });
  assert.equal(exhausted.action, "none");
});

test("quant takes no action within threshold and plans claim plus buy otherwise", async () => {
  const quoteFor = mockQuote(0.5, 0.05);
  const quiet = await planQuantAction({ proposalId: 0, pMarket: 0.51, pFair: 0.5, quoteFor });
  assert.equal(quiet.action, "none");
  const active = await planQuantAction({ proposalId: 0, pMarket: 0.4, pFair: 0.5, quoteFor: mockQuote(0.4, 0.05) });
  assert.equal(active.action, "buy");
  assert.equal(active.side, "long");
  assert.equal(active.claimCredits, active.creditsIn);
  const calls = buildForecasterCalls({ roundContract: "0xRound", roundId: 5n, plan: active, needsDeposit: true });
  assert.deepEqual(calls.map((call) => call.signature.split("(")[0]), ["deposit", "claimCredits", "buyLong"]);
  assert.equal(calls[2].args[3], active.minOut);
});

test("guardian thresholds differ in the final TWAP window", () => {
  assert.deepEqual(guardianThreshold({ nowSeconds: 100, tradingEnd: 1_000, twapWindow: 300 }), { inFinalWindow: false, threshold: 0.08 });
  assert.deepEqual(guardianThreshold({ nowSeconds: 700, tradingEnd: 1_000, twapWindow: 300 }), { inFinalWindow: true, threshold: 0.05 });
});

test("guardian acts only beyond its threshold, tighter in the final window", async () => {
  const quoteFor = mockQuote(0.44, 0.05);
  const normal = guardianThreshold({ nowSeconds: 0, tradingEnd: 1_000, twapWindow: 300 });
  const final = guardianThreshold({ nowSeconds: 900, tradingEnd: 1_000, twapWindow: 300 });
  const inNormal = await planGuardianAction({ proposalId: 1, pMarket: 0.44, pFair: 0.5, window: normal, quoteFor });
  const inFinal = await planGuardianAction({ proposalId: 1, pMarket: 0.44, pFair: 0.5, window: final, quoteFor });
  assert.equal(inNormal.action, "none");
  assert.equal(inFinal.action, "buy");
  assert.match(inFinal.reason, /Intervention on proposal 1/);
  assert.equal(inFinal.threshold, 0.05);
});

test("guardian stands down when the quant already brought the price within threshold", async () => {
  const quoteFor = mockQuote(0.3, 0.05);
  const window = guardianThreshold({ nowSeconds: 0, tradingEnd: 1_000, twapWindow: 300 });
  const quantPlan = { action: "buy", expectedPMarketAfter: 0.46 };
  const plan = await planGuardianAction({ proposalId: 0, pMarket: 0.3, pFair: 0.5, window, quantPlan, quoteFor });
  assert.equal(plan.action, "none");
  assert.match(plan.reason, /Quant/);
  const noQuant = await planGuardianAction({ proposalId: 0, pMarket: 0.3, pFair: 0.5, window, quoteFor });
  assert.equal(noQuant.action, "buy");
});

test("redeem call targets QuantumRound.redeem", () => {
  assert.deepEqual(buildRedeemCall({ roundContract: "0xRound", roundId: 5n }), {
    address: "0xRound",
    signature: "redeem(uint256)",
    args: [5n],
    label: "redeem",
  });
});

test("quant default threshold is 0.005 and acts just beyond it", async () => {
  assert.equal(QUANT_THRESHOLD, 0.005);
  const quiet = await planQuantAction({ proposalId: 0, pMarket: 0.496, pFair: 0.5, quoteFor: mockQuote(0.496, 0.05) });
  assert.equal(quiet.action, "none");
  const active = await planQuantAction({ proposalId: 0, pMarket: 0.49, pFair: 0.5, quoteFor: mockQuote(0.49, 0.05) });
  assert.equal(active.action, "buy");
});

test("live trades stop 15 seconds before trading closes", () => {
  assert.equal(tooCloseToTradingEnd({ nowSeconds: 984, tradingEnd: 1_000 }), false);
  assert.equal(tooCloseToTradingEnd({ nowSeconds: 985, tradingEnd: 1_000 }), true);
});
