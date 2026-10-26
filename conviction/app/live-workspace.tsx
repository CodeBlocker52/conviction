"use client";

import { useEffect, useMemo, useState } from "react";
import type { DemoWorkspaceView } from "./demo-workspace";
import { addresses, arcTestnet } from "./lib/contracts";
import { explorerAddress, explorerTx } from "./lib/explorer";
import { fmtMoney, fmtPercentChange, fmtReturn, fmtToken, fmtUsdc } from "./lib/format";
import {
  toShareAmount,
  toUsdc,
  useQuantumRound,
  type LiveProposal,
  type LiveRound,
  type TradeAction,
  type TradeQuote,
  type TradeSide,
  type VaultTrade,
} from "./hooks/useQuantumRound";
import { useWallet } from "./hooks/useWallet";

function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function countdown(seconds: number) {
  if (seconds <= 0) return "0:00";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return `${hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}` : minutes}:${String(rest).padStart(2, "0")}`;
}

const prob = (value: number | null) => (value === null ? "—" : value.toFixed(4));

function txError(error: unknown) {
  return error instanceof Error ? error.message : "Transaction failed.";
}

const phaseLabel: Record<LiveRound["phase"], string> = {
  trading: "trading",
  closed: "closed · awaiting collapse",
  collapsed: "evaluating",
  settled: "settled",
  cancelled: "cancelled",
};

function proposalTitle(proposal: LiveProposal) {
  return proposal.id === 0 ? "Keep current allocation (Protocol)" : `Proposal ${proposal.id}`;
}

function TxLink({ trade }: { trade: VaultTrade }) {
  return (
    <a href={explorerTx(trade.txHash)} target="_blank" rel="noreferrer">
      {trade.kind === "executed" ? "Vault trade ↗" : "Cancellation ↗"}
    </a>
  );
}

function vaultTradeText(trade: VaultTrade) {
  if (trade.kind === "cancelled") return "The vault's slippage guard cancelled the trade.";
  const usdc = trade.deltaUsdc ?? 0n;
  const tEth = trade.deltaTEth ?? 0n;
  const spent = usdc < 0n ? `Swapped ${fmtUsdc(-usdc)} USDC for ${fmtToken(tEth)} tETH` : `Swapped ${fmtToken(-tEth)} tETH for ${fmtUsdc(usdc)} USDC`;
  return `${spent} to reach ${(trade.winnerTEthBps ?? 0) / 100}% tETH.`;
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
  const now = useNow();
  const snapshot = live.snapshot;
  const round = snapshot?.round ?? null;
  const [selectedId, setSelectedId] = useState(0);
  const [depositAmount, setDepositAmount] = useState("1");
  const [claimAmount, setClaimAmount] = useState("0.5");
  const [vaultDepositAmount, setVaultDepositAmount] = useState("1");
  const [vaultWithdrawAmount, setVaultWithdrawAmount] = useState("");
  const proposal = round?.proposals.find((item) => item.id === selectedId) ?? round?.proposals[0] ?? null;
  const currentAllocation = snapshot?.vault.tEthAllocationBps ?? 0;
  const usdcAllocation = 10_000 - currentAllocation;
  const canTransact = Boolean(wallet.address && wallet.chainId === arcTestnet.id);

  const history = useMemo(() => snapshot?.history.slice().reverse() ?? [], [snapshot?.history]);
  const vaultShareCount = toShareAmount(snapshot?.vault.shareSupply ?? 0n);
  const vaultSharePrice = vaultShareCount > 0 ? toUsdc(snapshot?.vault.navUsdc ?? 0n) / vaultShareCount : 1;

  async function perform(label: string, operation: () => Promise<`0x${string}`>) {
    try {
      const hash = await operation();
      notify(`${label} confirmed: ${hash}`);
    } catch (error) {
      notify(`${label} failed: ${txError(error)}`);
    }
  }

  if (live.error && !snapshot) {
    return <div className="storage-warning" role="status">{live.error}</div>;
  }
  if (live.loading && !snapshot) {
    return <div className="storage-warning" role="status">Loading on-chain Wavefund state…</div>;
  }
  if (!snapshot) return null;

  if (view === "vault") {
    const oracle = toUsdc(snapshot.vault.oraclePriceUsdc);
    const spot = toUsdc(snapshot.vault.spotPriceUsdc);
    const deviation = oracle > 0 ? Math.abs(spot / oracle - 1) * 100 : 0;
    return (
      <>
        <section className="vault-grid demo-vault-grid">
          <article className="vault-overview card-surface">
            <div className="vault-overview-top">
              <div>
                <span className="eyebrow">VAULT NAV · LIVE</span>
                <h2>{fmtMoney(snapshot.vault.navUsdc)}</h2>
                <span className="vault-change">
                  Oracle-marked · <a href={explorerAddress(addresses.vault)} target="_blank" rel="noreferrer">{addresses.vault.slice(0, 10)}…{addresses.vault.slice(-6)} ↗</a>
                </span>
              </div>
              <span className="vault-icon" aria-hidden="true">◈</span>
            </div>
            <div className="vault-bottom-stats">
              <div><span>USDC held</span><strong>{fmtMoney(snapshot.vault.usdcBalance)}</strong></div>
              <div><span>tETH held</span><strong>{fmtToken(snapshot.vault.tEthBalance, 8)}</strong></div>
              <div><span>Oracle price</span><strong>{fmtMoney(snapshot.vault.oraclePriceUsdc)} / tETH</strong></div>
              <div><span>v4 pool price</span><strong>{fmtMoney(snapshot.vault.spotPriceUsdc)} / tETH</strong></div>
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
        {deviation > 2 && (
          <div className="storage-warning" role="status">
            Oracle price ({fmtMoney(snapshot.vault.oraclePriceUsdc)}) and v4 pool price ({fmtMoney(snapshot.vault.spotPriceUsdc)}) differ by {deviation.toFixed(2)}%. A vault trade now would likely be cancelled by the slippage guard until the pool is re-centred.
          </div>
        )}
        <section className="vault-flow-panel" aria-label="Vault deposit and withdrawal">
          <div className="vault-flow-copy">
            <span className="eyebrow">VAULT FLOWS · WAVE SHARES</span>
            <h3>Deposit into the fund</h3>
            <p>Deposits and withdrawals queue and are processed at the next decision, using the oracle-marked NAV per share.</p>
            <p>Your balance: {fmtToken(snapshot.vault.shareBalance, 6)} WAVE · Share price: ${vaultSharePrice.toFixed(4)}</p>
            <p>Queued by everyone: {fmtMoney(snapshot.vault.totalQueuedDeposit)} USDC in · {fmtToken(snapshot.vault.totalQueuedWithdrawal, 6)} WAVE out</p>
            {snapshot.vault.queuedDeposit > 0n && <p>Your queued deposit: {fmtMoney(snapshot.vault.queuedDeposit)} USDC</p>}
            {snapshot.vault.queuedWithdrawal > 0n && <p>Your queued withdrawal: {fmtToken(snapshot.vault.queuedWithdrawal, 6)} WAVE</p>}
          </div>
          <div className="vault-flow-controls">
            <label className="inline-money-input"><input aria-label="Vault deposit amount in USDC" type="number" min="0.000001" step="0.1" value={vaultDepositAmount} onChange={(event) => setVaultDepositAmount(event.target.value)} placeholder="USDC" /><span>USDC</span></label>
            <button className="button button-outline" type="button" disabled={!canTransact} onClick={() => perform("Queue vault deposit", () => live.depositToVault(vaultDepositAmount))}>Queue deposit</button>
            <label className="inline-money-input"><input aria-label="Vault shares to withdraw" type="number" min="0.000000000000000001" step="0.1" value={vaultWithdrawAmount} onChange={(event) => setVaultWithdrawAmount(event.target.value)} placeholder="Shares to withdraw" /><span>WAVE</span></label>
            <button className="button button-outline" type="button" disabled={!canTransact || snapshot.vault.shareBalance === 0n} onClick={() => perform("Queue vault withdrawal", () => live.withdrawFromVault(vaultWithdrawAmount))}>Queue withdrawal</button>
            {snapshot.vault.queuedDeposit > 0n && <button className="button button-outline" type="button" disabled={!canTransact} onClick={() => perform("Cancel vault deposit", live.cancelVaultDeposit)}>Cancel deposit</button>}
            {snapshot.vault.queuedWithdrawal > 0n && <button className="button button-outline" type="button" disabled={!canTransact} onClick={() => perform("Cancel vault withdrawal", live.cancelVaultWithdrawal)}>Cancel withdrawal</button>}
          </div>
        </section>
        <section className="positions-panel">
          <div className="positions-heading"><div><span className="eyebrow">ON-CHAIN HISTORY</span><h3>Vault decision history</h3></div></div>
          {history.length === 0 ? <p>No on-chain vault decisions have been recorded yet.</p> : history.map((item) => (
            <div className="vault-history-row" key={item.roundId.toString()}>
              <strong>Round #{item.roundId.toString()}</strong>
              <span>Starting NAV {item.navUsdc > 0n ? fmtMoney(item.navUsdc) : "pending"}</span>
              <span>{item.allocationBps === null ? (item.status === "Cancelled" ? "Trade cancelled" : "Allocation pending") : `${item.allocationBps / 100}% tETH allocation`}</span>
              <span>
                {item.realisedReturn === null ? item.status : `Return ${fmtReturn(item.realisedReturn)} · ${item.status}`}
                {item.trade && <> · <TxLink trade={item.trade} /></>}
              </span>
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
          <article className="demo-account-card demo-account-primary"><span>WALLET USDC BALANCE</span><strong>{fmtMoney(snapshot.usdcBalance ?? 0n)}</strong><small>Arc Testnet ERC-20 USDC</small></article>
          <article className="demo-account-card"><span>ROUND DEPOSIT</span><strong>{fmtMoney(round?.deposit ?? 0n)}</strong><small>{round ? `Round #${round.id}` : "No open round"}</small></article>
          <article className="demo-account-card"><span>WAVE SHARES</span><strong>{fmtToken(snapshot.vault.shareBalance, 4)}</strong><small>Vault NAV {fmtMoney(snapshot.vault.navUsdc)}</small></article>
          <article className="demo-account-card"><span>ROUND STATUS</span><strong>{round ? phaseLabel[round.phase] : "No round"}</strong><small>{round ? `${round.proposalCount} proposals` : "Awaiting first round"}</small></article>
        </div>
        {!wallet.address && <div className="storage-warning" role="status">Connect a wallet to see your Phase B positions.</div>}
        {wallet.address && snapshot.portfolio.length === 0 && (
          <section className="positions-panel"><p>No deposits or positions found in the latest rounds for this wallet.</p></section>
        )}
        {snapshot.portfolio.map((item) => (
          <section className="positions-panel" key={item.id.toString()}>
            <div className="positions-heading">
              <div><span className="eyebrow">ROUND #{String(item.id).padStart(3, "0")} · {phaseLabel[item.phase].toUpperCase()}</span><h3>Deposit {fmtMoney(item.deposit)} · Redeemable {item.phase === "settled" || item.phase === "cancelled" ? fmtMoney(item.redeemable) : "after settlement"}</h3></div>
              {(item.phase === "settled" || item.phase === "cancelled") && item.redeemable > 0n && (
                <button className="button button-primary" type="button" disabled={!canTransact} onClick={() => perform("Redeem", () => live.redeem(item.id))}>Redeem {fmtUsdc(item.redeemable)} USDC</button>
              )}
            </div>
            {item.proposals.map((entry) => {
              const isWinner = item.winnerProposalId === entry.id;
              const erased = item.collapsed && !item.cancelled && !isWinner;
              return (
                <div className="position-row" key={entry.id}>
                  <strong>{proposalTitle(entry)}{isWinner ? " · WINNER" : ""}</strong>
                  <span>Claimed {fmtUsdc(entry.claimedCredits)} credits</span>
                  <span>Credit balance {fmtUsdc(entry.creditBalance)}</span>
                  <span className={erased ? "voided-position" : undefined}>
                    LONG {fmtToken(entry.longBalance)} · SHORT {fmtToken(entry.shortBalance)}{erased && (entry.longBalance + entry.shortBalance > 0n) ? " · market erased (worthless)" : ""}
                  </span>
                </div>
              );
            })}
          </section>
        ))}
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
        <span>{round ? `Round #${round.id} · ${phaseLabel[round.phase]}` : "No round opened"}</span>
      </div>
      {live.loading && <div className="storage-warning" role="status">Refreshing deployed contract state…</div>}
      {!round ? (
        <section className="round-action-panel"><div className="round-action-copy"><span className="phase-kicker"><i /> ON-CHAIN MARKETS</span><h3>No round is open yet</h3><p>Proposal markets and positions will appear here when a round is opened.</p></div></section>
      ) : (
        <>
          <RoundPanel
            round={round}
            now={now}
            canTransact={canTransact}
            depositAmount={depositAmount}
            setDepositAmount={setDepositAmount}
            protocolSeed={snapshot.protocolSeed}
            onDeposit={() => perform("Deposit", () => live.deposit(round.id, depositAmount))}
            onCollapse={() => perform("Collapse", () => live.collapse(round.id))}
            onRedeem={() => perform("Redeem", () => live.redeem(round.id))}
          />
          <div className="demo-market-layout">
            <div className="demo-markets-column">
              <div className="subsection-heading"><div><span className="eyebrow">ROUND #{String(round.id).padStart(3, "0")} MARKETS</span><h3>Choose a proposal to forecast</h3></div><span className={`round-phase-pill ${round.phase}`}><i /> {phaseLabel[round.phase]}</span></div>
              <div className="demo-proposal-list">
                {round.proposals.map((item) => (
                  <LiveProposalCard key={item.id} proposal={item} round={round} selected={item.id === (proposal?.id ?? selectedId)} onSelect={() => setSelectedId(item.id)} />
                ))}
              </div>
            </div>
            {proposal && (
              <TradeTicket
                round={round}
                proposal={proposal}
                now={now}
                canTransact={canTransact}
                claimAmount={claimAmount}
                setClaimAmount={setClaimAmount}
                onClaim={() => perform("Claim credits", () => live.claimCredits(round.id, proposal.id, claimAmount))}
                quote={live.quoteTrade}
                onTrade={(side, amount, action) => perform(`${action === "buy" ? "Buy" : "Sell"} ${side}`, () => live.trade(round.id, proposal, side, amount, action))}
              />
            )}
          </div>
        </>
      )}
      <LiveVaultMetrics nav={snapshot.vault.navUsdc} tEthAllocationBps={currentAllocation} />
    </>
  );
}

