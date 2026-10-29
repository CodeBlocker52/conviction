import test from "node:test";
import assert from "node:assert/strict";
import { readAgents } from "./config.mjs";

test("public agent directory contains five metadata-only entries", () => {
  const agents = readAgents();
  assert.equal(agents.length, 5);
  assert.equal(agents.filter((agent) => agent.type === "proposer").length, 3);
  assert.equal(agents.filter((agent) => agent.type === "forecaster").length, 2);
  assert.ok(agents.every((agent) => agent.address === null));
  assert.ok(agents.every((agent) => Object.keys(agent).sort().join(",") === "address,description,id,name,type"));
});
