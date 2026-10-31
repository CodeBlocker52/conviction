import test from "node:test";
import assert from "node:assert/strict";
import { nextAgentEvaluation } from "./scheduler.mjs";

const proposer = { type: "proposer" };
const forecaster = { type: "forecaster" };
const round = { tradingEnd: 1_000, settled: false, cancelled: false };

test("proposers schedule one early evaluation per round", () => {
  const first = nextAgentEvaluation(proposer, round, 900);
  assert.equal(first.cadence, "early");
  assert.equal(nextAgentEvaluation(proposer, round, 901, first.nextState), null);
});

test("forecasters schedule every 15 s, then every 10 s in the final TWAP window", () => {
  const first = nextAgentEvaluation(forecaster, round, 900);
  assert.equal(first.cadence, "periodic");
  assert.equal(nextAgentEvaluation(forecaster, round, 910, first.nextState), null);
  const final = nextAgentEvaluation(forecaster, round, 940, first.nextState);
  assert.equal(final.cadence, "final-window");
  assert.equal(nextAgentEvaluation(forecaster, round, 949, final.nextState), null);
  const next = nextAgentEvaluation(forecaster, round, 950, final.nextState);
  assert.equal(next.cadence, "final-window");
  assert.equal(nextAgentEvaluation(forecaster, round, 960, next.nextState).cadence, "final-window");
});

test("closed rounds and rounds past trading end are not scheduled", () => {
  assert.equal(nextAgentEvaluation(proposer, { ...round, collapsed: true }, 900), null);
  assert.equal(nextAgentEvaluation(proposer, { ...round, settled: true }, 900), null);
  assert.equal(nextAgentEvaluation(forecaster, round, 1_000), null);
});
