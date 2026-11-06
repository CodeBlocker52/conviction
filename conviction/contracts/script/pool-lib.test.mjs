import assert from "node:assert/strict";
import test from "node:test";
import { Q96, planPoolAlignment, sqrtPriceAtTick } from "./pool-lib.mjs";

test("sqrtPriceAtTick matches Uniswap Q64.96 prices across configured ranges", () => {
  for (const tick of [-200_280, -197_340, 0, 197_340, 200_280]) {
    const actual = Number(sqrtPriceAtTick(tick)) / Number(Q96);
    const expected = Math.sqrt(1.0001 ** tick);
    assert.ok(Math.abs(actual / expected - 1) < 1e-10, `tick ${tick}: ${actual} vs ${expected}`);
  }
});

const position = { tickLower: -60, tickUpper: 60 };
const alignmentPlan = (overrides = {}) => planPoolAlignment({
  pool: { sqrtPriceX96: Q96, liquidity: 10_000n },
  position,
  positionLiquidity: 10_000n,
  fullRangeLiquidity: 0n,
  oracleSqrt: Q96 - Q96 / 100n,
  deviationBps: 69,
  toleranceBps: 20n,
  ...overrides,
});

test("plans alignment after removing the only active position", () => {
  const { remainingLiquidity, align } = alignmentPlan();
  assert.equal(remainingLiquidity, 0n);
  assert.deepEqual(align, { zeroForOne: true, amountIn: 1_000n, token: "USDC" });
});

test("plans recovery of an already empty pool in either direction", () => {
  const emptyPool = { sqrtPriceX96: Q96, liquidity: 0n };
  assert.equal(alignmentPlan({ pool: emptyPool, positionLiquidity: 0n }).align.token, "USDC");
  assert.deepEqual(alignmentPlan({ pool: emptyPool, positionLiquidity: 0n, oracleSqrt: Q96 + Q96 / 100n }).align,
    { zeroForOne: false, amountIn: 1_000n, token: "tETH" });
});

test("plans against full-range liquidity remaining after removal", () => {
  const plan = alignmentPlan({ pool: { sqrtPriceX96: Q96, liquidity: 15_000n }, fullRangeLiquidity: 5_000n });
  assert.equal(plan.remainingLiquidity, 5_000n);
  assert.equal(plan.align.token, "USDC");
  assert.ok(plan.align.amountIn > 1_000n);
});

test("does not subtract an inactive position or align within tolerance", () => {
  const inactive = { tickLower: 60, tickUpper: 120 };
  assert.equal(alignmentPlan({
    position: inactive, pool: { sqrtPriceX96: Q96, liquidity: 5_000n }, fullRangeLiquidity: 5_000n,
  }).remainingLiquidity, 5_000n);
  assert.equal(alignmentPlan({ deviationBps: 20 }).align, null);
});

test("refuses unsafe or inconsistent liquidity before removal", () => {
  assert.throws(() => alignmentPlan({ pool: { sqrtPriceX96: Q96, liquidity: 15_000n } }), /Unexpected active liquidity/);
  assert.throws(() => alignmentPlan({ pool: { sqrtPriceX96: Q96, liquidity: 9_999n } }), /exceeds pool liquidity/);
  assert.throws(() => alignmentPlan({ position: { tickLower: -887_220, tickUpper: 887_220 } }), /also the full-range position/);
});
