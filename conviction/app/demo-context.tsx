"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type TradeSide = "LONG" | "SHORT";
export type RoundPhase = "trading" | "evaluation" | "settled";
export type DataMode = "mock" | "live";

export type Proposal = {
  id: number;
  name: string;
  asset: string;
  allocation: string;
  price: number;
  change: number;
  proposer: string;
  initials: string;
  color: string;
  rationale: string;
  liquidity: string;
  points: string;
};

export const proposals: Proposal[] = [
  {
    id: 0,
    name: "Hold current allocation",
    asset: "USDC",
    allocation: "100% USDC",
    price: 50.0,
    change: 0.0,
    proposer: "Protocol",
    initials: "WF",
    color: "mint",
    rationale: "Keep the vault in stablecoins until a stronger opportunity emerges.",
    liquidity: "$42.8k",
    points: "0,35 18,34 36,37 54,32 72,34 90,29 108,31 126,27 144,29 162,25 180,26 198,22 216,24 234,20 252,21 270,17 288,19 306,15 324,17 342,12 360,14",
  },
  {
    id: 1,
    name: "ETH momentum",
    asset: "tETH",
    allocation: "30% tETH · 70% USDC",
    price: 56.4,
    change: 3.2,
    proposer: "Momentum",
    initials: "MO",
    color: "violet",
    rationale: "ETH momentum is holding above its 7-day trend with volatility cooling.",
    liquidity: "$28.4k",
    points: "0,36 18,31 36,34 54,26 72,30 90,24 108,29 126,18 144,23 162,19 180,23 198,13 216,17 234,12 252,19 270,9 288,14 306,7 324,12 342,4 360,8",
  },
  {
    id: 2,
    name: "ETH mean reversion",
    asset: "tETH",
    allocation: "15% tETH · 85% USDC",
    price: 47.8,
    change: -1.4,
    proposer: "Mean Rev.",
    initials: "MR",
    color: "amber",
    rationale: "A smaller position balances a stretched price move with downside protection.",
    liquidity: "$19.6k",
    points: "0,10 18,14 36,12 54,20 72,17 90,24 108,18 126,28 144,22 162,30 180,25 198,34 216,28 234,32 252,26 270,35 288,31 306,37 324,32 342,39 360,36",
  },
];

export type Position = {
  claimedCredits: number;
  sets: number;
  side: TradeSide | null;
  entryPrice: number;
  entryCost: number;
  proceeds: number;
  shares: number;
};

export type PriceSample = { timestamp: number; price: number };

export type DemoState = {
  version: 1;
  demoUSDC: number;
  forecastDeposit: number;
  vaultShares: number;
  vaultDeposited: number;
  queuedVaultDeposit: number;
  queuedWithdrawShares: number;
  liquidityDeposit: number;
  positions: Record<number, Position>;
  marketPrices: Record<number, number>;
  priceHistory: Record<number, PriceSample[]>;
  phase: RoundPhase;
  roundNumber: number;
  winningProposalId: number | null;
  realizedReturn: number | null;
  lastSettlement: {
    roundNumber: number;
    winningProposalId: number;
    forecastDeposit: number;
    realizedReturn: number;
    payoutProbability: number;
    pnl: number;
    timestamp: number;
  } | null;
  demoAccountConnected: boolean;
};

export const INITIAL_VAULT_TVL = 284392.18;
export const INITIAL_SHARE_PRICE = 1.0842;
export const BASE_QUANTUM_LIQUIDITY = 10000;
const STORAGE_KEY = "wavefund-demo-v2";

function emptyPosition(): Position {
  return {
    claimedCredits: 0,
    sets: 0,
    side: null,
    entryPrice: 0,
    entryCost: 0,
    proceeds: 0,
    shares: 0,
  };
}

