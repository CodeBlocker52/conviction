import test from "node:test";
import assert from "node:assert/strict";
import { shouldWaitForNextRound } from "./round-wait.mjs";

test("demo3 waits for a new round, while once and other presets can process the current one", () => {
  assert.equal(shouldWaitForNextRound(13n, 13n), true);
  assert.equal(shouldWaitForNextRound(14n, 13n), false);
  assert.equal(shouldWaitForNextRound(0n, 0n), true);
  assert.equal(shouldWaitForNextRound(13n, null), false);
});
