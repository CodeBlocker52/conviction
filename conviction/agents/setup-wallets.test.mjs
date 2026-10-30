import test from "node:test";
import assert from "node:assert/strict";
import { circleWalletIdEnvKey, walletSetupIsComplete } from "./config.mjs";

const agents = [
  "MOMENTUM",
  "MEAN_REVERSION",
  "NEWS",
  "QUANT",
  "GUARDIAN",
].map((id) => ({
  id,
  address: `0x${id.length.toString(16).padStart(40, "0")}`,
}));

test("completed wallet setup is recognized without provisioning or rewriting wallet IDs", () => {
  const env = Object.fromEntries(agents.map((agent) => [circleWalletIdEnvKey(agent), `wallet-id-${agent.id}`]));
  const before = structuredClone(env);
  assert.equal(walletSetupIsComplete(agents, env), true);
  assert.deepEqual(env, before);
});

test("partial wallet configuration is not treated as a completed setup", () => {
  const env = Object.fromEntries(agents.map((agent) => [circleWalletIdEnvKey(agent), `wallet-id-${agent.id}`]));
  delete env[circleWalletIdEnvKey(agents[4])];
  assert.equal(walletSetupIsComplete(agents, env), false);
  assert.equal(walletSetupIsComplete(agents.slice(0, 4), env), false);
});
