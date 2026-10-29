import test from "node:test";
import assert from "node:assert/strict";
import {
  assertGasWithinCap,
  assertPrincipalWithinCap,
  assertProposalCountWithinCap,
  assertTradeWithinCap,
  PER_AGENT_GAS_CAP_WEI,
} from "./safety.mjs";

test("agent budgets reject principal, gas, trade, and proposal overages", () => {
  assertPrincipalWithinCap("proposer", 1_000_000n);
  assertPrincipalWithinCap("forecaster", 1_000_000n);
  assert.throws(() => assertPrincipalWithinCap("proposer", 1_000_001n), /exceeds/);
  assertTradeWithinCap(500_000n);
  assert.throws(() => assertTradeWithinCap(500_001n), /0.50 USDC/);
  assertProposalCountWithinCap(10);
  assert.throws(() => assertProposalCountWithinCap(11), /between zero and 10/);
  assertGasWithinCap(0n, PER_AGENT_GAS_CAP_WEI);
  assert.throws(() => assertGasWithinCap(1n, PER_AGENT_GAS_CAP_WEI), /0.25 USDC/);
});