export function createInitialDemoState(): DemoState {
  return {
    version: 1,
    demoUSDC: 10000,
    forecastDeposit: 0,
    vaultShares: 0,
    vaultDeposited: 0,
    queuedVaultDeposit: 0,
    queuedWithdrawShares: 0,
    liquidityDeposit: 0,
    positions: Object.fromEntries(proposals.map(({ id }) => [id, emptyPosition()])),
    marketPrices: Object.fromEntries(proposals.map(({ id, price }) => [id, price])),
    priceHistory: Object.fromEntries(proposals.map(({ id }) => [id, []])),
    phase: "trading",
    roundNumber: 24,
    winningProposalId: null,
    realizedReturn: null,
    lastSettlement: null,
    demoAccountConnected: false,
  };
}

function isDemoState(value: unknown): value is DemoState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<DemoState>;
  return state.version === 1
    && typeof state.demoUSDC === "number"
    && typeof state.forecastDeposit === "number"
    && typeof state.vaultShares === "number"
    && typeof state.queuedVaultDeposit === "number"
    && typeof state.queuedWithdrawShares === "number"
    && typeof state.liquidityDeposit === "number"
    && typeof state.positions === "object"
    && typeof state.marketPrices === "object"
    && typeof state.phase === "string"
    && typeof state.roundNumber === "number";
}

type ActionResult = { ok: true; message: string } | { ok: false; message: string };
type DemoContextValue = {
  demo: DemoState;
  storageWarning: string;
  mode: DataMode;
  setMode: (mode: DataMode) => void;
  connectDemoAccount: () => void;
  addDemoFunds: (amount: number) => ActionResult;
  depositForecast: (amount: number) => ActionResult;
  claimCredits: (proposalId: number, amount: number) => ActionResult;
  trade: (proposalId: number, side: TradeSide, sets: number) => ActionResult;
  queueVaultDeposit: (amount: number) => ActionResult;
  queueVaultWithdrawal: (shares: number) => ActionResult;
  addLiquidity: (amount: number) => ActionResult;
  withdrawLiquidity: () => ActionResult;
  collapseRound: () => ActionResult;
  settleRound: (realizedReturn: number) => ActionResult;
  startNextRound: () => void;
  resetDemo: () => void;
};

const DemoContext = createContext<DemoContextValue | null>(null);

function calculateTwap(
  proposalId: number,
  marketPrices: Record<number, number>,
  priceHistory: Record<number, PriceSample[]>,
  now: number,
) {
  const start = now - 60_000;
  const initialPrice = proposals.find((proposal) => proposal.id === proposalId)?.price ?? 50;
  const samples = (priceHistory[proposalId] ?? []).filter((sample) => sample.timestamp <= now).sort((a, b) => a.timestamp - b.timestamp);
  let cursor = start;
  let price = initialPrice;
  let weightedPrice = 0;

  for (const sample of samples) {
    if (sample.timestamp <= start) {
      price = sample.price;
      continue;
    }
    weightedPrice += price * (sample.timestamp - cursor);
    cursor = sample.timestamp;
    price = sample.price;
  }

  weightedPrice += price * (now - cursor);
  return weightedPrice / 60_000 || marketPrices[proposalId] || initialPrice;
}

