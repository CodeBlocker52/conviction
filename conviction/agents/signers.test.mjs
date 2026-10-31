import test from "node:test";
import assert from "node:assert/strict";
import { CircleAgentSigner, createAgentSigner } from "./signers.mjs";

const agent = { id: "MOMENTUM", name: "Momentum", type: "proposer", address: "0x0000000000000000000000000000000000000001" };
const hash = `0x${"1".repeat(64)}`;

test("Circle signer estimates and reserves gas before submitting exactly one transaction", async () => {
  const events = [];
  let submissions = 0;
  const signer = new CircleAgentSigner({
    agent,
    walletId: "wallet-id",
    gasCapWei: 250_000_000_000_000_000n,
    spentGasWei: 0n,
    logEvent: (event) => events.push(event),
    waitForReceipt: async () => ({ status: "success", gasUsed: 21_000n, effectiveGasPrice: 1_000_000_000n }),
    client: {
      estimateContractExecutionFee: async () => ({ data: { medium: { networkFee: "0.01" } } }),
      createContractExecutionTransaction: async () => {
        submissions += 1;
        return { data: { id: "circle-transaction-id" } };
      },
      getTransaction: async () => ({ data: { transaction: { txHash: hash } } }),
    },
  });

  const result = await signer.executeContractCall({
    address: agent.address,
    signature: "approve(address,uint256)",
    args: [agent.address, 1n],
    label: "approval",
  });

  assert.equal(result.hash, hash);
  assert.equal(submissions, 1);
  assert.deepEqual(events.map((event) => event.type), [
    "transaction_attempt",
    "transaction_submitted",
    "transaction",
  ]);
  assert.equal(events[0].estimatedGasWei, "10000000000000000");
  assert.equal(events[2].actualGasWei, "21000000000000");
});

test("Circle signer stops before submission when its cumulative fee cap would be exceeded", async () => {
  let submissions = 0;
  const signer = new CircleAgentSigner({
    agent,
    walletId: "wallet-id",
    gasCapWei: 250_000_000_000_000_000n,
    spentGasWei: 240_000_000_000_000_000n,
    logEvent: () => {},
    client: {
      estimateContractExecutionFee: async () => ({ data: { medium: { networkFee: "0.02" } } }),
      createContractExecutionTransaction: async () => {
        submissions += 1;
        return { data: { id: "should-not-be-created" } };
      },
    },
  });
  await assert.rejects(
    signer.executeContractCall({ address: agent.address, signature: "approve(address,uint256)", args: [], label: "approval" }),
    /0.25 USDC gas cap/,
  );
  assert.equal(submissions, 0);
});

test("Circle signer serializes concurrent calls so they cannot race the gas cap", async () => {
  let submissions = 0;
  const signer = new CircleAgentSigner({
    agent,
    walletId: "wallet-id",
    gasCapWei: 250_000_000_000_000_000n,
    spentGasWei: 0n,
    logEvent: () => {},
    waitForReceipt: async () => ({ status: "success", gasUsed: 21_000n, effectiveGasPrice: 10_000_000_000_000n }),
    client: {
      estimateContractExecutionFee: async () => ({ data: { medium: { networkFee: "0.15" } } }),
      createContractExecutionTransaction: async () => {
        submissions += 1;
        return { data: { id: `tx-${submissions}` } };
      },
      getTransaction: async () => ({ data: { transaction: { txHash: hash } } }),
    },
  });
  const calls = [
    signer.executeContractCall({ address: agent.address, signature: "approve(address,uint256)", args: [], label: "first" }),
    signer.executeContractCall({ address: agent.address, signature: "approve(address,uint256)", args: [], label: "second" }),
  ];
  const results = await Promise.allSettled(calls);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(submissions, 1);
});

test("local signer backend requires explicit approval", () => {
  assert.throws(
    () => createAgentSigner(agent, { AGENT_SIGNER_BACKEND: "local" }),
    /AGENT_LOCAL_SIGNER_APPROVED=true/,
  );
});

