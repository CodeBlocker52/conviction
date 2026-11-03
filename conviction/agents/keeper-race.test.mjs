import assert from "node:assert/strict";
import test from "node:test";
import { AlreadyDoneError, revertName, sendContract } from "../contracts/script/demo-round-common.mjs";

const revert = (errorName) => ({ walk: (predicate) => (predicate({ data: { errorName } }) ? { data: { errorName } } : null), shortMessage: "reverted" });

test("revertName extracts the decoded custom error", () => {
  assert.equal(revertName(revert("AlreadyCollapsed")), "AlreadyCollapsed");
  assert.equal(revertName(new Error("plain")), undefined);
});

test("an already-done revert is not retried and is reported as AlreadyDoneError", async () => {
  let calls = 0;
  const client = { account: {}, writeContract: async () => { calls += 1; throw revert("AlreadyCollapsed"); } };
  await assert.rejects(sendContract("Collapse round 13", client, "0x0", [], "collapse", [13n], { retryMs: 1 }), AlreadyDoneError);
  assert.equal(calls, 1);
});

test("the same simulation failure five times in a row finally throws", async () => {
  let calls = 0;
  const client = { account: {}, writeContract: async () => { calls += 1; throw revert("TradingNotClosed"); } };
  await assert.rejects(sendContract("Collapse", client, "0x0", [], "collapse", [1n], { retryMs: 1 }));
  assert.equal(calls, 5);
});