function RoundPanel({
  round,
  now,
  canTransact,
  depositAmount,
  setDepositAmount,
  protocolSeed,
  onDeposit,
  onCollapse,
  onRedeem,
}: {
  round: LiveRound;
  now: number;
  canTransact: boolean;
  depositAmount: string;
  setDepositAmount: (value: string) => void;
  protocolSeed: bigint;
  onDeposit: () => void;
  onCollapse: () => void;
  onRedeem: () => void;
}) {
  const label = `ROUND #${String(round.id).padStart(3, "0")}`;
  const winner = round.proposals.find((item) => item.id === round.winnerProposalId);
  const secondsToClose = Number(round.tradingEnd) - now;
  const inFinalWindow = round.phase === "trading" && now >= Number(round.finalWindowStart);

  if (round.phase === "trading") {
    return (
      <section className="round-action-panel" aria-label="Live round actions">
        <div className="round-action-copy">
          <span className="phase-kicker"><i /> {label} · TRADING OPEN · CLOSES IN {countdown(secondsToClose)}</span>
          <h3>Forecast on-chain</h3>
          <p>Deposit USDC once, claim proposal credits, and trade the live LONG or SHORT markets.</p>
          {inFinalWindow
            ? <p><strong>Final TWAP window is live.</strong> The time-weighted probability of the last {round.twapWindow}s decides the winner.</p>
            : <p>Final TWAP window starts in {countdown(Number(round.finalWindowStart) - now)} (the last {round.twapWindow}s before close).</p>}
          <p>Protocol liquidity reserve: {fmtUsdc(protocolSeed)} USDC</p>
        </div>
        <div className="forecast-deposit-action">
          <label htmlFor="live-deposit">Forecasting deposit</label>
          <div className="inline-money-input"><span>$</span><input id="live-deposit" type="number" min="0.000001" step="0.1" value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} /><span>USDC</span></div>
          <button className="button button-primary" type="button" disabled={!canTransact} onClick={onDeposit}>Deposit to round</button>
        </div>
      </section>
    );
  }
  if (round.phase === "closed") {
    return (
      <section className="round-action-panel" aria-label="Collapse live round">
        <div className="round-action-copy"><span className="phase-kicker phase-evaluation"><i /> {label} · TRADING CLOSED</span><h3>Collapse the decision market</h3><p>Anyone may collapse the round now. This reads each market&apos;s final-window TWAP, picks the winner, and returns losing markets&apos; liquidity to the reserve.</p></div>
        <button className="button button-dark" type="button" disabled={!canTransact} onClick={onCollapse}>Collapse round <span>→</span></button>
      </section>
    );
  }
  if (round.phase === "collapsed") {
    return (
      <section className="round-action-panel evaluation-panel" aria-label="Round evaluation">
        <div className="round-action-copy">
          <span className="phase-kicker phase-evaluation"><i /> {label} · EVALUATING · ENDS IN {countdown(Number(round.evaluationEnd) - now)}</span>
          <h3>{winner ? `${proposalTitle(winner)} won the market` : "Round collapsed"}</h3>
          <p>{winner ? `${winner.tEthBps / 100}% tETH allocation, chosen on its final-window TWAP.` : ""} Other markets are erased. The result settles after the evaluation window ends.</p>
          {round.vaultTrade && <p>{vaultTradeText(round.vaultTrade)} <TxLink trade={round.vaultTrade} /></p>}
        </div>
      </section>
    );
  }
  if (round.phase === "cancelled") {
    return (
      <section className="round-action-panel settled-panel">
        <div className="round-action-copy">
          <span className="phase-kicker phase-settled"><i /> {label} · CANCELLED</span>
          <h3>The vault&apos;s slippage guard cancelled this round</h3>
          <p>The winning allocation could not be executed within the vault&apos;s slippage limit, so the vault did not trade. Every deposit is redeemable at par.</p>
          {round.vaultTrade && <p><TxLink trade={round.vaultTrade} /></p>}
        </div>
        {round.deposit > 0n && <button className="button button-primary" type="button" disabled={!canTransact} onClick={onRedeem}>Redeem {fmtUsdc(round.deposit)} USDC at par <span>→</span></button>}
      </section>
    );
  }
  return (
    <section className="round-action-panel settled-panel">
      <div className="round-action-copy">
        <span className="phase-kicker phase-settled"><i /> {label} · SETTLED</span>
        <h3>Realised return {fmtReturn(round.realisedReturn)}</h3>
        <p>Winner: {winner ? proposalTitle(winner) : "—"}. Payout per LONG {round.payoutPerLong?.toFixed(4)} credits · per SHORT {round.payoutPerShort?.toFixed(4)} credits.</p>
        {round.vaultTrade && <p>{vaultTradeText(round.vaultTrade)} <TxLink trade={round.vaultTrade} /></p>}
        <p>Your redeemable amount: {fmtUsdc(round.redeemable)} USDC</p>
      </div>
      <button className="button button-primary" type="button" disabled={!canTransact || round.redeemable === 0n} onClick={onRedeem}>Redeem USDC <span>→</span></button>
    </section>
  );
}

