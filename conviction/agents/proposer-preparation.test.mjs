import test from "node:test";
import assert from "node:assert/strict";
import { prepareProposer, readProposerReadiness } from "./proposer-preparation.mjs";

const agent = { id: "MOMENTUM", name: "Momentum", address: "0x1111111111111111111111111111111111111111" };
const registry = "0x2222222222222222222222222222222222222222";
const usdc = "0x3333333333333333333333333333333333333333";
const empty = "0x0000000000000000000000000000000000000000";

test("readiness uses one Multicall for bond, registry and allowances", async () => {
  const other = { ...agent, id: "NEWS" };
  let calls = 0;
  const result = await readProposerReadiness({
    client: { multicall: async ({ contracts, allowFailure }) => {
      calls += 1;
      assert.equal(allowFailure, false);
      assert.deepEqual(contracts.map((item) => item.functionName), ["DEFAULT_BOND", "agents", "allowance", "agents", "allowance"]);
      return [1_000_000n, ["", empty, false], 0n, ["News", other.address, true], 12n];
    } },
    agents: [agent, other], round: registry, registry, usdc, roundAbi: [], registryAbi: [], usdcAbi: [],
  });
  assert.equal(calls, 1);
  assert.equal(result.get("NEWS").allowance, 12n);
  assert.equal(result.get("MOMENTUM").bond, 1_000_000n);
});

test("idle preparation registers and approves a bounded allowance; existing allowance is not overwritten unnecessarily", async () => {
  const calls = [];
  const base = {
    agent, registry, usdc, targetAllowance: 15_000_000n,
    assertIdle: async () => calls.push("idle"),
    assertBond: (bond) => assert.equal(bond, 1_000_000n),
    submit: async (_agent, call) => calls.push(call),
  };
  await prepareProposer({ ...base, readiness: { bond: 1_000_000n, registryInfo: ["", empty, false], allowance: 0n } });
  assert.deepEqual(calls.map((call) => call === "idle" ? call : call.label), ["idle", "register proposer", "idle", "prepare bond allowance"]);
  assert.equal(calls[3].args[1], 15_000_000n);
  calls.length = 0;
  await prepareProposer({ ...base, readiness: { bond: 1_000_000n, registryInfo: ["Momentum", agent.address, true], allowance: 20_000_000n } });
  assert.deepEqual(calls, []);
});

test("preparation resets an insufficient nonzero allowance and stops if a round opens", async () => {
  const calls = [];
  let idleChecks = 0;
  await assert.rejects(prepareProposer({
    agent, registry, usdc, targetAllowance: 15_000_000n,
    readiness: { bond: 1_000_000n, registryInfo: ["Momentum", agent.address, true], allowance: 1_000_000n },
    assertBond: () => {},
    assertIdle: async () => { if (++idleChecks === 2) throw new Error("round opened"); },
    submit: async (_agent, call) => calls.push(call),
  }), /round opened/);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, [registry, 0n]);
});
