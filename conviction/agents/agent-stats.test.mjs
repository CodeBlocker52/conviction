import test from "node:test";
import assert from "node:assert/strict";
import { aggregateAgentEvents } from "../app/lib/agent-stats.ts";

const agent = "0xAbC0000000000000000000000000000000000001";
const other = "0x0000000000000000000000000000000000000002";

const logs = [
  { name: "Redeemed", blockNumber: 30, params: { roundId: "2", user: agent.toLowerCase(), payout: "1923678" } },
  { name: "Trade", blockNumber: 29, params: { roundId: "2", proposalId: "1", user: agent, side: "BUY_LONG", amountIn: "1", amountOut: "1" } },
  { name: "ProposalCreated", blockNumber: 28, params: { roundId: "2", proposalId: "1", proposer: agent, tEthBps: "3400", rationaleURI: "newest" } },
  { name: "Deposited", blockNumber: 20, params: { roundId: "2", user: agent, amount: "2000000" } },
  { name: "Deposited", blockNumber: 19, params: { roundId: "3", user: agent, amount: "2000000" } },
  { name: "ProposalCreated", blockNumber: 10, params: { roundId: "1", proposalId: "1", proposer: agent, tEthBps: "5000", rationaleURI: "older" } },
  { name: "Trade", blockNumber: 9, params: { roundId: "1", proposalId: "1", user: other, side: "BUY_LONG", amountIn: "1", amountOut: "1" } },
];

test("aggregates latest rationale, trade count and settled-round P&L for one address", () => {
  const stats = aggregateAgentEvents(logs, agent);
  assert.deepEqual(stats.latestRationale, { roundId: 2, tEthBps: 3400, text: "newest" });
  assert.equal(stats.trades, 1);
  assert.equal(stats.settledRounds, 1);
  // Round 3 was deposited but not redeemed yet, so it is excluded rather than counted as a loss.
  assert.equal(stats.pnlUnits, 1923678n - 2000000n);
});

test("an address with no events has empty stats", () => {
  const stats = aggregateAgentEvents(logs, "0x0000000000000000000000000000000000000009");
  assert.deepEqual(stats, { latestRationale: null, trades: 0, settledRounds: 0, pnlUnits: 0n });
});
