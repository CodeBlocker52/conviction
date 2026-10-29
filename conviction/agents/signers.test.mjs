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
    waitForReceipt: async () => ({ status: "success", gasUsed: 21_000n, effectiveGasPrice: 1n }),
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
