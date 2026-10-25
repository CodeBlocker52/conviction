"use client";

import { useState, type ReactNode } from "react";
import {
  BASE_QUANTUM_LIQUIDITY,
  INITIAL_SHARE_PRICE,
  INITIAL_VAULT_TVL,
  proposals,
  useDemo,
  type TradeSide,
} from "./demo-context";
import LiveWorkspace from "./live-workspace";

function money(value: number) {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function number(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function ActionButton({
  children,
  onClick,
  disabled = false,
  secondary = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <button
      className={`button ${secondary ? "button-dark" : "button-primary"}`}
      type="button"
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export type DemoWorkspaceView = "markets" | "portfolio" | "vault";

export default function DemoWorkspace(props: {
  notify: (message: string) => void;
  view: DemoWorkspaceView;
}) {
  const { mode } = useDemo();
  return mode === "live" ? <LiveWorkspace {...props} /> : <MockDemoWorkspace {...props} />;
}

function MockDemoWorkspace({
  notify,
  view,
}: {
  notify: (message: string) => void;
  view: DemoWorkspaceView;
}) {
  const { demo, storageWarning, addDemoFunds, depositForecast, claimCredits, trade, queueVaultDeposit, queueVaultWithdrawal, addLiquidity, withdrawLiquidity, collapseRound, settleRound, startNextRound, resetDemo } = useDemo();
  const [selectedId, setSelectedId] = useState(1);
  const [side, setSide] = useState<TradeSide>("LONG");
  const [forecastAmount, setForecastAmount] = useState("1000");
  const [claimAmount, setClaimAmount] = useState("500");
  const [positionSize, setPositionSize] = useState("250");
  const [vaultDepositAmount, setVaultDepositAmount] = useState("500");
  const [vaultWithdrawAmount, setVaultWithdrawAmount] = useState("");
  const [liquidityAmount, setLiquidityAmount] = useState("500");
  const [realizedReturn, setRealizedReturn] = useState("1.006");

  const selectedProposal = proposals.find((proposal) => proposal.id === selectedId) ?? proposals[1];
  const selectedPosition = demo.positions[selectedId];
  const marketPrice = demo.marketPrices[selectedId] ?? selectedProposal.price;
  const sidePrice = side === "LONG" ? marketPrice : 100 - marketPrice;
  const availableCredits = selectedPosition.claimedCredits - selectedPosition.sets;
  const currentVaultValue = demo.vaultShares * INITIAL_SHARE_PRICE;
  const liveForecastPnl = proposals.reduce((total, proposal) => {
    const position = demo.positions[proposal.id];
    if (!position.side || position.shares === 0) return total;
    const price = demo.marketPrices[proposal.id] ?? proposal.price;
    const markPrice = position.side === "LONG" ? price / 100 : (100 - price) / 100;
    return total + position.shares * markPrice - position.entryCost;
  }, 0);
  const portfolioValue = currentVaultValue + demo.demoUSDC + demo.forecastDeposit + demo.queuedVaultDeposit + demo.liquidityDeposit
    + (demo.phase === "settled" ? 0 : liveForecastPnl);
  const settledPnl = demo.lastSettlement?.pnl ?? 0;
  const winningProposal = proposals.find((proposal) => proposal.id === demo.winningProposalId);
  const heldPositions = proposals.filter((proposal) => demo.positions[proposal.id]?.shares > 0);

  const announce = (result: { ok: boolean; message: string }) => notify(result.message);

  const handleTrade = () => {
    const result = trade(selectedId, side, Number(positionSize));
    announce(result);
  };

  const handleCollapse = () => {
    const result = collapseRound();
    announce(result);
  };

  const handleSettle = () => {
    const result = settleRound(Number(realizedReturn));
    announce(result);
  };

  const handleReset = () => {
    if (window.confirm("Reset the demo account, positions, and round history?")) {
      resetDemo();
      setSelectedId(1);
      setSide("LONG");
      setForecastAmount("1000");
      setClaimAmount("500");
      setPositionSize("250");
      setVaultDepositAmount("500");
      setVaultWithdrawAmount("");
      setLiquidityAmount("500");
      setRealizedReturn("1.006");
      notify("Demo account reset to its starting balances.");
    }
  };

  return (
    <div className="demo-workspace">
      <div className="demo-mode-banner">
        <span className="demo-mode-icon">DEMO</span>
        <div><strong>Arc testnet demo mode</strong><span>Simulated USDC and trades · no wallet signatures or on-chain transactions</span></div>
        <button type="button" onClick={handleReset}>Reset demo</button>
      </div>

      {storageWarning && <div className="storage-warning" role="status">{storageWarning} Current session changes may not persist after refresh.</div>}

      {view === "portfolio" && <div className="demo-account-grid">
        <article className="demo-account-card demo-account-primary">
          <span>DEMO WALLET BALANCE</span>
          <strong>{money(demo.demoUSDC)}</strong>
          <small>Available simulated USDC</small>
          <button type="button" onClick={() => announce(addDemoFunds(10000))}>Get 10,000 demo USDC <span>＋</span></button>
        </article>
        <article className="demo-account-card">
          <span>FORECASTING DEPOSIT</span>
          <strong>{money(demo.forecastDeposit)}</strong>
          <small>{demo.forecastDeposit > 0 ? "Round collateral · claim credits per proposal" : "Deposit once to trade this round"}</small>
        </article>
        <article className="demo-account-card">
          <span>VAULT POSITION</span>
          <strong>{money(currentVaultValue)}</strong>
          <small>{number(demo.vaultShares)} shares · {money(demo.queuedVaultDeposit)} deposit queued</small>
        </article>
        <article className="demo-account-card">
          <span>DEMO PORTFOLIO</span>
          <strong>{money(portfolioValue)}</strong>
          <small>Wallet + vault position + queued funds</small>
        </article>
      </div>}

      {view === "markets" && demo.phase === "trading" && (
        <section className="round-action-panel" aria-label="Round actions">
          <div className="round-action-copy">
            <span className="phase-kicker"><i /> ROUND #{String(demo.roundNumber).padStart(3, "0")} · TRADING OPEN</span>
            <h3>Put your forecast to work</h3>
            <p>Deposit once, then claim credits independently in any proposal market. Each proposal credit claim is capped at your round deposit.</p>
          </div>
          <div className="forecast-deposit-action">
            <label htmlFor="forecast-deposit">Forecasting deposit</label>
            <div className="inline-money-input"><span>$</span><input id="forecast-deposit" type="number" min="1" step="1" value={forecastAmount} onChange={(event) => setForecastAmount(event.target.value)} /><span>USDC</span></div>
            <ActionButton onClick={() => announce(depositForecast(Number(forecastAmount)))} disabled={!demo.demoAccountConnected}>Deposit to round</ActionButton>
            {!demo.demoAccountConnected && <small>Connect a demo account above to enable demo transactions.</small>}
          </div>
          <div className="collapse-action">
            <span>Decision market</span>
            <ActionButton secondary onClick={handleCollapse}>Collapse round now <span>→</span></ActionButton>
            <small>Demo shortcut · selects final-window TWAP leader</small>
          </div>
        </section>
      )}

      {view === "markets" && demo.phase === "evaluation" && (
        <section className="round-action-panel evaluation-panel" aria-label="Round settlement">
          <div className="round-action-copy">
            <span className="phase-kicker phase-evaluation"><i /> ROUND #{String(demo.roundNumber).padStart(3, "0")} · EVALUATION</span>
            <h3>{winningProposal?.name ?? "Status quo"} won the market</h3>
            <p>{winningProposal?.allocation ?? "The vault holds its current allocation."} selected using final-window TWAP. Losing proposal positions are voided and do not affect your balance.</p>
          </div>
          <div className="settlement-action">
            <label htmlFor="realized-return">Simulated oracle return</label>
            <div className="inline-money-input"><input id="realized-return" type="number" min="0.95" max="1.05" step="0.001" value={realizedReturn} onChange={(event) => setRealizedReturn(event.target.value)} /><span>x NAV</span></div>
            <small>Enter a return factor, e.g. 1.006 = +0.6%. Payout range: 0.95–1.05.</small>
            <ActionButton onClick={handleSettle}>Resolve and settle round</ActionButton>
          </div>
        </section>
      )}

      {view === "markets" && demo.phase === "settled" && demo.lastSettlement && (
        <section className="round-action-panel settled-panel" aria-label="Settled round">
          <div className="round-action-copy">
            <span className="phase-kicker phase-settled"><i /> ROUND #{String(demo.lastSettlement.roundNumber).padStart(3, "0")} · SETTLED</span>
            <h3>Settlement complete</h3>
            <p>{proposals.find((proposal) => proposal.id === demo.lastSettlement?.winningProposalId)?.name} won. Winning-market payout probability: {(demo.lastSettlement.payoutProbability * 100).toFixed(1)}%.</p>
          </div>
          <div className="settlement-result">
            <span>Your forecasting P&amp;L</span>
            <strong className={settledPnl >= 0 ? "positive" : "negative"}>{settledPnl >= 0 ? "+" : ""}{money(settledPnl)}</strong>
            <small>Only positions in the winning market were settled.</small>
          </div>
          <ActionButton onClick={startNextRound}>Start next demo round <span>→</span></ActionButton>
        </section>
      )}

      {view === "markets" && <div className="demo-market-layout">
        <div className="demo-markets-column">
          <div className="subsection-heading">
            <div><span className="eyebrow">ROUND #{String(demo.roundNumber).padStart(3, "0")} MARKETS</span><h3>Choose a proposal to forecast</h3></div>
            <span className={`round-phase-pill ${demo.phase}`}><i /> {demo.phase === "trading" ? "Trading open" : demo.phase === "evaluation" ? "Evaluating" : "Settled"}</span>
          </div>
          <div className="demo-proposal-list">
            {proposals.map((proposal) => {
              const isSelected = selectedId === proposal.id;
              const position = demo.positions[proposal.id];
              const price = demo.marketPrices[proposal.id] ?? proposal.price;
              return (
                <button
                  className={`demo-proposal-card ${isSelected ? "selected" : ""} ${demo.winningProposalId === proposal.id ? "winner" : ""}`}
                  type="button"
                  key={proposal.id}
                  onClick={() => setSelectedId(proposal.id)}
                  aria-pressed={isSelected}
                >
                  <div className="demo-proposal-top">
                    <span className={`proposal-avatar avatar-${proposal.color}`}>{proposal.initials}</span>
                    <span className="demo-proposal-name"><strong>{proposal.name}</strong><small>{proposal.allocation} · {proposal.id === 0 ? "protocol baseline" : `${proposal.proposer} · $1 USDC bond`}</small></span>
                    {proposal.id === 0 && <span className="status-quo">STATUS QUO</span>}
                    {demo.winningProposalId === proposal.id && <span className="winner-tag">WINNER</span>}
                  </div>
                  <div className="demo-proposal-bottom">
                    <span>LONG price <strong>{price.toFixed(1)}¢</strong></span>
                    <span>SHORT price <strong>{(100 - price).toFixed(1)}¢</strong></span>
                    <span>Your credits <strong>{number(position.claimedCredits)}</strong></span>
                    <span>Your position <strong>{position.shares > 0 ? `${number(position.shares)} ${position.side}` : "—"}</strong></span>
                    <span>Shared LP depth <strong>{money(BASE_QUANTUM_LIQUIDITY + demo.liquidityDeposit)}</strong></span>
                  </div>
                  <span className="demo-selection-mark">{isSelected ? "✓" : ""}</span>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="demo-trade-ticket" aria-label="Forecasting trade controls">
          <div className="ticket-header"><div><span className="eyebrow">FORECAST TICKET</span><h3>{selectedProposal.name}</h3></div><span className={`ticket-avatar avatar-${selectedProposal.color}`}>{selectedProposal.initials}</span></div>
          <p className="ticket-allocation">{selectedProposal.allocation} · proposed by {selectedProposal.proposer}</p>
          <p className="ticket-rationale">{selectedProposal.rationale}</p>
          <div className="ticket-prices"><div><span>LONG</span><strong>{marketPrice.toFixed(1)}¢</strong></div><div><span>SHORT</span><strong>{(100 - marketPrice).toFixed(1)}¢</strong></div></div>
          {demo.phase === "trading" ? (
            <>
              <div className="credit-claim-box">
                <div><strong>Claim proposal credits</strong><span>Up to {money(demo.forecastDeposit)} in this market</span></div>
                <div className="inline-money-input"><input aria-label="Credits to claim in selected market" type="number" min="0.01" step="1" value={claimAmount} onChange={(event) => setClaimAmount(event.target.value)} /><span>credits</span></div>
                <div className="credit-claim-status"><span>Claimed {number(selectedPosition.claimedCredits)}</span><span>Unclaimed limit {number(Math.max(0, demo.forecastDeposit - selectedPosition.claimedCredits))}</span></div>
                <button className="button button-outline" type="button" disabled={!demo.demoAccountConnected} onClick={() => announce(claimCredits(selectedId, Number(claimAmount)))}>Claim credits for this proposal</button>
              </div>
              <div className="ticket-side-toggle" role="group" aria-label="Outcome token">
                <button type="button" disabled={selectedPosition.side === "SHORT"} className={side === "LONG" ? "active long" : ""} onClick={() => setSide("LONG")}>Buy LONG <span>↑</span></button>
                <button type="button" disabled={selectedPosition.side === "LONG"} className={side === "SHORT" ? "active short" : ""} onClick={() => setSide("SHORT")}>Buy SHORT <span>↓</span></button>
              </div>
              {selectedPosition.side && <p className="position-side-lock">You already hold {selectedPosition.side} in this proposal. The demo keeps one side per proposal until settlement.</p>}
              <label className="ticket-label" htmlFor="position-size"><span>Complete sets to trade</span><span>{number(Math.max(0, availableCredits))} credits available</span></label>
              <div className="inline-money-input trade-size-input"><input id="position-size" type="number" min="0.01" step="1" max={Math.max(0, availableCredits)} value={positionSize} onChange={(event) => setPositionSize(event.target.value)} /><span>sets</span></div>
              <div className="ticket-estimate"><span>Estimated entry cost</span><strong>{money(Number(positionSize || 0) * sidePrice / 100)}</strong></div>
              <button className="button button-primary ticket-trade-button" type="button" disabled={!demo.demoAccountConnected || demo.phase !== "trading" || availableCredits <= 0} onClick={handleTrade}>
                Buy {side} shares <span>→</span>
              </button>
              {!demo.demoAccountConnected && <small className="connect-hint">Connect a demo account to claim credits and trade.</small>}
              <p className="ticket-note">One round deposit can claim up to the same number of credits independently in every proposal.</p>
            </>
          ) : (
            <div className="ticket-closed"><strong>{demo.phase === "evaluation" ? "Market closed · awaiting oracle result" : "This round has settled"}</strong><span>Only the winning proposal position affects your forecasting P&amp;L.</span></div>
          )}
        </aside>
      </div>}

      {view === "portfolio" && <section className="positions-panel">
        <div className="positions-heading">
          <div><span className="eyebrow">YOUR FORECAST PORTFOLIO</span><h3>Positions &amp; credits</h3><p>Each market has independent credits; only the winning market settles.</p></div>
          <span className="position-count">{heldPositions.length} {demo.phase === "settled" ? "settled" : "open"} {heldPositions.length === 1 ? "position" : "positions"}</span>
        </div>
        <div className="positions-table-wrap">
          <div className="positions-table positions-table-head"><span>PROPOSAL</span><span>CREDITS CLAIMED</span><span>OUTCOME</span><span>SHARES</span><span>ENTRY</span><span>MARK / RESULT</span></div>
          {proposals.map((proposal) => {
            const position = demo.positions[proposal.id];
            const price = demo.marketPrices[proposal.id] ?? proposal.price;
            const markPrice = position.side === "LONG" ? price / 100 : (100 - price) / 100;
            const markValue = position.shares * markPrice;
            const unrealizedPnl = markValue - position.entryCost;
            const settledPnl = demo.lastSettlement?.winningProposalId === proposal.id
              ? position.shares * (position.side === "LONG" ? demo.lastSettlement.payoutProbability : 1 - demo.lastSettlement.payoutProbability) - position.entryCost
              : 0;
            return (
              <div className="positions-table positions-row" key={proposal.id}>
                <span className="position-proposal"><i className={`tiny-avatar avatar-${proposal.color}`}>{proposal.initials}</i><strong>{proposal.name}</strong></span>
                <span>{number(position.claimedCredits)} <small>/ {number(demo.phase === "settled" ? demo.lastSettlement?.forecastDeposit ?? 0 : demo.forecastDeposit)} USDC deposit</small></span>
                <span>{position.side ? <b className={`side-pill ${position.side.toLowerCase()}`}>{position.side}</b> : "—"}</span>
                <span>{position.shares > 0 ? number(position.shares) : "—"}</span>
                <span>{position.shares > 0 ? `${(position.entryPrice * 100).toFixed(1)}¢` : "—"}</span>
                {demo.phase === "settled" ? (
                  <span className={demo.lastSettlement?.winningProposalId === proposal.id ? (settledPnl >= 0 ? "positive" : "negative") : "voided-position"}>
                    {position.shares === 0 ? "No trade" : demo.lastSettlement?.winningProposalId === proposal.id ? `${settledPnl >= 0 ? "+" : ""}${money(settledPnl)}` : "Voided"}
                  </span>
                ) : (
                  <span className={unrealizedPnl >= 0 ? "positive" : "negative"}>{position.shares > 0 ? `${money(markValue)} · ${unrealizedPnl >= 0 ? "+" : ""}${money(unrealizedPnl)}` : "No position"}</span>
                )}
              </div>
            );
          })}
        </div>
        <div className="positions-footnote"><span>Round collateral: <strong>{money(demo.forecastDeposit)}</strong></span><span>Demo estimates only · no on-chain orders have been placed</span></div>
      </section>}

      {view === "vault" && <>
      <section className="vault-flow-panel" aria-label="Vault deposit and withdrawal">
        <div className="vault-flow-copy"><span className="eyebrow">VAULT FLOWS</span><h3>Deposit into the fund</h3><p>Vault deposits and withdrawals queue until the next decision boundary, matching the proposed round lifecycle.</p></div>
        <div className="vault-flow-balance"><span>Owned shares</span><strong>{number(demo.vaultShares)}</strong><small>Approx. value {money(currentVaultValue)}</small></div>
        <div className="vault-flow-queue"><span>Queued withdrawal</span><strong>{number(demo.queuedWithdrawShares)} shares</strong><small>Current share price {money(INITIAL_SHARE_PRICE)}</small></div>
        <div className="vault-flow-controls">
          <label className="inline-money-input" htmlFor="vault-deposit-amount"><input id="vault-deposit-amount" aria-label="Vault deposit amount in USDC" type="number" min="1" step="1" value={vaultDepositAmount} onChange={(event) => setVaultDepositAmount(event.target.value)} /><span>USDC</span></label>
          <button className="button button-outline" type="button" disabled={!demo.demoAccountConnected || Number(vaultDepositAmount) <= 0} onClick={() => announce(queueVaultDeposit(Number(vaultDepositAmount)))}>Queue deposit</button>
          <label className="inline-money-input" htmlFor="withdraw-shares"><input id="withdraw-shares" aria-label="Vault shares to withdraw" type="number" min="0.0001" step="0.01" placeholder="Shares to withdraw" value={vaultWithdrawAmount} onChange={(event) => setVaultWithdrawAmount(event.target.value)} /><span>shares</span></label>
          <button className="button button-outline" type="button" disabled={!demo.demoAccountConnected || Number(vaultWithdrawAmount) <= 0} onClick={() => announce(queueVaultWithdrawal(Number(vaultWithdrawAmount)))}>Queue withdrawal</button>
        </div>
      </section>
      <section className="quantum-liquidity-panel" aria-label="Quantum liquidity reserve">
        <div className="quantum-liquidity-copy">
          <span className="eyebrow">MOCK-ONLY FUTURE LP SIMULATION</span>
          <h3>One LP deposit. Depth in every market.</h3>
          <p>This simulated external-LP concept is not part of the live protocol. V1 market depth is funded by one protocol-owned reserve; external LP shares and claims remain on the roadmap.</p>
        </div>
        <div className="quantum-liquidity-metrics">
          <div><span>Shared depth per proposal</span><strong>{money(BASE_QUANTUM_LIQUIDITY + demo.liquidityDeposit)}</strong><small>Sample reserve + your contribution</small></div>
          <div><span>Your reserve contribution</span><strong>{money(demo.liquidityDeposit)}</strong><small>Separate from vault and forecast collateral</small></div>
        </div>
        <div className="quantum-liquidity-actions">
          <label className="inline-money-input" htmlFor="liquidity-amount"><input id="liquidity-amount" aria-label="Liquidity contribution in USDC" type="number" min="1" step="1" value={liquidityAmount} onChange={(event) => setLiquidityAmount(event.target.value)} /><span>USDC</span></label>
          <button className="button button-outline" type="button" disabled={!demo.demoAccountConnected || demo.phase !== "trading"} onClick={() => announce(addLiquidity(Number(liquidityAmount)))}>Add depth to every proposal</button>
          {demo.phase === "settled" && demo.liquidityDeposit > 0 && <button className="button button-outline" type="button" onClick={() => announce(withdrawLiquidity())}>Return demo LP principal</button>}
        </div>
        <p className="quantum-liquidity-disclaimer">Demo only: principal is returned after settlement. LP fees, inventory changes, and impermanent loss are not modeled.</p>
      </section>
      <p className="demo-accounting-note">Forecasting collateral and vault deposits are separate balances. Forecast credits are capped per proposal; losing markets are voided; vault flows process at collapse.</p>
      </>}
    </div>
  );
}
