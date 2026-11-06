import assert from "node:assert/strict";
import test from "node:test";
import { readProposalTokenAddresses, readTokenHoldings } from "./chain-reads.mjs";

test("proposal token addresses use one strict multicall with the original arguments", async () => {
  const client = { multicall: async ({ contracts, allowFailure }) => {
    assert.equal(allowFailure, false);
    assert.deepEqual(contracts.map(({ address, functionName, args }) => [address, functionName, args]), [
      ["factory", "creditToken", [2n, 3n]], ["factory", "longToken", [2n, 3n]], ["factory", "shortToken", [2n, 3n]],
    ]);
    return ["credit", "long", "short"];
  } };
  assert.deepEqual(await readProposalTokenAddresses(client, "factory", [], 2n, 3), {
    credit: "credit", long: "long", short: "short",
  });
});

test("holdings use one strict multicall and propagate failures", async () => {
  const addresses = { credit: "credit", long: "long", short: "short" };
  const client = { multicall: async ({ contracts, allowFailure }) => {
    assert.equal(allowFailure, false);
    assert.deepEqual(contracts.map(({ address, functionName, args }) => [address, functionName, args]), [
      ["credit", "balanceOf", ["agent"]], ["long", "balanceOf", ["agent"]], ["short", "balanceOf", ["agent"]],
    ]);
    return [1n, 2n, 3n];
  } };
  assert.deepEqual(await readTokenHoldings(client, addresses, [], "agent"), { credit: 1n, long: 2n, short: 3n });
  await assert.rejects(readTokenHoldings({ multicall: async () => { throw new Error("RPC unavailable"); } },
    addresses, [], "agent"), /RPC unavailable/);
});
