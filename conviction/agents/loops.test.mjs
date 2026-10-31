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

test("a fatal error stops every loop and propagates", async () => {
  let stopping = false;
  const sleeps = [];
  await assert.rejects(runIndependentLoops({
    pollSeconds: 1,
    isStopping: () => stopping,
    requestStop: () => { stopping = true; },
    onError: () => {},
    sleep: async (ms) => { sleeps.push(ms); await new Promise((resolve) => setImmediate(resolve)); },
    loops: [
      { name: "A", tick: async () => { throw Object.assign(new Error("boom"), { fatal: true }); } },
      { name: "B", tick: async () => {} },
    ],
  }), /boom/);
  assert.equal(stopping, true);
});

test("a transient error backs off and the loop retries", async () => {
  let stopping = false;
  let attempts = 0;
  const errors = [];
  await runIndependentLoops({
    pollSeconds: 2,
    isStopping: () => stopping,
    requestStop: () => { stopping = true; },
    onError: (info) => errors.push(info.backoffSeconds),
    sleep: async () => {},
    loops: [{ name: "A", tick: async () => { attempts += 1; if (attempts === 1) throw new Error("flaky"); stopping = true; } }],
  });
  assert.deepEqual(errors, [2]);
  assert.equal(attempts, 2);
});
