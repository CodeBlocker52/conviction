"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { addresses, proposerRegistryAbi, publicClient } from "./lib/contracts";
import { explorerAddress, fetchLogs } from "./lib/explorer";
import { fmtPercentChange, fmtUsdc } from "./lib/format";
import { aggregateAgentEvents, type AgentEventStats } from "./lib/agent-stats";
import { agentProfiles, agentTypeLabel, type AgentProfile } from "./lib/agents";

type AgentRow = AgentProfile & AgentEventStats & {
  registered: boolean;
  active: boolean;
  proposals: number;
  wins: number;
  averageReturnPct: number | null;
};

// Every number comes from chain data the deployed site can read: the ProposerRegistry (via RPC) and QuantumRound
// events (via the explorer's indexed logs). Agents are listed from agents.json, whether or not they have acted yet.
async function loadAgents(): Promise<AgentRow[]> {
  const logs = await fetchLogs(addresses.quantumRound, 60);
  return Promise.all(agentProfiles.map(async (profile) => {
    const events = aggregateAgentEvents(logs, profile.address);
    const agent = await publicClient.readContract({
      address: addresses.proposerRegistry, abi: proposerRegistryAbi, functionName: "agents", args: [profile.address as Address],
    });
    const wins = Number(agent[4]);
    return {
      ...profile,
      ...events,
      registered: agent[0] !== "",
      active: agent[2],
      proposals: Number(agent[3]),
      wins,
      // cumulativeReturn sums the 1e18-scaled gross return of each win (1.0 = flat).
      averageReturnPct: wins === 0 ? null : (Number(agent[5]) / wins / 1e18 - 1) * 100,
    };
  }));
}

const signedUsdc = (units: bigint) => `${units > 0n ? "+" : units < 0n ? "-" : ""}${fmtUsdc(units < 0n ? -units : units)} USDC`;

function AgentCard({ agent }: { agent: AgentRow }) {
  const isProposer = agent.type === "proposer";
  const isGuardian = agent.name === "Guardian";
  return (
    <article className="agent-card">
      <div className="agent-card-head">
        <div className="agent-identity"><span className="agent-avatar avatar-violet">{agent.name.slice(0, 2).toUpperCase()}</span><span><strong>{agent.name}</strong><small><a href={explorerAddress(agent.address)} target="_blank" rel="noreferrer">{agent.address}</a></small></span></div>
        <span className={`role-pill ${isProposer ? "role-proposer" : "role-forecaster"}`}>{agentTypeLabel(agent.type)}</span>
        <span className="role-pill circle-pill">Circle wallet</span>
      </div>
      <p className="agent-card-description">{agent.description}</p>
      <div className="agent-card-stats">
        {isProposer ? (
          <>
            <div><span>Proposals made</span><strong>{agent.proposals}</strong></div>
            <div><span>Rounds won</span><strong>{agent.wins}</strong></div>
            <div><span>Avg winning return</span><strong>{fmtPercentChange(agent.averageReturnPct)}</strong></div>
          </>
        ) : (
          <>
            <div><span>Forecasting P&amp;L</span><strong>{agent.settledRounds === 0 ? "n/a" : signedUsdc(agent.pnlUnits)}</strong></div>
            <div><span>Settled rounds</span><strong>{agent.settledRounds}</strong></div>
            <div><span>{isGuardian ? "Guardian interventions" : "Trades"}</span><strong>{agent.trades}</strong></div>
          </>
        )}
      </div>
      {isProposer ? (
        <blockquote className="agent-rationale">
          <span>LATEST RATIONALE{agent.latestRationale ? ` · ROUND ${agent.latestRationale.roundId} · ${agent.latestRationale.tEthBps / 100}% tETH` : ""}</span>
          {agent.latestRationale ? agent.latestRationale.text : "This agent has not proposed on-chain yet."}
        </blockquote>
      ) : (
        <p className="agent-rationale-note">{isGuardian ? "Interventions are the Guardian's on-chain trades: it trades only when a proposal's price deviates from fair value beyond its threshold." : "The Quant trades toward its fair-value estimate; its trades are on-chain."} P&amp;L counts rounds the agent has redeemed, from Deposited and Redeemed events, before gas.</p>
      )}
    </article>
  );
}

export default function LiveAgents() {
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const load = (attempt: number) => {
      loadAgents()
        .then((rows) => { if (active) { setAgents(rows); setError(""); } })
        .catch(() => {
          if (!active) return;
          setError("Could not read agent stats from the chain right now. Retrying shortly.");
          timer = window.setTimeout(() => load(attempt + 1), Math.min(60_000, 5_000 * 2 ** attempt));
        });
    };
    load(0);
    return () => { active = false; window.clearTimeout(timer); };
  }, []);

  const proposers = agents?.filter((agent) => agent.type === "proposer") ?? [];
  const totalProposals = proposers.reduce((sum, agent) => sum + agent.proposals, 0);
  const totalWins = proposers.reduce((sum, agent) => sum + agent.wins, 0);

  return (
    <main className="demo-page page-shell">
      <header className="demo-page-heading demo-page-heading-primary">
        <div><span className="eyebrow">AGENT DIRECTORY · LIVE</span><h1>Track record over hype.</h1></div>
        <p>Three proposer agents and two forecaster agents, each with its own Circle developer-controlled wallet. Stats are read from the ProposerRegistry and QuantumRound events on Arc Testnet.</p>
      </header>
      {error && !agents && <div className="storage-warning" role="status">{error}</div>}
      {!agents && !error && <div className="storage-warning" role="status">Loading agent stats from the chain…</div>}
      {agents && (
        <>
          <section className="agents-page-summary">
            <div><span>Agents</span><strong>{agents.length}</strong></div>
            <div><span>Proposals made</span><strong>{totalProposals}</strong></div>
            <div><span>Rounds won by proposers</span><strong>{totalWins}</strong></div>
          </section>
          <section className="agent-card-list" aria-label="Agents">
            {agents.map((agent) => <AgentCard agent={agent} key={agent.address} />)}
            <div className="agents-table-foot"><span><span className="live-dot" /> ProposerRegistry and QuantumRound events, Arc Testnet</span><span>Return = realised vault return of rounds the proposer won</span></div>
          </section>
        </>
      )}
    </main>
  );
}
