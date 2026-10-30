import assert from "node:assert/strict";
import test from "node:test";
import { Q96, sqrtPriceAtTick } from "./pool-lib.mjs";

test("sqrtPriceAtTick matches Uniswap Q64.96 prices across configured ranges", () => {
  for (const tick of [-200_280, -197_340, 0, 197_340, 200_280]) {
    const actual = Number(sqrtPriceAtTick(tick)) / Number(Q96);
    const expected = Math.sqrt(1.0001 ** tick);
    assert.ok(Math.abs(actual / expected - 1) < 1e-10, `tick ${tick}: ${actual} vs ${expected}`);
  }
});
