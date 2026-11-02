import type { Address } from "viem";
import agentsConfig from "../../agents/agents.json";

export type AgentType = "proposer" | "forecaster";
export type AgentProfile = { address: Address; name: string; type: AgentType; description: string };

export const agentProfiles = agentsConfig.agents as AgentProfile[];

export const agentTypeLabel = (type: AgentType) => (type === "proposer" ? "Proposer agent" : "Forecaster agent");

export function findAgent(address: string): AgentProfile | undefined {
  return agentProfiles.find((agent) => agent.address.toLowerCase() === address.toLowerCase());
}
