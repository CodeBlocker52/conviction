"use client";

import { useMemo, useState } from "react";
import type { DemoWorkspaceView } from "./demo-workspace";
import { addresses, arcTestnet } from "./lib/contracts";
import { toTokenAmount, toUsdc, useQuantumRound, type LiveProposal } from "./hooks/useQuantumRound";
import { useWallet } from "./hooks/useWallet";

function money(value: number) {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function amount(value: bigint) {
  return toUsdc(value).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function txError(error: unknown) {
  return error instanceof Error ? error.message : "Transaction failed.";
}

export default function LiveWorkspace({
  notify,
  view,
}: {
  notify: (message: string) => void;
  view: DemoWorkspaceView;
}) {
  const wallet = useWallet();
  const live = useQuantumRound(true);
  const snapshot = live.snapshot;
  const round = snapshot?.round ?? null;
  const [selectedId, setSelectedId] = useState(0);
  const [depositAmount, setDepositAmount] = useState("0.1");
  const [claimAmount, setClaimAmount] = useState("0.1");
  const [tradeAmount, setTradeAmount] = useState("0.1");
  const [side, setSide] = useState<"LONG" | "SHORT">("LONG");
  const proposal = round?.proposals.find((item) => item.id === selectedId) ?? round?.proposals[0] ?? null;
  const currentAllocation = snapshot?.vault.tEthAllocationBps ?? 0;
  const usdcAllocation = 10_000 - currentAllocation;
  const canTransact = Boolean(wallet.address && wallet.chainId === arcTestnet.id);

  const history = useMemo(() => snapshot?.history.slice().reverse() ?? [], [snapshot?.history]);

  async function perform(label: string, operation: () => Promise<`0x${string}`>) {
    try {
      const hash = await operation();
      notify(`${label} confirmed: ${hash}`);
    } catch (error) {
      notify(`${label} failed: ${txError(error)}`);
    }
  }

  if (live.error) {
    return <div className="storage-warning" role="alert">Live Arc reads failed: {live.error}</div>;
  }
  if (live.loading && !snapshot) {
    return <div className="storage-warning" role="status">Loading on-chain Wavefund state…</div>;
  }
  if (!snapshot) return null;

  if (view === "vault") {
    return (
      <>
        <section className="vault-grid demo-vault-grid">
          <article className="vault-overview card-surface">
            <div className="vault-overview-top">
              <div>
                <span className="eyebrow">VAULT NAV · LIVE</span>
                <h2>{money(toUsdc(snapshot.vault.navUsdc))}</h2>
                <span className="vault-change">Oracle-marked from deployed USDC and tETH balances</span>
              </div>
              <span className="vault-icon" aria-hidden="true">◈</span>
            </div>
            <div className="vault-bottom-stats">
              <div><span>USDC held</span><strong>{money(toUsdc(snapshot.vault.usdcBalance))}</strong></div>
              <div><span>tETH held</span><strong>{toTokenAmount(snapshot.vault.tEthBalance).toLocaleString(undefined, { maximumFractionDigits: 6 })}</strong></div>
              <div><span>Oracle price</span><strong>{money(toUsdc(snapshot.vault.oraclePriceUsdc))} / tETH</strong></div>
              <div><span>v4 spot price</span><strong>{money(toUsdc(snapshot.vault.spotPriceUsdc))} / tETH</strong></div>
            </div>
          </article>
          <article className="allocation-card card-surface">
            <div className="allocation-head"><div><span className="eyebrow">CURRENT ALLOCATION</span><h2>{currentAllocation / 100}% tETH · {usdcAllocation / 100}% USDC</h2></div><span className="round-mini">ROUND #{String(snapshot.roundCount).padStart(3, "0")}</span></div>
            <div className="allocation-donut-wrap">
              <div className="allocation-donut" style={{ background: `conic-gradient(#25b587 0 ${currentAllocation / 100}%, #a89af5 ${currentAllocation / 100}% 100%)` }}><div><strong>{usdcAllocation / 100}%</strong><span>USDC</span></div></div>
              <div className="allocation-legend">
                <div><i className="legend-usdc" /><span>USDC</span><strong>{usdcAllocation / 100}%</strong></div>
                <div><i className="legend-eth" /><span>tETH</span><strong>{currentAllocation / 100}%</strong></div>
              </div>
            </div>
            <div className="allocation-foot"><span>Marked at the latest oracle price</span><span className="demo-allocation-badge">LIVE</span></div>
          </article>
        </section>
        <section className="vault-flow-panel" aria-label="Vault deposit and withdrawal">
          <div className="vault-flow-copy"><span className="eyebrow">VAULT FLOWS</span><h3>Deposit into the fund</h3><p>Vault deposits open in the next contract release.</p></div>
          <div className="vault-flow-controls">
            <label className="inline-money-input"><input aria-label="Vault deposit amount in USDC" type="number" disabled placeholder="USDC" /><span>USDC</span></label>
            <button className="button button-outline" type="button" disabled>Queue deposit</button>
            <label className="inline-money-input"><input aria-label="Vault shares to withdraw" type="number" disabled placeholder="Shares to withdraw" /><span>shares</span></label>
            <button className="button button-outline" type="button" disabled>Queue withdrawal</button>
          </div>
        </section>
        <section className="positions-panel">
          <div className="positions-heading"><div><span className="eyebrow">ON-CHAIN HISTORY</span><h3>Vault decision history</h3></div></div>
          {history.length === 0 ? <p>No on-chain vault decisions have been recorded yet.</p> : history.map((item) => (
            <div className="position-row" key={item.roundId.toString()}>
              <strong>Round #{item.roundId.toString()}</strong>
              <span>Starting NAV {money(toUsdc(item.navUsdc))}</span>
              <span>{item.allocationBps === null ? "Allocation pending" : `${item.allocationBps / 100}% tETH allocation`}</span>
              <span>{item.realisedReturn === null ? item.status : `Return ${(Number(item.realisedReturn) / 1e16).toFixed(2)}% · ${item.status}`}</span>
            </div>
          ))}
        </section>
      </>
    );
  }

  if (view === "portfolio") {
    return (
      <>
        <div className="demo-account-grid">
          <article className="demo-account-card demo-account-primary"><span>WALLET USDC BALANCE</span><strong>{money(toUsdc(snapshot.usdcBalance ?? 0n))}</strong><small>Arc Testnet ERC-20 USDC</small></article>
          <article className="demo-account-card"><span>ROUND DEPOSIT</span><strong>{money(toUsdc(round?.deposit ?? 0n))}</strong><small>{round ? `Round #${round.id}` : "No open round"}</small></article>
          <article className="demo-account-card"><span>VAULT NAV</span><strong>{money(toUsdc(snapshot.vault.navUsdc))}</strong><small>Oracle-marked fund value</small></article>
          <article className="demo-account-card"><span>ROUND STATUS</span><strong>{round?.phase ?? "No round"}</strong><small>{round ? `${round.proposalCount} proposals` : "Awaiting first round"}</small></article>
        </div>
        <section className="positions-panel">
          <div className="positions-heading"><div><span className="eyebrow">ON-CHAIN POSITIONS</span><h3>Round #{round?.id.toString() ?? "—"} holdings</h3></div></div>
          {!round ? <p>No round has been opened on-chain yet.</p> : round.proposals.map((item) => (
            <div className="position-row" key={item.id}>
              <strong>Proposal {item.id}</strong>
              <span>Claimed {amount(item.claimedCredits)} credits</span>
              <span>Credit balance {amount(item.creditBalance)}</span>
              <span>LONG {amount(item.longBalance)} · SHORT {amount(item.shortBalance)}</span>
            </div>
          ))}
        </section>
      </>
    );
  }

  return (
    <>
      <div className="demo-mode-banner">
        <span className="demo-mode-icon">LIVE</span>
        <div>
          <strong>Arc Testnet on-chain mode</strong>
          <span>{wallet.address ? `Connected ${wallet.address}` : "Connect an Arc Testnet wallet to transact"} · reads refresh every 15 seconds</span>
        </div>
        <span>{round ? `Round #${round.id} · ${round.phase}` : "No round opened"}</span>
      </div>
      {live.loading && <div className="storage-warning" role="status">Refreshing deployed contract state…</div>}
      {!round ? (
        <section className="round-action-panel"><div className="round-action-copy"><span className="phase-kicker"><i /> ON-CHAIN MARKETS</span><h3>No round is open yet</h3><p>Proposal markets and positions will appear here when the keeper opens a round.</p></div></section>
      ) : (
        <>
          {round.phase === "trading" && (
            <section className="round-action-panel" aria-label="Live round actions">
              <div className="round-action-copy"><span className="phase-kicker"><i /> ROUND #{String(round.id).padStart(3, "0")} · TRADING OPEN</span><h3>Forecast on-chain</h3><p>Deposit USDC once, claim proposal credits, and trade the live LONG or SHORT markets.</p></div>
              <div className="forecast-deposit-action">
                <label htmlFor="live-deposit">Forecasting deposit</label>
                <div className="inline-money-input"><span>$</span><input id="live-deposit" type="number" min="0.000001" step="0.1" value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} /><span>USDC</span></div>
                <button className="button button-primary" type="button" disabled={!canTransact} onClick={() => perform("Deposit", () => live.deposit(round.id, depositAmount))}>Deposit to round</button>
              </div>
            </section>
          )}
          {round.phase === "evaluation" && !round.collapsed && (
            <section className="round-action-panel" aria-label="Collapse live round">
              <div className="round-action-copy"><span className="phase-kicker phase-evaluation"><i /> ROUND #{String(round.id).padStart(3, "0")} · TRADING CLOSED</span><h3>Collapse the decision market</h3><p>Anyone may submit the final TWAP comparison after the trading window ends.</p></div>
              <button className="button button-dark" type="button" disabled={!canTransact} onClick={() => perform("Collapse", () => live.collapse(round.id))}>Collapse round <span>→</span></button>
            </section>
          )}
          {round.phase === "settled" && round.deposit > 0n && (
            <section className="round-action-panel settled-panel">
              <div className="round-action-copy"><span className="phase-kicker phase-settled"><i /> ROUND #{String(round.id).padStart(3, "0")} · SETTLED</span><h3>Redeem your round deposit</h3><p>Your payout is computed by the deployed QuantumRound contract.</p></div>
              <button className="button button-primary" type="button" disabled={!canTransact} onClick={() => perform("Redeem", () => live.redeem(round.id))}>Redeem USDC <span>→</span></button>
            </section>
          )}
          <div className="demo-market-layout">
            <div className="demo-markets-column">
              <div className="subsection-heading"><div><span className="eyebrow">ROUND #{String(round.id).padStart(3, "0")} MARKETS</span><h3>Choose a proposal to forecast</h3></div><span className={`round-phase-pill ${round.phase}`}><i /> {round.phase}</span></div>
              <div className="demo-proposal-list">
                {round.proposals.map((item) => (
                  <LiveProposalCard key={item.id} proposal={item} selected={item.id === (proposal?.id ?? selectedId)} onSelect={() => setSelectedId(item.id)} />
                ))}
              </div>
            </div>
            {proposal && (
              <aside className="demo-trade-ticket" aria-label="On-chain forecasting trade controls">
                <div className="ticket-header"><div><span className="eyebrow">ON-CHAIN MARKET</span><h3>Proposal {proposal.id}</h3></div><span className="ticket-avatar avatar-violet">WF</span></div>
                <p className="ticket-allocation">{proposal.tEthBps / 100}% tETH · {100 - proposal.tEthBps / 100}% USDC</p>
                <p className="ticket-rationale">{proposal.rationale || "No proposal rationale was published."}</p>
                <div className="ticket-prices"><div><span>LONG / credit ratio</span><strong>{proposal.longPrice.toFixed(4)}×</strong></div><div><span>SHORT mint rate</span><strong>1:1</strong></div></div>
                {round.phase === "trading" ? (
                  <>
                    <div className="credit-claim-box">
                      <div><strong>Claim proposal credits</strong><span>Unclaimed round limit {amount(round.remainingCredits)}</span></div>
                      <div className="inline-money-input"><input aria-label="Credits to claim" type="number" min="0.000001" step="0.1" value={claimAmount} onChange={(event) => setClaimAmount(event.target.value)} /><span>credits</span></div>
                      <div className="credit-claim-status"><span>Claimed {amount(proposal.claimedCredits)}</span></div>
                      <button className="button button-outline" type="button" disabled={!canTransact || round.remainingCredits === 0n} onClick={() => perform("Claim credits", () => live.claimCredits(round.id, proposal.id, claimAmount))}>Claim credits for this proposal</button>
                    </div>
                    <div className="ticket-side-toggle" role="group" aria-label="Outcome token">
                      <button type="button" className={side === "LONG" ? "active long" : ""} onClick={() => setSide("LONG")}>LONG <span>↑</span></button>
                      <button type="button" className={side === "SHORT" ? "active short" : ""} onClick={() => setSide("SHORT")}>SHORT <span>↓</span></button>
                    </div>
                    <label className="ticket-label" htmlFor="live-trade-size"><span>Trade amount</span><span>{amount(proposal.creditBalance)} credits available</span></label>
                    <div className="inline-money-input trade-size-input"><input id="live-trade-size" type="number" min="0.000001" step="0.1" value={tradeAmount} onChange={(event) => setTradeAmount(event.target.value)} /><span>USDC units</span></div>
                    <button className="button button-primary ticket-trade-button" type="button" disabled={!canTransact || proposal.creditBalance === 0n} onClick={() => perform(`Buy ${side}`, () => live.trade(round.id, proposal, side, tradeAmount, "buy"))}>Buy {side} shares <span>→</span></button>
                    {(side === "LONG" ? proposal.longBalance : proposal.shortBalance) > 0n && (
                      <button className="button button-outline ticket-trade-button" type="button" disabled={!canTransact} onClick={() => perform(`Sell ${side}`, () => live.trade(round.id, proposal, side, tradeAmount, "sell"))}>Sell {side} position</button>
                    )}
                  </>
                ) : (
                  <div className="ticket-closed"><strong>{round.phase === "evaluation" ? "Market closed · awaiting oracle result" : "This round has settled"}</strong><span>On-chain positions: LONG {amount(proposal.longBalance)} · SHORT {amount(proposal.shortBalance)}</span></div>
                )}
              </aside>
            )}
          </div>
        </>
      )}
      <LiveVaultMetrics nav={snapshot.vault.navUsdc} tEthAllocationBps={currentAllocation} />
    </>
  );
}

function LiveProposalCard({
  proposal,
  selected,
  onSelect,
}: {
  proposal: LiveProposal;
  selected: boolean;
  onSelect: () => void;
}) {
  const longPrice = proposal.longPrice;
  return (
    <button className={`demo-proposal-card ${selected ? "selected" : ""}`} type="button" onClick={onSelect} aria-pressed={selected}>
      <div className="demo-proposal-top">
        <span className="proposal-avatar avatar-violet">{proposal.id === 0 ? "WF" : `P${proposal.id}`}</span>
        <span className="demo-proposal-name"><strong>{proposal.id === 0 ? "Hold current allocation" : `Proposal ${proposal.id}`}</strong><small>{proposal.tEthBps / 100}% tETH · proposer {proposal.proposer.slice(0, 6)}…{proposal.proposer.slice(-4)}</small></span>
        {proposal.id === 0 && <span className="status-quo">STATUS QUO</span>}
      </div>
      <div className="demo-proposal-bottom">
        <span>LONG / credit <strong>{longPrice.toFixed(4)}×</strong></span>
        <span>SHORT mint rate <strong>1:1</strong></span>
        <span>Your credits <strong>{amount(proposal.claimedCredits)}</strong></span>
        <span>Your LONG <strong>{amount(proposal.longBalance)}</strong></span>
        <span>Market credit reserve <strong>{amount(proposal.creditReserve)}</strong></span>
      </div>
      <span className="demo-selection-mark">{selected ? "✓" : ""}</span>
    </button>
  );
}

function LiveVaultMetrics({ nav, tEthAllocationBps }: { nav: bigint; tEthAllocationBps: number }) {
  return (
    <section className="demo-overview-stats" aria-label="Live vault metrics">
      <div><span>Vault NAV</span><strong>{money(toUsdc(nav))}</strong></div>
      <div><span>Current tETH allocation</span><strong>{tEthAllocationBps / 100}%</strong></div>
      <div><span>USDC allocation</span><strong>{(10_000 - tEthAllocationBps) / 100}%</strong></div>
      <div><span>Deployed vault</span><strong>{addresses.vault.slice(0, 8)}…</strong></div>
    </section>
  );
}
