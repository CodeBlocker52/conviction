import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isAddress } from "viem";

export const agentsPath = fileURLToPath(new URL("./agents.json", import.meta.url));

export function readAgents(path = agentsPath) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed.agents) || parsed.agents.length !== 5) {
    throw new Error("agents.json must contain exactly five agent entries.");
  }
  const seenNames = new Set();
  const roleCounts = { proposer: 0, forecaster: 0 };
  for (const agent of parsed.agents) {
    if (Object.keys(agent).some((key) => !["address", "name", "type", "description"].includes(key))) {
      throw new Error("agents.json may contain only address, name, type, and description.");
    }
    if (
      typeof agent.name !== "string"
      || !agent.name.trim()
      || !["proposer", "forecaster"].includes(agent.type)
      || typeof agent.description !== "string"
      || !agent.description.trim()
      || agent.description.includes("\n")
    ) {
      throw new Error("Every agent needs a name, supported type, and one-line description.");
    }
    if (seenNames.has(agent.name)) throw new Error(`Duplicate agent name: ${agent.name}.`);
    seenNames.add(agent.name);
    roleCounts[agent.type] += 1;
    if (agent.address !== null && (typeof agent.address !== "string" || !isAddress(agent.address))) {
      throw new Error(`Agent ${agent.name} has an invalid public address.`);
    }
  }
  if (roleCounts.proposer !== 3 || roleCounts.forecaster !== 2) {
    throw new Error("agents.json must contain three proposers and two forecasters.");
  }
  return parsed.agents.map((agent) => ({ ...agent, id: agentSlug(agent.name) }));
}

export function agentSlug(name) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function circleWalletIdEnvKey(agent) {
  return `AGENT_${agent.id}_CIRCLE_WALLET_ID`;
}

export function walletSetupIsComplete(agents, env) {
  return agents.length === 5 && agents.every((agent) =>
    typeof agent.address === "string" && Boolean(env[circleWalletIdEnvKey(agent)]),
  );
}

export function localPrivateKeyEnvKey(agent) {
  return `AGENT_${agent.id}_PRIVATE_KEY`;
}