function LiveProposalCard({
  proposal,
  round,
  selected,
  onSelect,
}: {
  proposal: LiveProposal;
  round: LiveRound;
  selected: boolean;
  onSelect: () => void;
}) {
  const isWinner = round.winnerProposalId === proposal.id && !round.cancelled;
  const erased = round.collapsed && !round.cancelled && !isWinner;
  return (
    <button className={`demo-proposal-card ${selected ? "selected" : ""} ${isWinner ? "winner" : ""} ${erased ? "erased" : ""}`} type="button" onClick={onSelect} aria-pressed={selected}>
      <div className="demo-proposal-top">
        <span className="proposal-avatar avatar-violet">{proposal.id === 0 ? "WF" : `P${proposal.id}`}</span>
        <span className="demo-proposal-name">
          <strong>{proposalTitle(proposal)}</strong>
          <small>{proposal.tEthBps / 100}% tETH · {proposal.id === 0 ? "Protocol" : proposal.proposerName}</small>
          {proposal.id !== 0 && <small className="proposal-address">{proposal.proposer}</small>}
        </span>
        {isWinner && <span className="winner-tag">WINNER</span>}
        {erased && <span className="voided-position">ERASED</span>}
        {proposal.id === 0 && !isWinner && !erased && <span className="status-quo">STATUS QUO</span>}
      </div>
      <div className="demo-proposal-bottom">
        <span>pLong (LONG price, credits) <strong>{prob(proposal.pLong)}</strong></span>
        <span>pShort <strong>{prob(proposal.pShort)}</strong></span>
        <span>Final-window TWAP <strong>{prob(proposal.twap)}</strong></span>
        <span>Implied return <strong>{fmtPercentChange(proposal.impliedReturn)}</strong></span>
        <span>Your credits <strong>{fmtUsdc(proposal.claimedCredits)}</strong></span>
        <span>Your LONG / SHORT <strong>{fmtToken(proposal.longBalance, 4)} / {fmtToken(proposal.shortBalance, 4)}</strong></span>
      </div>
      <span className="demo-selection-mark">{selected ? "✓" : ""}</span>
    </button>
  );
}

