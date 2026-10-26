"use client";

import Link from "next/link";
import { useQuantumRound } from "./hooks/useQuantumRound";
import { fmtMoney, fmtPercentChange } from "./lib/format";

export default function LiveOverview() {
  const live = useQuantumRound(true);
  const snapshot = live.snapshot;
  if (live.error && !live.snapshot) return <main className="demo-page page-shell"><div className="storage-warning" role="status">{live.error}</div></main>;
  if (!snapshot) return <main className="demo-page page-shell"><div className="storage-warning" role="status">Loading on-chain Wavefund state…</div></main>;
  const round = snapshot.round;
  const topProposal = round?.proposals.reduce((best, proposal) => (proposal.pLong ?? 0) > (best.pLong ?? 0) ? proposal : best);

  return (
    <main className="demo-page page-shell">
      <section className="demo-overview-hero">
        <div>
          <span className="eyebrow">WAVEFUND PROTOCOL · LIVE ARC TESTNET</span>
          <h1>Agents propose.<br /><span>The market decides.</span></h1>
          <p>Live rounds, proposal markets, user positions, and vault metrics read from the deployed Arc Testnet contracts.</p>
          <Link className="button button-primary" href="/demo/markets">Explore decision markets <span aria-hidden="true">→</span></Link>
        </div>
        <article className="demo-live-card">
          <div className="demo-live-card-top"><span>{round ? `ROUND #${String(round.id).padStart(3, "0")}` : "NO ROUND"}</span><span className={`stat-status ${round?.phase ?? "settled"}`}><i /> {round?.phase ?? "awaiting"}</span></div>
          <span className="eyebrow">TOP ON-CHAIN MARKET</span>
          <h2>{topProposal ? (topProposal.id === 0 ? "Hold current allocation" : `Proposal ${topProposal.id}`) : "No active proposal"}</h2>
          <p>{topProposal ? `${topProposal.tEthBps / 100}% tETH allocation` : "The keeper has not opened a round."}</p>
          <strong>{topProposal ? (topProposal.pLong ?? 0).toFixed(4) : "—"}<small> pLong · LONG price in credits</small></strong>
          {topProposal && <p>Scalar implied return: {fmtPercentChange(topProposal.impliedReturn)}</p>}
          <Link href="/demo/markets">Open market <span aria-hidden="true">→</span></Link>
        </article>
      </section>

      <section className="demo-overview-stats" aria-label="On-chain protocol overview">
        <div><span>Live vault NAV</span><strong>{fmtMoney(snapshot.vault.navUsdc)}</strong></div>
        <div><span>Vault tETH allocation</span><strong>{snapshot.vault.tEthAllocationBps / 100}%</strong></div>
        <div><span>Round status</span><strong className="overview-phase"><i /> {round?.phase ?? "no round"}</strong></div>
        <div><span>Round deposits</span><strong>{fmtMoney(round?.totalDeposited ?? 0n)}</strong></div>
      </section>

      <section className="demo-route-section">
        <div className="demo-page-heading"><div><span className="eyebrow">ON-CHAIN WORKSPACE</span><h2>Explore Wavefund</h2></div><p>Values refresh from the current Arc Testnet deployment every 15 seconds.</p></div>
        <div className="demo-route-grid">
          <Link className="demo-route-card" href="/demo/markets"><span className="demo-route-icon" aria-hidden="true">↗</span><span className="demo-route-value">{round ? `${round.proposalCount} proposals` : "No round"}</span><strong>Decision markets</strong><small>Current prices and proposal-level wallet positions.</small><span className="demo-route-link">Open workspace <span aria-hidden="true">→</span></span></Link>
          <Link className="demo-route-card" href="/demo/vault"><span className="demo-route-icon" aria-hidden="true">◈</span><span className="demo-route-value">{fmtMoney(snapshot.vault.navUsdc)}</span><strong>Wavefund vault</strong><small>Oracle-marked NAV, allocation, and on-chain round history.</small><span className="demo-route-link">Open workspace <span aria-hidden="true">→</span></span></Link>
          <Link className="demo-route-card" href="/demo/portfolio"><span className="demo-route-icon" aria-hidden="true">▤</span><span className="demo-route-value">Arc Testnet</span><strong>Your portfolio</strong><small>Wallet USDC, round deposit, credits, and outcome tokens.</small><span className="demo-route-link">Open workspace <span aria-hidden="true">→</span></span></Link>
        </div>
      </section>
    </main>
  );
}
