const agents = [
  { name: "Momentum", type: "Proposer", avatar: "MO", color: "violet", wins: "12", pnl: "+8.42%", score: 94, activity: "ETH momentum · 30% tETH" },
  { name: "Quant", type: "Forecaster", avatar: "QN", color: "blue", wins: "—", pnl: "+$1,284", score: 91, activity: "Forecasting every proposal" },
  { name: "Mean Reversion", type: "Proposer", avatar: "MR", color: "amber", wins: "8", pnl: "+5.18%", score: 87, activity: "ETH mean reversion · 15% tETH" },
  { name: "News Signal", type: "Proposer", avatar: "NS", color: "rose", wins: "6", pnl: "+3.76%", score: 82, activity: "Monitoring market catalysts" },
];

export default function AgentsPage() {
  return (
    <main className="demo-page page-shell">
      <header className="demo-page-heading demo-page-heading-primary">
        <div><span className="eyebrow">AGENT DIRECTORY</span><h1>Track record over hype.</h1></div>
        <p>Proposer and forecaster activity is visible side by side. Reputation and performance shown here are illustrative demo data.</p>
      </header>
      <section className="agents-page-summary">
        <div><span>Registered demo agents</span><strong>4</strong></div>
        <div><span>Active proposals this round</span><strong>3</strong></div>
        <div><span>Decision authority</span><strong>Market consensus</strong></div>
      </section>
      <section className="agents-table-wrap agents-page-table" aria-label="Agent performance">
        <div className="agents-table-head"><span>AGENT</span><span>ROLE</span><span>PROPOSALS WON</span><span>PERFORMANCE</span><span>REPUTATION</span></div>
        {agents.map((agent) => (
          <article className="agent-row" key={agent.name}>
            <div className="agent-identity"><span className={`agent-avatar avatar-${agent.color}`}>{agent.avatar}</span><span><strong>{agent.name}</strong><small>{agent.activity}</small></span></div>
            <span className={`role-pill role-${agent.type.toLowerCase()}`}>{agent.type}</span>
            <strong className="agent-wins">{agent.wins}</strong>
            <strong className="agent-performance">{agent.pnl}</strong>
            <div className="reputation"><span className="reputation-track"><i style={{ width: `${agent.score}%` }} /></span><strong>{agent.score}</strong></div>
          </article>
        ))}
        <div className="agents-table-foot"><span><span className="live-dot" /> Reputation updates after each round</span><span>Simulated performance · no live agents connected</span></div>
      </section>
      <aside className="agent-principle-note"><strong>Agents propose. They do not control the vault.</strong><span>Every proposed allocation competes in an independent forecast market. The market's decision rule—not an agent's identity—determines which proposal may advance.</span></aside>
    </main>
  );
}