export function DemoProvider({ children }: { children: ReactNode }) {
  const [demo, setDemo] = useState<DemoState>(createInitialDemoState);
  const [mode, setMode] = useState<DataMode>("mock");
  const [storageWarning, setStorageWarning] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        if (!isDemoState(parsed)) {
          throw new Error("Saved demo state has an unsupported format.");
        }
        setDemo(parsed);
      } else {
        setDemo((current) => ({
          ...current,
          priceHistory: Object.fromEntries(
            proposals.map(({ id }) => [
              id,
              [{ timestamp: Date.now(), price: current.marketPrices[id] ?? 50 }],
            ]),
          ),
        }));
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Browser storage is unavailable.";
      setStorageWarning(`Could not load saved demo state: ${detail}`);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(demo));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Browser storage is unavailable.";
      setStorageWarning(`Could not save demo state: ${detail}`);
    }
  }, [demo, hydrated]);

  const value = useMemo<DemoContextValue>(() => ({
    demo,
    storageWarning,
    mode,
    setMode,
    connectDemoAccount: () => {
      setDemo((current) => ({ ...current, demoAccountConnected: true }));
    },
    addDemoFunds: (amount) => {
      if (!Number.isFinite(amount) || amount <= 0) return { ok: false, message: "Enter a valid faucet amount." };
      setDemo((current) => ({ ...current, demoUSDC: current.demoUSDC + amount }));
      return { ok: true, message: `${amount.toLocaleString()} demo USDC added to your account.` };
    },
    depositForecast: (amount) => {
      if (!demo.demoAccountConnected) return { ok: false, message: "Connect the demo account before depositing." };
      if (demo.phase !== "trading") return { ok: false, message: "Forecast deposits are closed for this round." };
      if (!Number.isFinite(amount) || amount <= 0) return { ok: false, message: "Enter a valid forecasting deposit." };
      if (amount > demo.demoUSDC) return { ok: false, message: "Not enough demo USDC in your account." };
      setDemo((current) => ({
        ...current,
        demoUSDC: current.demoUSDC - amount,
        forecastDeposit: current.forecastDeposit + amount,
      }));
      return { ok: true, message: `${amount.toLocaleString()} USDC added to this round's forecasting deposit.` };
    },
    claimCredits: (proposalId, amount) => {
      if (!demo.demoAccountConnected) return { ok: false, message: "Connect the demo account before claiming credits." };
      if (demo.phase !== "trading") return { ok: false, message: "This market is no longer open for credit claims." };
      if (!Number.isFinite(amount) || amount <= 0) return { ok: false, message: "Enter a valid credit amount." };
      const position = demo.positions[proposalId] ?? emptyPosition();
      if (position.claimedCredits + amount > demo.forecastDeposit) {
        return { ok: false, message: "Claiming credits in this proposal cannot exceed your round deposit." };
      }
      setDemo((current) => ({
        ...current,
        positions: {
          ...current.positions,
          [proposalId]: {
            ...(current.positions[proposalId] ?? emptyPosition()),
            claimedCredits: (current.positions[proposalId]?.claimedCredits ?? 0) + amount,
          },
        },
      }));
      return { ok: true, message: `${amount.toLocaleString()} credits claimed in proposal ${proposalId}.` };
    },
    trade: (proposalId, side, sets) => {
      if (!demo.demoAccountConnected) return { ok: false, message: "Connect the demo account before trading." };
      if (demo.phase !== "trading") return { ok: false, message: "Trading is closed for this round." };
      if (!Number.isFinite(sets) || sets <= 0) return { ok: false, message: "Enter a valid position size." };
      const position = demo.positions[proposalId] ?? emptyPosition();
      if (position.claimedCredits - position.sets < sets) {
        return { ok: false, message: "Claim more credits in this proposal before trading." };
      }
      if (position.side && position.side !== side) {
        return { ok: false, message: "This demo supports one outcome side per proposal. Close this position after settlement to choose the other side." };
      }
      const longPrice = demo.marketPrices[proposalId] ?? 50;
      const sidePrice = side === "LONG" ? longPrice : 100 - longPrice;
      const entryCost = sets * sidePrice / 100;
      const priceImpact = Math.min(2, sets / (2000 + demo.liquidityDeposit));
      const nextLongPrice = Math.max(1, Math.min(99, longPrice + (side === "LONG" ? priceImpact : -priceImpact)));
      const timestamp = Date.now();
      setDemo((current) => {
        const currentPosition = current.positions[proposalId] ?? emptyPosition();
        const nextHistory = [...(current.priceHistory[proposalId] ?? []), { timestamp, price: nextLongPrice }]
          .filter((sample) => sample.timestamp >= timestamp - 10 * 60_000);
        return {
          ...current,
          marketPrices: { ...current.marketPrices, [proposalId]: nextLongPrice },
          priceHistory: { ...current.priceHistory, [proposalId]: nextHistory },
          positions: {
            ...current.positions,
            [proposalId]: {
              ...currentPosition,
              side,
              sets: currentPosition.sets + sets,
              shares: currentPosition.shares + sets,
              entryCost: currentPosition.entryCost + entryCost,
              entryPrice: (currentPosition.entryCost + entryCost) / (currentPosition.shares + sets),
              proceeds: currentPosition.proceeds + sets * (1 - sidePrice / 100),
            },
          },
        };
      });
      return { ok: true, message: `Bought ${sets.toLocaleString()} ${side} shares in ${proposals.find((proposal) => proposal.id === proposalId)?.name}.` };
    },
    queueVaultDeposit: (amount) => {
      if (!demo.demoAccountConnected) return { ok: false, message: "Connect the demo account before queueing a vault deposit." };
      if (!Number.isFinite(amount) || amount <= 0) return { ok: false, message: "Enter a valid vault deposit." };
      if (amount > demo.demoUSDC) return { ok: false, message: "Not enough demo USDC in your account." };
      setDemo((current) => ({
        ...current,
        demoUSDC: current.demoUSDC - amount,
        queuedVaultDeposit: current.queuedVaultDeposit + amount,
      }));
      return { ok: true, message: `${amount.toLocaleString()} USDC queued for the next vault decision boundary.` };
    },
    queueVaultWithdrawal: (shares) => {
      if (!demo.demoAccountConnected) return { ok: false, message: "Connect the demo account before queueing a withdrawal." };
      const availableShares = demo.vaultShares - demo.queuedWithdrawShares;
      if (!Number.isFinite(shares) || shares <= 0) return { ok: false, message: "Enter a valid share amount." };
      if (shares > availableShares) return { ok: false, message: "That exceeds your available, unqueued vault shares." };
      setDemo((current) => ({
        ...current,
        queuedWithdrawShares: current.queuedWithdrawShares + shares,
      }));
      return { ok: true, message: `${shares.toFixed(4)} vault shares queued for withdrawal at the next decision boundary.` };
    },
    addLiquidity: (amount) => {
      if (!demo.demoAccountConnected) return { ok: false, message: "Connect the demo account before adding liquidity." };
      if (demo.phase !== "trading") return { ok: false, message: "Shared liquidity can be added while a round is trading." };
      if (!Number.isFinite(amount) || amount <= 0) return { ok: false, message: "Enter a valid liquidity amount." };
      if (amount > demo.demoUSDC) return { ok: false, message: "Not enough demo USDC in your account." };
      setDemo((current) => ({
        ...current,
        demoUSDC: current.demoUSDC - amount,
        liquidityDeposit: current.liquidityDeposit + amount,
      }));
      return { ok: true, message: `${amount.toLocaleString()} USDC added to shared depth across all proposal pools.` };
    },
    withdrawLiquidity: () => {
      if (demo.phase !== "settled") return { ok: false, message: "Liquidity can be withdrawn after this round settles." };
      if (demo.liquidityDeposit <= 0) return { ok: false, message: "There is no demo liquidity position to withdraw." };
      const amount = demo.liquidityDeposit;
      setDemo((current) => ({
        ...current,
        demoUSDC: current.demoUSDC + current.liquidityDeposit,
        liquidityDeposit: 0,
      }));
      return { ok: true, message: `${amount.toLocaleString()} demo USDC liquidity principal returned after settlement. LP fees and impermanent loss are not simulated.` };
    },
    collapseRound: () => {
      if (demo.phase !== "trading") return { ok: false, message: "This round is no longer accepting trades." };
      const now = Date.now();
      const twaps = proposals.map((proposal) => ({
        id: proposal.id,
        twap: calculateTwap(proposal.id, demo.marketPrices, demo.priceHistory, now),
      }));
      const statusQuo = twaps.find((proposal) => proposal.id === 0)?.twap ?? 50;
      const bestCandidate = twaps.filter((proposal) => proposal.id !== 0).sort((a, b) => b.twap - a.twap)[0];
      const winningProposalId = bestCandidate && bestCandidate.twap >= statusQuo + 0.5 ? bestCandidate.id : 0;
      const boundaryVaultDeposit = demo.queuedVaultDeposit;
      const boundaryWithdrawValue = demo.queuedWithdrawShares * INITIAL_SHARE_PRICE;
      setDemo((current) => ({
        ...current,
        phase: "evaluation",
        winningProposalId,
        vaultShares: current.vaultShares
          + current.queuedVaultDeposit / INITIAL_SHARE_PRICE
          - current.queuedWithdrawShares,
        vaultDeposited: current.vaultDeposited + boundaryVaultDeposit - boundaryWithdrawValue,
        queuedVaultDeposit: 0,
        queuedWithdrawShares: 0,
        demoUSDC: current.demoUSDC + boundaryWithdrawValue,
      }));
      const winner = proposals.find((proposal) => proposal.id === winningProposalId);
      return {
        ok: true,
        message: `Round collapsed on ${winner?.name ?? "the status quo"} using the final-window TWAP. Queued vault flows were processed.`,
      };
    },
    settleRound: (realizedReturn) => {
      if (demo.phase !== "evaluation" || demo.winningProposalId === null) {
        return { ok: false, message: "Collapse the round before settling its outcome." };
      }
      if (!Number.isFinite(realizedReturn) || realizedReturn <= 0) {
        return { ok: false, message: "Enter a valid realized vault return." };
      }
      const clippedReturn = Math.max(0.95, Math.min(1.05, realizedReturn));
      const payoutProbability = (clippedReturn - 0.95) / 0.1;
      const winningPosition = demo.positions[demo.winningProposalId] ?? emptyPosition();
      const winningPayout = winningPosition.side === "LONG"
        ? payoutProbability
        : winningPosition.side === "SHORT"
          ? 1 - payoutProbability
          : 0;
      const pnl = winningPosition.shares * winningPayout - winningPosition.entryCost;
      const settlement = {
        roundNumber: demo.roundNumber,
        winningProposalId: demo.winningProposalId,
        forecastDeposit: demo.forecastDeposit,
        realizedReturn,
        payoutProbability,
        pnl,
        timestamp: Date.now(),
      };
      setDemo((current) => ({
        ...current,
        phase: "settled",
        realizedReturn,
        demoUSDC: current.demoUSDC + current.forecastDeposit + pnl,
        forecastDeposit: 0,
        lastSettlement: settlement,
      }));
      return {
        ok: true,
        message: `Round settled. Your winning-market forecast P&L was ${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)} USDC.`,
      };
    },
    startNextRound: () => {
      setDemo((current) => ({
        ...current,
        phase: "trading",
        roundNumber: current.roundNumber + 1,
        forecastDeposit: 0,
        positions: Object.fromEntries(proposals.map(({ id }) => [id, emptyPosition()])),
        marketPrices: Object.fromEntries(proposals.map(({ id, price }) => [id, price])),
        priceHistory: Object.fromEntries(
          proposals.map(({ id, price }) => [id, [{ timestamp: Date.now(), price }]]),
        ),
        winningProposalId: null,
        realizedReturn: null,
      }));
    },
    resetDemo: () => {
      setDemo({
        ...createInitialDemoState(),
        priceHistory: Object.fromEntries(
          proposals.map(({ id, price }) => [id, [{ timestamp: Date.now(), price }]]),
        ),
      });
      setStorageWarning("");
    },
  }), [demo, mode, storageWarning]);

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo() {
  const context = useContext(DemoContext);
  if (!context) throw new Error("useDemo must be used inside DemoProvider.");
  return context;
}
