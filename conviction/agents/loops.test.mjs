import test from "node:test";
import assert from "node:assert/strict";
import { runIndependentLoops } from "./loops.mjs";

test("the Guardian loop acts while a Quant transaction is still pending", async () => {
  const events = [];
  let releaseQuant;
  const quantPending = new Promise((resolve) => { releaseQuant = resolve; });
  let stopping = false;
  const run = runIndependentLoops({
    pollSeconds: 5,
    once: true,
    isStopping: () => stopping,
    requestStop: () => { stopping = true; },
    onError: () => {},
    loops: [
      { name: "Quant", tick: async () => { events.push("quant-submitted"); await quantPending; events.push("quant-confirmed"); } },
      { name: "Guardian", tick: async () => { events.push("guardian-traded"); releaseQuant(); } },
    ],
  });
  await run;
  assert.deepEqual(events, ["quant-submitted", "guardian-traded", "quant-confirmed"]);
});

test("a fatal agent failure pauses only that loop", async () => {
  let stopping = false;
  const paused = [];
  let healthyTicks = 0;
  await runIndependentLoops({
    pollSeconds: 1,
    isStopping: () => stopping,
    onError: () => {},
    onFatal: (info) => paused.push(info.name),
    sleep: async () => { await new Promise((resolve) => setImmediate(resolve)); },
    loops: [
      { name: "A", tick: async () => { throw Object.assign(new Error("boom"), { fatal: true }); } },
      { name: "B", tick: async () => { healthyTicks += 1; if (healthyTicks === 2) stopping = true; } },
    ],
  });
  assert.deepEqual(paused, ["A"]);
  assert.equal(healthyTicks, 2);
});

test("a Circle fee estimate failure backs off while proposer continues", async () => {
  let stopping = false;
  let attempts = 0;
  let proposerTicks = 0;
  const errors = [];
  await runIndependentLoops({
    pollSeconds: 2,
    isStopping: () => stopping,
    onError: (info) => errors.push(info.backoffSeconds),
    onFatal: () => assert.fail("safe fee-estimation failure should retry"),
    sleep: async () => { await new Promise((resolve) => setImmediate(resolve)); },
    loops: [
      { name: "Quant", tick: async () => { attempts += 1; if (attempts === 1) throw new Error("Circle fee estimate failed before submission"); stopping = true; } },
      { name: "proposers", tick: async () => { proposerTicks += 1; } },
    ],
  });
  assert.deepEqual(errors, [2]);
  assert.equal(attempts, 2);
  assert.ok(proposerTicks > 0);
});