function TradeTicket({
  round,
  proposal,
  now,
  canTransact,
  claimAmount,
  setClaimAmount,
  onClaim,
  quote,
  onTrade,
}: {
  round: LiveRound;
  proposal: LiveProposal;
  now: number;
  canTransact: boolean;
  claimAmount: string;
  setClaimAmount: (value: string) => void;
  onClaim: () => void;
  quote: (roundId: bigint, proposal: LiveProposal, side: TradeSide, action: TradeAction, amount: string) => Promise<TradeQuote>;
  onTrade: (side: TradeSide, amount: string, action: TradeAction) => void;
}) {
  const [side, setSide] = useState<TradeSide>("LONG");
  const [buyAmount, setBuyAmount] = useState("0.1");
  const [sellAmount, setSellAmount] = useState("");
  const held = side === "LONG" ? proposal.longBalance : proposal.shortBalance;
  const trading = round.phase === "trading";
  const tradeOpen = trading && now < Number(proposal.tradingEnd);

  return (
    <aside className="demo-trade-ticket" aria-label="On-chain forecasting trade controls">
      <div className="ticket-header"><div><span className="eyebrow">ON-CHAIN MARKET</span><h3>{proposalTitle(proposal)}</h3></div><span className="ticket-avatar avatar-violet">WF</span></div>
      <p className="ticket-allocation">{proposal.tEthBps / 100}% tETH · {100 - proposal.tEthBps / 100}% USDC</p>
      <p className="ticket-rationale">{proposal.id === 0 ? "Keep the vault's current allocation." : proposal.rationale || "No proposal rationale was published."}</p>
      <div className="ticket-prices">
        <div><span>pLong · LONG price in credits</span><strong>{prob(proposal.pLong)}</strong></div>
        <div><span>Pool price · SHORT per LONG</span><strong>{prob(proposal.poolRatio)}</strong></div>
        <div><span>Scalar implied return</span><strong>{fmtPercentChange(proposal.impliedReturn)}</strong></div>
        <div><span>Final-window TWAP</span><strong>{prob(proposal.twap)}</strong></div>
      </div>
      {proposal.atBoundary && <p className="ticket-rationale">This market sits on its 0.01 / 0.99 probability boundary; trades pushing further are rejected.</p>}
      {trading ? (
        <>
          <div className="credit-claim-box">
            <div><strong>Claim proposal credits</strong><span>Unclaimed round limit {fmtUsdc(round.remainingCredits)}</span></div>
            <div className="inline-money-input"><input aria-label="Credits to claim" type="number" min="0.000001" step="0.1" value={claimAmount} onChange={(event) => setClaimAmount(event.target.value)} /><span>credits</span></div>
            <div className="credit-claim-status"><span>Claimed {fmtUsdc(proposal.claimedCredits)}</span></div>
            <button className="button button-outline" type="button" disabled={!canTransact || round.remainingCredits === 0n} onClick={onClaim}>Claim credits for this proposal</button>
          </div>
          <div className="ticket-side-toggle" role="group" aria-label="Outcome token">
            <button type="button" className={side === "LONG" ? "active long" : ""} onClick={() => setSide("LONG")}>LONG <span>↑</span></button>
            <button type="button" className={side === "SHORT" ? "active short" : ""} onClick={() => setSide("SHORT")}>SHORT <span>↓</span></button>
          </div>
          <label className="ticket-label" htmlFor="live-trade-size"><span>Buy amount</span><span>{fmtUsdc(proposal.creditBalance)} credits available</span></label>
          <div className="inline-money-input trade-size-input"><input id="live-trade-size" type="number" min="0.000001" step="0.1" value={buyAmount} onChange={(event) => setBuyAmount(event.target.value)} /><span>credits</span></div>
          <QuotePreview key={`buy-${proposal.id}-${side}`} round={round} proposal={proposal} side={side} action="buy" amount={buyAmount} quote={quote} />
          <button className="button button-primary ticket-trade-button" type="button" disabled={!canTransact || !tradeOpen || proposal.creditBalance === 0n} onClick={() => onTrade(side, buyAmount, "buy")}>Buy {side} <span>→</span></button>
          {held > 0n && (
            <>
              <label className="ticket-label" htmlFor="live-sell-size"><span>Sell amount</span><span>{fmtToken(held)} {side} available</span></label>
              <div className="inline-money-input trade-size-input">
                <input id="live-sell-size" type="number" min="0.000000000000000001" step="any" value={sellAmount} onChange={(event) => setSellAmount(event.target.value)} placeholder={fmtToken(held)} />
                <span>{side}</span>
              </div>
              <button className="button button-outline" type="button" onClick={() => setSellAmount(fmtToken(held, 18))}>Max</button>
              <QuotePreview key={`sell-${proposal.id}-${side}`} round={round} proposal={proposal} side={side} action="sell" amount={sellAmount} quote={quote} />
              <button className="button button-outline ticket-trade-button" type="button" disabled={!canTransact || !tradeOpen || !sellAmount} onClick={() => onTrade(side, sellAmount, "sell")}>Sell {side} position</button>
            </>
          )}
        </>
      ) : (
        <div className="ticket-closed">
          <strong>{round.phase === "closed" ? "Trading closed · awaiting collapse" : round.phase === "collapsed" ? (round.winnerProposalId === proposal.id ? "Winning market · position pays out after settlement" : "Market erased · positions are worthless") : round.phase === "cancelled" ? "Round cancelled · redeem at par" : "This round has settled"}</strong>
          <span>On-chain positions: LONG {fmtToken(proposal.longBalance)} · SHORT {fmtToken(proposal.shortBalance)} · credits {fmtUsdc(proposal.creditBalance)}</span>
        </div>
      )}
    </aside>
  );
}

