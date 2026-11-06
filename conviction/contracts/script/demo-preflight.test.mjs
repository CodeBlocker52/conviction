import assert from "node:assert/strict";
import test from "node:test";
import { readPreflightContracts, roundsAffordable } from "./demo-preflight.mjs";

test("preflight batches agent and operator balances with reserve, round and oracle reads", async () => {
  const agents = [{ address: "agent1" }, { address: "agent2" }];
  const contracts = { usdc: "usdc", quantumRound: "round", priceOracle: "oracle" };
  let calls = 0;
  const client = {
    multicall: async ({ contracts: reads, allowFailure }) => {
      calls += 1;
      assert.equal(allowFailure, false);
      assert.deepEqual(reads.map((read) => [read.functionName, read.args?.[0]]), [
        ["balanceOf", "agent1"], ["balanceOf", "agent2"],
        ["balanceOf", "admin"], ["balanceOf", "keeper"],
        ["protocolLiquiditySeed", undefined], ["initialLiquidityPerProposal", undefined],
        ["roundCount", undefined], ["latestPrice", undefined],
      ]);
      return [1n, 2n, 3n, 4n, 20n, 5n, 7n, [123n, 8, 456n]];
    },
  };
  assert.deepEqual(await readPreflightContracts(client, contracts, agents, "admin", "keeper"), {
    balances: [1n, 2n, 3n, 4n], reserve: 20n, perProposal: 5n, count: 7n, oracle: [123n, 8, 456n],
  });
  assert.equal(calls, 1);
});

test("preflight surfaces a failed multicall", async () => {
  await assert.rejects(readPreflightContracts({
    multicall: async () => { throw new Error("RPC unavailable"); },
  }, { usdc: "usdc", quantumRound: "round", priceOracle: "oracle" }, [], "admin", "keeper"), /RPC unavailable/);
});

test("round affordability retains the existing gas and headroom calculation", () => {
  assert.equal(roundsAffordable(3.1, "forecaster", 0.1), 10);
  assert.equal(roundsAffordable(1, "proposer", 0.15), 0);
});