test("Circle signer replaces the reservation with the actual fee once confirmed, so the cap frees up", async () => {
  const signer = new CircleAgentSigner({
    agent,
    walletId: "wallet-id",
    gasCapWei: 250_000_000_000_000_000n,
    spentGasWei: 0n,
    logEvent: () => {},
    waitForReceipt: async () => ({ status: "success", gasUsed: 21_000n, effectiveGasPrice: 1_000_000_000n }),
    client: {
      estimateContractExecutionFee: async () => ({ data: { medium: { networkFee: "0.2" } } }),
      createContractExecutionTransaction: async () => ({ data: { id: "tx" } }),
      getTransaction: async () => ({ data: { transaction: { txHash: hash } } }),
    },
  });
  const call = { address: agent.address, signature: "approve(address,uint256)", args: [agent.address, 1n], label: "approval" };
  await signer.executeContractCall(call);
  assert.equal(signer.spentGasWei, 21_000_000_000_000n);
  // A second 0.2 USDC estimate fits because the first one settled at its tiny actual cost.
  await signer.executeContractCall(call);
});

test("Circle signer releases the reservation when Circle rejects the request before broadcast", async () => {
  const events = [];
  const signer = new CircleAgentSigner({
    agent,
    walletId: "wallet-id",
    gasCapWei: 250_000_000_000_000_000n,
    spentGasWei: 0n,
    logEvent: (event) => events.push(event),
    client: {
      estimateContractExecutionFee: async () => ({ data: { medium: { networkFee: "0.05" } } }),
      createContractExecutionTransaction: async () => { throw Object.assign(new Error("bad"), { response: { status: 400 } }); },
    },
  });
  await assert.rejects(signer.executeContractCall({ address: agent.address, signature: "approve(address,uint256)", args: [], label: "approval" }), /request/);
  assert.equal(signer.spentGasWei, 0n);
  assert.ok(events.some((event) => event.type === "transaction_released"));

  const timeoutSigner = new CircleAgentSigner({
    agent,
    walletId: "wallet-id",
    gasCapWei: 250_000_000_000_000_000n,
    spentGasWei: 0n,
    logEvent: () => {},
    client: {
      estimateContractExecutionFee: async () => ({ data: { medium: { networkFee: "0.05" } } }),
      createContractExecutionTransaction: async () => { throw new Error("timeout"); },
    },
  });
  await assert.rejects(timeoutSigner.executeContractCall({ address: agent.address, signature: "approve(address,uint256)", args: [], label: "approval" }), /request/);
  assert.equal(timeoutSigner.spentGasWei, 50_000_000_000_000_000n);
});

function capSigner({ roundId, spentByRound = {}, daily = 0n, events = [] }) {
  const signer = new CircleAgentSigner({
    agent,
    walletId: "wallet-id",
    gasCapWei: 1_000_000_000_000_000_000n,
    spentGasWei: daily,
    roundGasCapWei: 250_000_000_000_000_000n,
    getRoundId: () => roundId.current,
    readRoundSpent: (_agentId, id) => spentByRound[id] ?? 0n,
    logEvent: (event) => events.push(event),
    waitForReceipt: async () => ({ status: "success", gasUsed: 150_000_000_000_000_000n, effectiveGasPrice: 1n }),
    client: {
      estimateContractExecutionFee: async () => ({ data: { medium: { networkFee: "0.15" } } }),
      createContractExecutionTransaction: async () => ({ data: { id: "id" } }),
      getTransaction: async () => ({ data: { transaction: { txHash: hash } } }),
    },
  });
  return signer;
}

const callArgs = { address: agent.address, signature: "approve(address,uint256)", args: [], label: "call" };

test("gas is capped per round at 0.25 USDC and a new round gets a fresh budget", async () => {
  const roundId = { current: "8" };
  const events = [];
  const signer = capSigner({ roundId, spentByRound: { 8: 200_000_000_000_000_000n }, daily: 600_000_000_000_000_000n, events });
  await assert.rejects(signer.executeContractCall(callArgs), /0.25 USDC gas cap \(per round\)/);
  roundId.current = "9";
  await signer.executeContractCall(callArgs);
  assert.equal(events.find((event) => event.type === "transaction_attempt").roundId, "9");
});

test("the daily cap of 1 USDC still blocks an agent across rounds", async () => {
  const roundId = { current: "10" };
  const signer = capSigner({ roundId, daily: 900_000_000_000_000_000n });
  await assert.rejects(signer.executeContractCall(callArgs), /1 USDC gas cap \(daily\)/);
});

test("per-round spend is tracked across calls within one round", async () => {
  const roundId = { current: "11" };
  const signer = capSigner({ roundId });
  await signer.executeContractCall(callArgs);
  await assert.rejects(signer.executeContractCall({ ...callArgs, label: "second" }), /per round/);
});
