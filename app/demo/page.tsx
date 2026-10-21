"use client";

import Link from "next/link";
import { INITIAL_VAULT_TVL, proposals, useDemo } from "../demo-context";

function money(value: number) {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function DemoOverviewPage() {
  const { demo } = useDemo();
  const bestProposal = proposals
    .filter((proposal) => proposal.id !== 0)
    .reduce((best, proposal) => (
      (demo.marketPrices[proposal.id] ?? proposal.price) > (demo.marketPrices[best.id] ?? best.price)
        ? proposal
        : best
    ), proposals[1]);
  const routes = [
    { href: "/demo/markets", label: "Decision markets", detail: "Compare proposals, forecast outcomes, and trade LONG or SHORT.", value: "Markets", icon: "↗" },
    { href: "/demo/vault", label: "Wavefund vault", detail: "Review the fund allocation and manage queued deposits or withdrawals.", value: money(INITIAL_VAULT_TVL + demo.vaultDeposited), icon: "◈" },
    { href: "/demo/portfolio", label: "Your portfolio", detail: "Track simulated wallet balances, forecast credits, and market positions.", value: "View account", icon: "▤" },
    { href: "/demo/agents", label: "Agents", detail: "Compare proposer and forecaster records in the current demo.", value: "4 agents", icon: "✳" },
  ];

  return (
    <main className="demo-page page-shell">
      <section className="demo-overview-hero">
        <div>
          <span className="eyebrow">WAVEFUND PROTOCOL · LOCAL DEMO</span>
          <h1>Agents propose.<br /><span>The market decides.</span></h1>
          <p>Explore a fund where autonomous agents propose allocations, forecasters evaluate each idea, and the strongest signal guides the vault.</p>
          <Link className="button button-primary" href="/demo/markets">Explore decision markets <span aria-hidden="true">→</span></Link>
        </div>
        <article className="demo-live-card">
          <div className="demo-live-card-top"><span>ROUND #{String(demo.roundNumber).padStart(3, "0")}</span><span className={`stat-status ${demo.phase}`}><i /> {demo.phase}</span></div>
          <span className="eyebrow">TOP MARKET FORECAST</span>
          <h2>{bestProposal.name}</h2>
          <p>{bestProposal.allocation}</p>
          <strong>{(demo.marketPrices[bestProposal.id] ?? bestProposal.price).toFixed(1)}<small>¢ LONG</small></strong>
          <Link href="/demo/markets">Open market <span aria-hidden="true">→</span></Link>
        </article>
      </section>

      <section className="demo-overview-stats" aria-label="Protocol overview">
        <div><span>Demo vault TVL</span><strong>{money(INITIAL_VAULT_TVL + demo.vaultDeposited)}</strong></div>
        <div><span>Your simulated USDC</span><strong>{money(demo.demoUSDC)}</strong></div>
        <div><span>Forecast deposit</span><strong>{money(demo.forecastDeposit)}</strong></div>
        <div><span>Round status</span><strong className="overview-phase"><i /> {demo.phase}</strong></div>
      </section>

      <section className="demo-route-section">
        <div className="demo-page-heading">
          <div><span className="eyebrow">PROTOCOL WORKSPACE</span><h2>Explore Wavefund</h2></div>
          <p>Each part of the protocol has its own workspace. Your simulated account state is shared across them.</p>
        </div>
        <div className="demo-route-grid">
          {routes.map((route) => (
            <Link className="demo-route-card" href={route.href} key={route.href}>
              <span className="demo-route-icon" aria-hidden="true">{route.icon}</span>
              <span className="demo-route-value">{route.value}</span>
              <strong>{route.label}</strong>
              <small>{route.detail}</small>
              <span className="demo-route-link">Open workspace <span aria-hidden="true">→</span></span>
            </Link>
          ))}
          <Link className="demo-route-card demo-route-card-muted" href="/demo/how-it-works">
            <span className="demo-route-icon" aria-hidden="true">◎</span>
            <span className="demo-route-value">MECHANISM</span>
            <strong>How it works</strong>
            <small>Follow the round lifecycle from agent proposals through market selection and settlement.</small>
            <span className="demo-route-link">Understand the flow <span aria-hidden="true">→</span></span>
          </Link>
        </div>
      </section>
      <p className="demo-page-disclaimer">This is a frontend simulation. Balances, markets, oracle results, and transactions are not on-chain.</p>
    </main>
  );
}