function QuotePreview({
  round,
  proposal,
  side,
  action,
  amount,
  quote,
}: {
  round: LiveRound;
  proposal: LiveProposal;
  side: TradeSide;
  action: TradeAction;
  amount: string;
  quote: (roundId: bigint, proposal: LiveProposal, side: TradeSide, action: TradeAction, amount: string) => Promise<TradeQuote>;
}) {
  const [result, setResult] = useState<{ quote?: TradeQuote; error?: string }>({});

  useEffect(() => {
    if (!amount) return;
    let active = true;
    const timer = window.setTimeout(() => {
      quote(round.id, proposal, side, action, amount)
        .then((value) => { if (active) setResult({ quote: value }); })
        .catch((error: unknown) => { if (active) setResult({ error: txError(error) }); });
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [action, amount, proposal, quote, round.id, side]);

  if (!amount) return null;
  if (result.error) return <p className="ticket-rationale" role="status">{result.error}</p>;
  const value = result.quote;
  if (!value) return <p className="ticket-rationale">Quoting…</p>;
  const buying = value.action === "buy";
  return (
    <div className="ticket-closed" aria-label="Trade preview">
      <strong>{buying ? `Pay ${fmtUsdc(value.amountIn, 6)} credits → receive ≈ ${fmtToken(value.expectedOut)} ${side}` : `Sell ${fmtToken(value.amountIn)} ${side} → receive ≈ ${fmtUsdc(value.expectedOut, 6)} credits`}</strong>
      <span>Average execution price: {value.averagePrice === null ? "—" : value.averagePrice.toFixed(4)} credits per {side}</span>
      <span>Price impact: {value.priceImpactPct === null ? "—" : `${value.priceImpactPct.toFixed(2)}%`} · pLong after trade: {prob(value.pAfter)}</span>
      <span>Minimum received (0.5% slippage): {buying ? `${fmtToken(value.minOut)} ${side}` : `${fmtUsdc(value.minOut, 6)} credits`}</span>
      {value.dust && (value.dust.long > 0n || value.dust.short > 0n) && <span>Unpaired dust returned: {fmtToken(value.dust.long)} LONG · {fmtToken(value.dust.short)} SHORT</span>}
      {value.hitsBoundary && <span role="alert">This trade would cross the 0.01 / 0.99 boundary. Reduce the amount.</span>}
    </div>
  );
}

function LiveVaultMetrics({ nav, tEthAllocationBps }: { nav: bigint; tEthAllocationBps: number }) {
  return (
    <section className="demo-overview-stats" aria-label="Live vault metrics">
      <div><span>Vault NAV</span><strong>{fmtMoney(nav)}</strong></div>
      <div><span>Current tETH allocation</span><strong>{tEthAllocationBps / 100}%</strong></div>
      <div><span>USDC allocation</span><strong>{(10_000 - tEthAllocationBps) / 100}%</strong></div>
      <div><span>Deployed vault</span><strong>{addresses.vault.slice(0, 8)}…</strong></div>
    </section>
  );
}
