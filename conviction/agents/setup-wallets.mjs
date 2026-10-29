import { randomUUID } from "node:crypto";
import { chmodSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isAddress } from "viem";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { agentsPath, circleWalletIdEnvKey, readAgents } from "./config.mjs";

const envPath = fileURLToPath(new URL("../.env", import.meta.url));
let envText = readFileSync(envPath, "utf8");
const env = { ...process.env };
const agents = readAgents();
const walletSetIdKey = "AGENT_CIRCLE_WALLET_SET_ID";
const walletSetIdempotencyKey = "AGENT_CIRCLE_WALLET_SET_IDEMPOTENCY_KEY";
const walletsIdempotencyKey = "AGENT_CIRCLE_WALLETS_IDEMPOTENCY_KEY";

if (!env.CIRCLE_API_KEY || !env.CIRCLE_ENTITY_SECRET) {
  throw new Error("Set CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET in .env before provisioning Circle wallets.");
}
const walletIdsConfigured = agents.filter((agent) => env[circleWalletIdEnvKey(agent)]).length;
const fullyConfigured = agents.every((agent) => agent.address && env[circleWalletIdEnvKey(agent)]);
if (fullyConfigured) {
  console.log("All five agent Circle wallets are already configured:");
  for (const agent of agents) console.log(`${agent.name}: ${agent.address}`);
  process.exit(0);
}
if (
  (agents.some((agent) => agent.address) || walletIdsConfigured > 0)
  && !env[walletsIdempotencyKey]
) {
  throw new Error("Partial agent wallet configuration detected; inspect agents.json and .env before provisioning.");
}

function persistEnv(updates) {
  const lines = envText.split(/\r?\n/);
  const handled = new Set();
  const output = [];
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match || !(match[1] in updates)) {
      output.push(line);
      continue;
    }
    const key = match[1];
    if (!handled.has(key) && updates[key] !== null) output.push(`${key}=${updates[key]}`);
    handled.add(key);
  }
  for (const [key, value] of Object.entries(updates)) {
    if (!handled.has(key) && value !== null) output.push(`${key}=${value}`);
  }
  const updatedText = `${output.join("\n").trimEnd()}\n`;
  const temporaryPath = `${envPath}.tmp`;
  writeFileSync(temporaryPath, updatedText, { encoding: "utf8", mode: 0o600 });
  chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, envPath);
  envText = updatedText;
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) delete env[key];
    else env[key] = value;
  }
}

function persistAgents(nextAgents) {
  const temporaryPath = `${agentsPath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify({ agents: nextAgents }, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, agentsPath);
}

function sanitizedFailure(operation) {
  return new Error(`Circle ${operation} failed; credentials and request details were withheld.`);
}

const client = initiateDeveloperControlledWalletsClient({
  apiKey: env.CIRCLE_API_KEY,
  entitySecret: env.CIRCLE_ENTITY_SECRET,
});
let walletSetId = env[walletSetIdKey];
if (walletSetId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(walletSetId)) {
  throw new Error("AGENT_CIRCLE_WALLET_SET_ID is invalid; inspect .env before provisioning.");
}
if (!walletSetId) {
  const idempotencyKey = env[walletSetIdempotencyKey] ?? randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
    throw new Error("Saved wallet-set idempotency key is invalid; inspect .env before provisioning.");
  }
  if (!env[walletSetIdempotencyKey]) persistEnv({ [walletSetIdempotencyKey]: idempotencyKey });
  let response;
  try {
    response = await client.createWalletSet({
      name: "Wavefund Agents",
      idempotencyKey,
    });
  } catch {
    throw sanitizedFailure("wallet set creation");
  }
  walletSetId = response.data?.walletSet?.id;
  if (typeof walletSetId !== "string" || !walletSetId) {
    throw new Error("Circle returned no wallet set ID; rerun setup to resume using the saved idempotency key.");
  }
  persistEnv({ [walletSetIdKey]: walletSetId, [walletSetIdempotencyKey]: null });
}

const walletIdempotencyKey = env[walletsIdempotencyKey] ?? randomUUID();
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(walletIdempotencyKey)) {
  throw new Error("Saved wallet idempotency key is invalid; inspect .env before provisioning.");
}
if (!env[walletsIdempotencyKey]) persistEnv({ [walletsIdempotencyKey]: walletIdempotencyKey });
let response;
try {
  response = await client.createWallets({
    accountType: "EOA",
    blockchains: ["ARC-TESTNET"],
    count: agents.length,
    metadata: agents.map((agent) => ({ name: agent.name, refId: agent.id })),
    walletSetId,
    idempotencyKey: walletIdempotencyKey,
  });
} catch {
  throw sanitizedFailure("wallet creation");
}

const wallets = response.data?.wallets;
if (!Array.isArray(wallets) || wallets.length !== agents.length) {
  throw new Error("Circle returned an unexpected wallet count; setup stopped without funding any wallet.");
}
const haveRefIds = wallets.every((wallet) => typeof wallet.refId === "string" && wallet.refId);
const walletsByRefId = haveRefIds ? new Map(wallets.map((wallet) => [wallet.refId, wallet])) : null;
if (walletsByRefId && walletsByRefId.size !== agents.length) {
  throw new Error("Circle returned duplicate agent references; setup stopped without updating agents.json.");
}
const orderedWallets = haveRefIds
  ? agents.map((agent) => walletsByRefId.get(agent.id))
  : wallets;
const newAgents = agents.map((agent, index) => {
  const wallet = orderedWallets[index];
  if (
    !wallet
    || typeof wallet.id !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(wallet.id)
    || typeof wallet.address !== "string"
    || !isAddress(wallet.address)
    || (wallet.refId && wallet.refId !== agent.id)
    || (wallet.name && wallet.name !== agent.name)
  ) {
    throw new Error(`Circle returned an invalid wallet for ${agent.name}; inspect Circle before retrying.`);
  }
  return { address: wallet.address, name: agent.name, type: agent.type, description: agent.description };
});

const walletIdUpdates = Object.fromEntries(
  orderedWallets.map((wallet, index) => [circleWalletIdEnvKey(agents[index]), wallet.id]),
);
persistEnv(walletIdUpdates);
persistAgents(newAgents);
persistEnv({ [walletsIdempotencyKey]: null });

console.log("Created five unfunded Arc Testnet agent EOAs. Public addresses:");
for (const agent of newAgents) console.log(`${agent.name}: ${agent.address}`);
