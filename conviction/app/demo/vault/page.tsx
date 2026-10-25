"use client";

import Link from "next/link";
import DemoWorkspacePage from "../demo-workspace-page";
import { INITIAL_SHARE_PRICE, INITIAL_VAULT_TVL, proposals, useDemo } from "../../demo-context";
import LiveWorkspace from "../../live-workspace";

function money(value: number) {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function VaultPage() {
  const { demo, mode } = useDemo();
  if (mode === "live") return <main className="demo-page page-shell"><LiveWorkspace view="vault" notify={() => undefined} /></main>;
  const selectedId = demo.winningProposalId ?? demo.lastSettlement?.winningProposalId ?? 1;
  const allocation = proposals.find((proposal) => proposal.id === selectedId) ?? proposals[1];
  const tethPercent = selectedId === 1 ? 30 : selectedId === 2 ? 15 : 0;
  const usdcPercent = 100 - tethPercent;

  return (
    <DemoWorkspacePage view="vault" showHeading={false}>
        <header className="demo-page-heading demo-page-heading-primary">
          <div><span className="eyebrow">SHARED USDC FUND</span><h1>The Wavefund vault.</h1></div>
          <p>Review the fund's allocation and manage simulated vault deposits and withdrawals.</p>
        </header>
        <section className="vault-grid demo-vault-grid">
          <article className="vault-overview card-surface">
            <div className="vault-overview-top"><div><span className="eyebrow">VAULT NAV · DEMO DATA</span><h2>{money(INITIAL_VAULT_TVL + demo.vaultDeposited)}</h2><span className="vault-change">Illustrative NAV · demo deposits update at decision boundaries</span></div><span className="vault-icon" aria-hidden="true">◈</span></div>
            <div className="chart-periods"><span>1D</span><span className="period-active">1W</span><span>1M</span><span>ALL</span></div>
            <div className="vault-chart">
              <div className="chart-y-labels"><span>$286k</span><span>$284k</span><span>$282k</span><span>$280k</span></div>
              <svg viewBox="0 0 700 190" preserveAspectRatio="none" aria-label="Illustrative vault net asset value chart">
                <defs><linearGradient id="vaultFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#25b989" stopOpacity=".18" /><stop offset="100%" stopColor="#25b989" stopOpacity="0" /></linearGradient></defs>
                <path d="M0 158 C32 148 38 152 67 143 S101 146 126 132 S161 140 190 121 S224 126 254 111 S286 122 319 98 S354 109 382 89 S415 97 445 76 S478 93 506 69 S539 79 570 52 S602 70 630 40 S665 49 700 18 L700 190 L0 190Z" fill="url(#vaultFill)" />
                <path d="M0 158 C32 148 38 152 67 143 S101 146 126 132 S161 140 190 121 S224 126 254 111 S286 122 319 98 S354 109 382 89 S415 97 445 76 S478 93 506 69 S539 79 570 52 S602 70 630 40 S665 49 700 18" fill="none" stroke="#24b889" strokeWidth="3" vectorEffect="non-scaling-stroke" />
              </svg>
              <div className="chart-x-labels"><span>Oct 14</span><span>Oct 16</span><span>Oct 18</span><span>Oct 20</span><span>Today</span></div>
            </div>
            <div className="vault-chart-caption"><span><i className="legend-dot" /> Vault NAV</span><span>Illustrative demo data</span></div>
          </article>
          <article className="allocation-card card-surface">
            <div className="allocation-head"><div><span className="eyebrow">CURRENT ALLOCATION</span><h2>{allocation.allocation}</h2></div><span className="round-mini">ROUND #{String(demo.roundNumber).padStart(3, "0")}</span></div>
            <div className="allocation-donut-wrap"><div className="allocation-donut" style={{ background: `conic-gradient(#25b587 0 ${tethPercent}%, #a89af5 ${tethPercent}% 100%)` }}><div><strong>{usdcPercent}%</strong><span>USDC</span></div></div><div className="allocation-legend"><div><i className="legend-usdc" /><span>USDC</span><strong>{usdcPercent}%</strong></div><div><i className="legend-eth" /><span>tETH</span><strong>{tethPercent}%</strong></div></div></div>
            <div className="allocation-foot"><span>{allocation.name}</span><span className="demo-allocation-badge">{demo.winningProposalId !== null ? "Selected this round" : "Illustrative"}</span></div>
          </article>
        </section>
        <section className="vault-bottom-stats">
          <div><span>Your vault shares</span><strong>{demo.vaultShares.toFixed(4)}</strong><small>Value {money(demo.vaultShares * INITIAL_SHARE_PRICE)}</small></div>
          <div><span>Queued deposit</span><strong>{money(demo.queuedVaultDeposit)}</strong><small>Processes at the next decision boundary</small></div>
          <div><span>Queued withdrawal</span><strong>{demo.queuedWithdrawShares.toFixed(4)}</strong><small>Vault shares</small></div>
          <Link className="vault-history-link" href="/demo/portfolio">View portfolio <span aria-hidden="true">→</span></Link>
        </section>
    </DemoWorkspacePage>
  );
}
