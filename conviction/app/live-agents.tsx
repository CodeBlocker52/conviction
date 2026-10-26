"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { addresses, proposerRegistryAbi, publicClient } from "./lib/contracts";
import { explorerAddress, fetchLogs } from "./lib/explorer";
import { fmtPercentChange, shortAddress } from "./lib/format";

type AgentRow = {
  address: Address;
  name: string;
  active: boolean;
  proposals: number;
  wins: number;
  averageReturnPct: number | null;
};

async function loadAgents(): Promise<AgentRow[]> {
  const logs = await fetchLogs(addresses.proposerRegistry, 10);
  const registered = [...new Set(logs.filter((log) => log.name === "AgentRegistered").map((log) => log.params.agent as Address))];
  return Promise.all(registered.map(async (address) => {
    const agent = await publicClient.readContract({
      address: addresses.proposerRegistry, abi: proposerRegistryAbi, functionName: "agents", args: [address],
    });
    const wins = Number(agent[4]);
    return {
      address,
      name: agent[0] || shortAddress(address),
      active: agent[2],
      proposals: Number(agent[3]),
      wins,
      // cumulativeReturn sums the 1e18-scaled gross return of each win (1.0 = flat).
      averageReturnPct: wins === 0 ? null : (Number(agent[5]) / wins / 1e18 - 1) * 100,
    };
  }));
}

export default function LiveAgents() {
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    loadAgents()
      .then((rows) => { if (active) setAgents(rows); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Could not read the proposer registry."); });
    return () => { active = false; };
  }, []);

  const totalProposals = agents?.reduce((sum, agent) => sum + agent.proposals, 0) ?? 0;
  const totalWins = agents?.reduce((sum, agent) => sum + agent.wins, 0) ?? 0;

  return (
    <main className="demo-page page-shell">
      <header className="demo-page-heading demo-page-heading-primary">
        <div><span className="eyebrow">AGENT DIRECTORY · LIVE</span><h1>Track record over hype.</h1></div>
        <p>Registered proposers and their on-chain record, read from the ProposerRegistry. Until the AI agents are connected, the registered proposers are the deployer and keeper wallets.</p>
      </header>
      {error && <div className="storage-warning" role="alert">{error}</div>}
      {!agents && !error && <div className="storage-warning" role="status">Loading registered proposers…</div>}
      {agents && (
        <>
          <section className="agents-page-summary">
            <div><span>Registered proposers</span><strong>{agents.length}</strong></div>
            <div><span>Proposals made</span><strong>{totalProposals}</strong></div>
            <div><span>Rounds won by proposers</span><strong>{totalWins}</strong></div>
          </section>
          <section className="agents-table-wrap agents-page-table" aria-label="Registered proposers">
            <div className="agents-table-head"><span>PROPOSER</span><span>STATUS</span><span>PROPOSALS MADE</span><span>ROUNDS WON</span><span>AVG WINNING RETURN</span></div>
            {agents.length === 0 && <p>No proposers are registered yet.</p>}
            {agents.map((agent) => (
              <article className="agent-row" key={agent.address}>
                <div className="agent-identity"><span className="agent-avatar avatar-violet">{agent.name.slice(0, 2).toUpperCase()}</span><span><strong>{agent.name}</strong><small><a href={explorerAddress(agent.address)} target="_blank" rel="noreferrer">{agent.address}</a></small></span></div>
                <span className="role-pill role-proposer">{agent.active ? "Active" : "Inactive"}</span>
                <strong className="agent-wins">{agent.proposals}</strong>
                <strong className="agent-wins">{agent.wins}</strong>
                <strong className="agent-performance">{fmtPercentChange(agent.averageReturnPct)}</strong>
              </article>
            ))}
            <div className="agents-table-foot"><span><span className="live-dot" /> Read from the ProposerRegistry on Arc Testnet</span><span>Return = realised vault return of rounds the proposer won</span></div>
          </section>
        </>
      )}
    </main>
  );
}
