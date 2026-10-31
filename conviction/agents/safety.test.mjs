import test from "node:test";
import assert from "node:assert/strict";
import {
  assertGasWithinCap,
  assertPrincipalWithinCap,
  assertProposalCountWithinCap,
  assertTradeWithinCap,
  PER_AGENT_GAS_CAP_WEI,
  requiredProtocolSeed,
} from "./safety.mjs";

test("agent budgets reject principal, gas, trade, and proposal overages", () => {
  assertPrincipalWithinCap("proposer", 1_000_000n);
  assertPrincipalWithinCap("forecaster", 2_000_000n);
  assert.throws(() => assertPrincipalWithinCap("forecaster", 2_000_001n), /exceeds/);
  assert.throws(() => assertPrincipalWithinCap("proposer", 1_000_001n), /exceeds/);
  assertTradeWithinCap(1_000_000n);
  assert.throws(() => assertTradeWithinCap(1_000_001n), /1 credit/);
  assertProposalCountWithinCap(10);
  assert.throws(() => assertProposalCountWithinCap(11), /between zero and 10/);
  assertGasWithinCap(0n, PER_AGENT_GAS_CAP_WEI);
  assert.throws(() => assertGasWithinCap(1n, PER_AGENT_GAS_CAP_WEI), /0.25 USDC/);
});

test("protocol reserve requirement covers status quo and every proposer market", () => {
  assert.equal(requiredProtocolSeed(5_000_000n, 3), 20_000_000n);
  assert.throws(() => requiredProtocolSeed(5_000_000, 3), /nonnegative bigint/);
  assert.throws(() => requiredProtocolSeed(5_000_000n, -1), /nonnegative whole number/);
});
