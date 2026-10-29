import test from "node:test";
import assert from "node:assert/strict";
import { calculateRiskModel, estimateQuantFairProbability } from "./market-data.mjs";

function makeCandles(returnSteps) {
  const candles = [];
  let close = 2_500;
  for (let index = 0; index <= returnSteps.length; index += 1) {
    const timestamp = 1_800_000_000 + index * 60;
    candles.push([timestamp, close, close, close, close, 1]);
    if (index < returnSteps.length) close *= Math.exp(returnSteps[index]);
  }
  return candles;
}

test("risk bounds derive a rounded symmetric band from ten-minute volatility", () => {
  const model = calculateRiskModel(makeCandles(Array.from({ length: 40 }, (_, index) => index % 2 ? 0.001 : -0.001)));
  assert.equal(model.horizonSeconds, 600);
  assert.equal(model.sampleCount, 40);
  assert.equal(model.bandBps, 100);
  assert.equal(model.rMin, 990_000_000_000_000_000n);
  assert.equal(model.rMax, 1_010_000_000_000_000_000n);
});

test("risk bounds clamp low and high volatility to the approved band limits", () => {
  const low = calculateRiskModel(makeCandles(Array(40).fill(0)));
  const high = calculateRiskModel(makeCandles(Array.from({ length: 40 }, (_, index) => index % 2 ? 0.03 : -0.03)));
  assert.equal(low.bandBps, 50);
  assert.equal(high.bandBps, 200);
  assert.equal(low.rMin, 995_000_000_000_000_000n);
  assert.equal(high.rMax, 1_020_000_000_000_000_000n);
});

test("quant fair values use half drift and cap its effect at one quarter of the three-sigma band", () => {
  const inputs = {
    rMin: 990_000_000_000_000_000n,
    rMax: 1_010_000_000_000_000_000n,
    horizonSeconds: 600,
    meanLogReturnPerMinute: 0.00003489897036,
    sigmaLogReturnPerMinute: 0.00084571436093,
  };
  const probabilities = [2_000, 5_000, 8_000].map((tEthBps) =>
    estimateQuantFairProbability({ ...inputs, tEthBps }).probability,
  );
  assert.ok(Math.abs(probabilities[0] - 0.5018) < 0.0001);
  assert.ok(Math.abs(probabilities[1] - 0.5044) < 0.0001);
  assert.ok(Math.abs(probabilities[2] - 0.5071) < 0.0001);

  const capped = estimateQuantFairProbability({
    ...inputs,
    tEthBps: 10_000,
    meanLogReturnPerMinute: 0.1,
  });
  assert.equal(capped.appliedDrift, capped.maxAbsoluteDrift);
});

test("risk model rejects noncontiguous or insufficient candle history", () => {
  assert.throws(() => calculateRiskModel(makeCandles([0.001, -0.001])), /contiguous one-minute closes/);
  assert.throws(() => calculateRiskModel(makeCandles(Array(40).fill(0)), 30), /at least 60 whole seconds/);
});
