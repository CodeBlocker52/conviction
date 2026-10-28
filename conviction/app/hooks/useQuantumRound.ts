"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isRateLimitError, setRpcStale } from "../lib/rpc";
import { formatUnits, type Address, type Hash } from "viem";
import {
  addresses,
  arcTestnet,
  erc20Abi,
  proposalMarketAbi,
  proposerRegistryAbi,
  proposalTokensAbi,
  publicClient,
  quantumRoundAbi,
  vaultAbi,
  waveHookAbi,
} from "../lib/contracts";
import { fetchLogs, type ExplorerLog } from "../lib/explorer";
import { fmtToken, parseCredits, parseToken, shortAddress } from "../lib/format";
import {
  BOUNDARY_MESSAGE,
  outsideBounds,
  poolIdOf,
  probabilityAfterSwap,
  probabilityFromSqrt,
  readPoolState,
  type PoolKeyTuple,
} from "../lib/market";
import { useWallet } from "./useWallet";

export type RoundPhase = "trading" | "closed" | "collapsed" | "settled" | "cancelled";

export type LiveProposal = {
  id: number;
  proposer: Address;
  proposerName: string;
  rationale: string;
  tEthBps: number;
  isStatusQuo: boolean;
  /** LONG probability from the hook, 0 to 1. Null only if the pool could not be read. */
  pLong: number | null;
  pShort: number | null;
  /** Final-window TWAP of pLong (0 to 1). */
  twap: number | null;
  /** True when the pool sits on the 0.01 / 0.99 edge of its liquidity range. */
  atBoundary: boolean;
  /** rMin + pLong * (rMax - rMin), as a percentage change. */
  impliedReturn: number | null;
  /** Pool marginal price in SHORT per LONG, p / (1 - p). */
  poolRatio: number | null;
  claimedCredits: bigint;
  creditBalance: bigint;
  longBalance: bigint;
  shortBalance: bigint;
  longToken: Address;
  shortToken: Address;
  poolKey: PoolKeyTuple;
  tradingStart: bigint;
  tradingEnd: bigint;
  finalWindowSeconds: bigint;
  /** Markets are finalised (liquidity pulled, seed returned) at collapse. */
  finalized: boolean;
};

export type VaultTrade = {
  roundId: bigint;
  kind: "executed" | "cancelled";
  txHash: Hash;
  winnerTEthBps?: number;
  deltaUsdc?: bigint;
  deltaTEth?: bigint;
  navUsdc?: bigint;
  realisedReturn?: bigint;
};

export type LiveRound = {
  id: bigint;
  tradingEnd: bigint;
  evaluationEnd: bigint;
  rMin: bigint;
  rMax: bigint;
  twapWindow: number;
  finalWindowStart: bigint;
  proposalCount: number;
  winnerProposalId: number | null;
  collapsed: boolean;
  settled: boolean;
  cancelled: boolean;
  totalDeposited: bigint;
  realisedReturn: bigint;
  phase: RoundPhase;
  deposit: bigint;
  proposals: LiveProposal[];
  /** USDC the wallet can redeem now (settled or cancelled rounds only). */
  redeemable: bigint;
  /** Payout in credits for one LONG / SHORT of the winning proposal, once settled. */
  payoutPerLong: number | null;
  payoutPerShort: number | null;
  vaultTrade: VaultTrade | null;
};

export type VaultHistoryItem = {
  roundId: bigint;
  timestamp: bigint;
  navUsdc: bigint;
  realisedReturn: bigint | null;
  allocationBps: number | null;
  status: string;
  trade: VaultTrade | null;
};

export type LiveSnapshot = {
  roundCount: bigint;
  round: LiveRound | null;
  /** Recent rounds in which the connected wallet holds a deposit or tokens. */
  portfolio: LiveRound[];
  usdcBalance: bigint | null;
  protocolSeed: bigint;
  vault: {
    navUsdc: bigint;
    usdcBalance: bigint;
    tEthBalance: bigint;
    oraclePriceUsdc: bigint;
    spotPriceUsdc: bigint;
    tEthAllocationBps: number;
    shareSupply: bigint;
    shareBalance: bigint;
    queuedDeposit: bigint;
    queuedWithdrawal: bigint;
    totalQueuedDeposit: bigint;
    totalQueuedWithdrawal: bigint;
  };
  history: VaultHistoryItem[];
};

export type TradeSide = "LONG" | "SHORT";
export type TradeAction = "buy" | "sell";

export type TradeQuote = {
  action: TradeAction;
  side: TradeSide;
  amountIn: bigint;
  /** Tokens (buy, 18 decimals) or credits (sell, 6 decimals). */
  expectedOut: bigint;
  minOut: bigint;
  /** Credits paid or received per LONG/SHORT. */
  averagePrice: number | null;
  /** Percent difference between average and marginal price; positive means worse for the trader. */
  priceImpactPct: number | null;
  pAfter: number | null;
  hitsBoundary: boolean;
  /** Sells return unpaired tokens as dust. */
  dust: { long: bigint; short: bigint } | null;
};

export const SLIPPAGE_BPS = 50n;
const asMessage = (error: unknown) => error instanceof Error ? error.message : "On-chain request failed.";
const POLL_MS = 30_000;
const friendlyError = (error: unknown) =>
  isRateLimitError(error)
    ? "The Arc RPC is rate limiting requests. Retrying shortly."
    : "Could not read Arc Testnet right now. Retrying shortly.";
const SCALAR = 10n ** 18n;
const POOL_FEE = 3_000;
const POOL_TICK_SPACING = 60;

type RoundTuple = readonly [
  bigint, bigint, bigint, bigint, bigint, number, bigint, bigint, bigint, boolean, boolean, bigint, bigint, boolean,
];

const tokenCache = new Map<string, { credit: Address; long: Address; short: Address }>();

async function tokensFor(roundId: bigint, proposalId: number) {
  const cacheKey = `${roundId}:${proposalId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached) return cached;
  const [credit, long, short] = await Promise.all(
    (["creditToken", "longToken", "shortToken"] as const).map((functionName) => publicClient.readContract({
      address: addresses.proposalTokens,
      abi: proposalTokensAbi,
      functionName,
      args: [roundId, BigInt(proposalId)],
    })),
  );
  const value = { credit, long, short };
  tokenCache.set(cacheKey, value);
  return value;
}

const nameCache = new Map<string, string>();

async function proposerName(proposer: Address) {
  const cached = nameCache.get(proposer);
  if (cached) return cached;
  let name = "";
  try {
    name = (await publicClient.readContract({
      address: addresses.proposerRegistry,
      abi: proposerRegistryAbi,
      functionName: "agents",
      args: [proposer],
    }))[0];
  } catch {
    name = "";
  }
  const resolved = name || shortAddress(proposer);
  if (name) nameCache.set(proposer, resolved);
  return resolved;
}

let vaultLogCache: { at: number; logs: ExplorerLog[] } | null = null;

async function vaultLogs() {
  if (vaultLogCache && Date.now() - vaultLogCache.at < 30_000) return vaultLogCache.logs;
  const logs = await fetchLogs(addresses.vault);
  vaultLogCache = { at: Date.now(), logs };
  return logs;
}

function vaultTradeFor(roundId: bigint, logs: ExplorerLog[]): VaultTrade | null {
  const id = roundId.toString();
  const forRound = logs.filter((log) => log.params.roundId === id);
  const executed = forRound.find((log) => log.name === "TradeExecuted");
  const cancelled = forRound.find((log) => log.name === "TradeCancelled");
  const marked = forRound.find((log) => log.name === "NAVMarked");
  const reported = forRound.find((log) => log.name === "ReturnReported");
  if (executed) {
    return {
      roundId,
      kind: "executed",
      txHash: executed.txHash,
      winnerTEthBps: Number(executed.params.winnerTEthBps),
      deltaUsdc: BigInt(executed.params.deltaUsdc),
      deltaTEth: BigInt(executed.params.deltaTEth),
      navUsdc: marked ? BigInt(marked.params.navUsdc) : undefined,
      realisedReturn: reported ? BigInt(reported.params.realisedReturn) : undefined,
    };
  }
  if (cancelled) return { roundId, kind: "cancelled", txHash: cancelled.txHash };
  return null;
}

function phaseOf(round: { collapsed: boolean; settled: boolean; cancelled: boolean; tradingEnd: bigint }): RoundPhase {
  if (round.cancelled) return "cancelled";
  if (round.settled) return "settled";
  if (round.collapsed) return "collapsed";
  return BigInt(Math.floor(Date.now() / 1000)) >= round.tradingEnd ? "closed" : "trading";
}

async function readProposal(params: {
  roundId: bigint;
  id: number;
  rMin: bigint;
  rMax: bigint;
  collapsed: boolean;
  account: Address | undefined;
  full: boolean;
}): Promise<LiveProposal> {
  const { roundId, id, rMin, rMax, collapsed, account, full } = params;
  const bigId = BigInt(id);
  const [proposal, tokens] = await Promise.all([
    publicClient.readContract({ address: addresses.quantumRound, abi: quantumRoundAbi, functionName: "proposals", args: [roundId, bigId] }),
    tokensFor(roundId, id),
  ]);
  // The adapter's poolKey() reverts once a market is finalised, so the key is rebuilt the way the adapter builds it.
  const longFirst = BigInt(tokens.long) < BigInt(tokens.short);
  const key: PoolKeyTuple = {
    currency0: longFirst ? tokens.long : tokens.short,
    currency1: longFirst ? tokens.short : tokens.long,
    fee: POOL_FEE,
    tickSpacing: POOL_TICK_SPACING,
    hooks: addresses.waveHook,
  };
  const [claimedCredits, balances, name, details] = await Promise.all([
    account
      ? publicClient.readContract({ address: addresses.quantumRound, abi: quantumRoundAbi, functionName: "creditsClaimed", args: [roundId, bigId, account] })
      : Promise.resolve(0n),
    account
      ? Promise.all([tokens.credit, tokens.long, tokens.short].map((token) => publicClient.readContract({
        address: token, abi: erc20Abi, functionName: "balanceOf", args: [account],
      })))
      : Promise.resolve([0n, 0n, 0n]),
    full && id !== 0 ? proposerName(proposal[1]) : Promise.resolve("Protocol"),
    publicClient.readContract({ address: addresses.waveHook, abi: waveHookAbi, functionName: "poolDetails", args: [poolIdOf(key)] }),
  ]);

  let pLong: number | null = null;
  let twap: number | null = null;
  let atBoundary = false;
  if (full) {
    try {
      const [long] = await publicClient.readContract({
        address: addresses.market, abi: proposalMarketAbi, functionName: "probabilities", args: [roundId, bigId],
      });
      pLong = Number(formatUnits(long, 18));
    } catch {
      // The adapter reverts once a market is finalised, and the hook reverts at the 0.01 / 0.99 edge.
      try {
        pLong = Number(formatUnits(await publicClient.readContract({
          address: addresses.waveHook, abi: waveHookAbi, functionName: "pLong", args: [key],
        }), 18));
      } catch {
        try {
          const pool = await readPoolState(key);
          pLong = probabilityFromSqrt(pool.sqrtPriceX96, key.currency0 === tokens.long);
          atBoundary = true;
        } catch {
          pLong = null;
        }
      }
    }
    try {
      twap = Number(formatUnits(await publicClient.readContract({
        address: addresses.market, abi: proposalMarketAbi, functionName: "probabilityTwap", args: [roundId, bigId, 0n, 0n],
      }), 18));
    } catch {
      try {
        twap = Number(formatUnits(await publicClient.readContract({
          address: addresses.waveHook, abi: waveHookAbi, functionName: "finalWindowTwap", args: [key],
        }), 18));
      } catch {
        twap = null;
      }
    }
  }
  const range = Number(rMax - rMin) / 1e18;
  const impliedReturn = pLong === null ? null : (Number(rMin) / 1e18 + pLong * range - 1) * 100;
  return {
    id,
    proposer: proposal[1],
    proposerName: name,
    rationale: proposal[3],
    tEthBps: Number(proposal[2].tEthBps),
    isStatusQuo: proposal[6],
    pLong,
    pShort: pLong === null ? null : 1 - pLong,
    twap,
    atBoundary,
    impliedReturn,
    poolRatio: pLong === null ? null : pLong / (1 - pLong),
    claimedCredits,
    creditBalance: balances[0],
    longBalance: balances[1],
    shortBalance: balances[2],
    longToken: tokens.long,
    shortToken: tokens.short,
    poolKey: key,
    tradingStart: details[3],
    tradingEnd: details[4],
    finalWindowSeconds: details[5],
    finalized: collapsed,
  };
}

async function readRound(roundId: bigint, account: Address | undefined, full: boolean, scale: bigint, logs: ExplorerLog[]): Promise<LiveRound> {
  const values = await publicClient.readContract({
    address: addresses.quantumRound, abi: quantumRoundAbi, functionName: "rounds", args: [roundId],
  }) as unknown as RoundTuple;
  const base = {
    tradingEnd: values[1],
    evaluationEnd: values[2],
    rMin: values[3],
    rMax: values[4],
    twapWindow: Number(values[5]),
    proposalCount: Number(values[7]),
    winnerProposalId: values[8],
    collapsed: values[9],
    settled: values[10],
    realisedReturn: values[11],
    totalDeposited: values[12],
    cancelled: values[13],
  };
  const [deposit, proposals] = await Promise.all([
    account ? publicClient.readContract({ address: addresses.quantumRound, abi: quantumRoundAbi, functionName: "deposits", args: [roundId, account] }) : Promise.resolve(0n),
    Promise.all(Array.from({ length: base.proposalCount }, (_, id) => readProposal({
      roundId, id, rMin: base.rMin, rMax: base.rMax, collapsed: base.collapsed, account, full,
    }))),
  ]);
  const phase = phaseOf(base);
  const winner = base.collapsed ? Number(base.winnerProposalId) : null;

  // Mirrors QuantumRound.redeem: the realised return is clamped into [rMin, rMax] before payouts.
  let payoutPerLong: number | null = null;
  let payoutPerShort: number | null = null;
  let redeemable = 0n;
  const span = base.rMax - base.rMin;
  if (base.settled && !base.cancelled) {
    const clamped = base.realisedReturn < base.rMin ? base.rMin : base.realisedReturn > base.rMax ? base.rMax : base.realisedReturn;
    const numer = clamped - base.rMin;
    payoutPerLong = Number(numer) / Number(span);
    payoutPerShort = 1 - payoutPerLong;
    if (account) {
      // Only the winner's credits and tokens count; the cap is per proposal, so erased markets never reduce it.
      const won = proposals.find((item) => item.id === winner);
      const claimedWinner = won?.claimedCredits ?? 0n;
      let payout = deposit > claimedWinner ? deposit - claimedWinner : 0n;
      if (won) {
        payout += won.creditBalance;
        payout += (won.longBalance * numer) / (span * scale);
        payout += (won.shortBalance * (span - numer)) / (span * scale);
      }
      redeemable = payout;
    }
  } else if (base.cancelled) {
    redeemable = deposit;
  }

  return {
    id: roundId,
    ...base,
    finalWindowStart: base.tradingEnd - BigInt(base.twapWindow),
    winnerProposalId: winner,
    phase,
    deposit,
    proposals,
    redeemable,
    payoutPerLong,
    payoutPerShort,
    vaultTrade: base.collapsed ? vaultTradeFor(roundId, logs) : null,
  };
}

export function useQuantumRound(enabled: boolean) {
  const { address, chainId, walletClient } = useWallet();
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const forceRef = useRef(false);
  const historyCache = useRef<{ key: string; history: VaultHistoryItem[] } | null>(null);
  const pastRounds = useRef(new Map<string, LiveRound>());

  const refresh = useCallback(async () => {
    const force = forceRef.current;
    forceRef.current = false;
    if (force) {
      historyCache.current = null;
      pastRounds.current.clear();
      vaultLogCache = null;
    }
    const [
      roundCount,
      usdcBalance,
      protocolSeed,
      vaultUsdc,
      vaultTEth,
      oraclePrice,
      spotPrice,
      shareSupply,
      shareBalance,
      queuedDeposit,
      queuedWithdrawal,
      totalQueuedDeposit,
      totalQueuedWithdrawal,
      scale,
    ] = await Promise.all([
      publicClient.readContract({ address: addresses.quantumRound, abi: quantumRoundAbi, functionName: "roundCount" }),
      address ? publicClient.readContract({ address: addresses.usdc, abi: erc20Abi, functionName: "balanceOf", args: [address] }) : Promise.resolve(null),
      publicClient.readContract({ address: addresses.quantumRound, abi: quantumRoundAbi, functionName: "protocolLiquiditySeed" }),
      publicClient.readContract({ address: addresses.vault, abi: vaultAbi, functionName: "totalVaultUsdc" }),
      publicClient.readContract({ address: addresses.vault, abi: vaultAbi, functionName: "totalVaultTEth" }),
      publicClient.readContract({ address: addresses.vault, abi: vaultAbi, functionName: "oraclePriceTEthInUsdc" }),
      publicClient.readContract({ address: addresses.vault, abi: vaultAbi, functionName: "spotPriceTEthInUsdc" }),
      publicClient.readContract({ address: addresses.vault, abi: erc20Abi, functionName: "totalSupply" }),
      address ? publicClient.readContract({ address: addresses.vault, abi: erc20Abi, functionName: "balanceOf", args: [address] }) : Promise.resolve(0n),
      address ? publicClient.readContract({ address: addresses.vault, abi: vaultAbi, functionName: "queuedDepositUsdc", args: [address] }) : Promise.resolve(0n),
      address ? publicClient.readContract({ address: addresses.vault, abi: vaultAbi, functionName: "queuedWithdrawalShares", args: [address] }) : Promise.resolve(0n),
      publicClient.readContract({ address: addresses.vault, abi: vaultAbi, functionName: "totalQueuedDepositUsdc" }),
      publicClient.readContract({ address: addresses.vault, abi: vaultAbi, functionName: "totalQueuedWithdrawalShares" }),
      publicClient.readContract({ address: addresses.market, abi: proposalMarketAbi, functionName: "completeSetScale" }),
    ]);
    const tEthValue = (vaultTEth * oraclePrice) / SCALAR;
    const navUsdc = vaultUsdc + tEthValue;
    const tEthAllocationBps = navUsdc === 0n ? 0 : Number((tEthValue * 10_000n) / navUsdc);

    // Event history is optional; a failing explorer must not hide on-chain state.
    const logs = await vaultLogs().catch(() => [] as ExplorerLog[]);

    let round: LiveRound | null = null;
    const portfolio: LiveRound[] = [];
    if (roundCount > 0n) {
      round = await readRound(roundCount, address ?? undefined, true, scale, logs);
      if (address) {
        const earliest = roundCount > 6n ? roundCount - 5n : 1n;
        for (let id = roundCount; id >= earliest; id--) {
          const cacheKey = `${address}:${id}:${roundCount}`;
          let item = id === roundCount ? round : pastRounds.current.get(cacheKey);
          if (!item) {
            item = await readRound(id, address, false, scale, logs);
            if (item.phase === "settled" || item.phase === "cancelled") pastRounds.current.set(cacheKey, item);
          }
          const holds = item.deposit > 0n || item.proposals.some((p) => p.creditBalance + p.longBalance + p.shortBalance > 0n);
          if (holds) portfolio.push(item);
        }
      }
    }

    const firstHistoryRound = roundCount > 20n ? roundCount - 19n : 1n;
    const historyKey = `${roundCount}:${round?.phase ?? "none"}:${round?.vaultTrade ? "t" : "n"}`;
    const history = historyCache.current?.key === historyKey
      ? historyCache.current.history
      : roundCount === 0n
      ? []
      : await Promise.all(Array.from({ length: Number(roundCount - firstHistoryRound + 1n) }, async (_, index) => {
        const id = firstHistoryRound + BigInt(index);
        const [values, state] = await Promise.all([
          publicClient.readContract({ address: addresses.quantumRound, abi: quantumRoundAbi, functionName: "rounds", args: [id] }) as unknown as Promise<RoundTuple>,
          publicClient.readContract({ address: addresses.vault, abi: vaultAbi, functionName: "roundState", args: [id] }),
        ]);
        const past = { collapsed: values[9], settled: values[10], cancelled: values[13], tradingEnd: values[1] };
        let allocationBps: number | null = null;
        if (past.collapsed && !past.cancelled) {
          const winner = await publicClient.readContract({
            address: addresses.quantumRound, abi: quantumRoundAbi, functionName: "proposals", args: [id, values[8]],
          });
          allocationBps = Number(winner[2].tEthBps);
        }
        const phase = phaseOf(past);
        return {
          roundId: id,
          timestamp: state[4],
          navUsdc: state[0],
          realisedReturn: past.settled && !past.cancelled ? values[11] : null,
          allocationBps,
          status: phase === "collapsed" ? "Evaluating" : phase === "closed" ? "Awaiting collapse" : phase[0].toUpperCase() + phase.slice(1),
          trade: vaultTradeFor(id, logs),
        } satisfies VaultHistoryItem;
      }));

    historyCache.current = { key: historyKey, history };
    setSnapshot({
      roundCount,
      round,
      portfolio,
      usdcBalance,
      protocolSeed,
      vault: {
        navUsdc,
        usdcBalance: vaultUsdc,
        tEthBalance: vaultTEth,
        oraclePriceUsdc: oraclePrice,
        spotPriceUsdc: spotPrice,
        tEthAllocationBps,
        shareSupply,
        shareBalance,
        queuedDeposit,
        queuedWithdrawal,
        totalQueuedDeposit,
        totalQueuedWithdrawal,
      },
      history,
    });
  }, [address]);

  const hasSnapshot = useRef(false);
  useEffect(() => { hasSnapshot.current = snapshot !== null; }, [snapshot]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let timer: number | undefined;
    let running = false;
    let failures = 0;

    const schedule = () => {
      if (!active) return;
      const delay = failures === 0 ? POLL_MS : Math.min(60_000, 5_000 * 2 ** (failures - 1));
      timer = window.setTimeout(tick, delay);
    };
    const tick = () => {
      window.clearTimeout(timer);
      if (!active) return;
      if (document.hidden) return; // resumed by the visibilitychange handler
      if (running) { schedule(); return; }
      running = true;
      setLoading(true);
      refresh()
        .then(() => {
          failures = 0;
          if (active) { setError(""); setStale(false); setRpcStale(false); }
        })
        .catch((readError: unknown) => {
          failures += 1;
          if (!active) return;
          setStale(true);
          setRpcStale(true);
          // Keep the last good data on screen; only the very first load surfaces a (friendly) message.
          if (!hasSnapshot.current) setError(friendlyError(readError));
        })
        .finally(() => {
          running = false;
          if (active) setLoading(false);
          schedule();
        });
    };
    const onVisibility = () => { if (!document.hidden) tick(); };
    document.addEventListener("visibilitychange", onVisibility);
    tick();
    return () => {
      active = false;
      setRpcStale(false);
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, refresh, refreshIndex]);

  const ensureWallet = useCallback(() => {
    if (!address || !walletClient) throw new Error("Connect a wallet before sending transactions.");
    if (chainId !== 5_042_002) throw new Error("Switch your wallet to Arc Testnet before transacting.");
    return { address, walletClient };
  }, [address, chainId, walletClient]);

  const submit = useCallback(async (send: () => Promise<Hash>) => {
    ensureWallet();
    const hash = await send();
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`Transaction reverted: ${hash}`);
    vaultLogCache = null;
    forceRef.current = true;
    setRefreshIndex((index) => index + 1);
    return hash;
  }, [ensureWallet]);

  const approveIfNeeded = useCallback(async (spender: Address, amount: bigint) => {
    const { address: account, walletClient: client } = ensureWallet();
    const allowance = await publicClient.readContract({
      address: addresses.usdc, abi: erc20Abi, functionName: "allowance", args: [account, spender],
    });
    if (allowance < amount) {
      await submit(() => client.writeContract({
        account, chain: arcTestnet, address: addresses.usdc, abi: erc20Abi, functionName: "approve", args: [spender, amount],
      }));
    }
  }, [ensureWallet, submit]);

  const deposit = useCallback(async (roundId: bigint, amount: string) => {
    const { address: account, walletClient: client } = ensureWallet();
    const units = parseCredits(amount);
    await approveIfNeeded(addresses.quantumRound, units);
    return submit(() => client.writeContract({
      account, chain: arcTestnet, address: addresses.quantumRound, abi: quantumRoundAbi, functionName: "deposit", args: [roundId, units],
    }));
  }, [approveIfNeeded, ensureWallet, submit]);

  const claimCredits = useCallback(async (roundId: bigint, proposalId: number, amount: string) => {
    const { address: account, walletClient: client } = ensureWallet();
    return submit(() => client.writeContract({
      account, chain: arcTestnet, address: addresses.quantumRound, abi: quantumRoundAbi, functionName: "claimCredits",
      args: [roundId, BigInt(proposalId), parseCredits(amount)],
    }));
  }, [ensureWallet, submit]);

  /** Quotes through the adapter's exact single-range math. Used for both the ticket preview and the minimum output. */
  const quoteTrade = useCallback(async (
    roundId: bigint,
    proposal: LiveProposal,
    side: TradeSide,
    action: TradeAction,
    amount: string,
  ): Promise<TradeQuote> => {
    const amountIn = action === "buy" ? parseCredits(amount) : parseToken(amount);
    const bigId = BigInt(proposal.id);
    const args = [roundId, bigId, amountIn] as const;
    const reference = side === "LONG" ? proposal.pLong : proposal.pShort;
    let expectedOut: bigint;
    let dust: TradeQuote["dust"] = null;
    try {
      if (action === "buy") {
        expectedOut = await publicClient.readContract({
          address: addresses.market, abi: proposalMarketAbi, functionName: side === "LONG" ? "quoteBuyLong" : "quoteBuyShort", args,
        });
      } else {
        const [credits, longDust, shortDust] = await publicClient.readContract({
          address: addresses.market, abi: proposalMarketAbi, functionName: side === "LONG" ? "quoteSellLong" : "quoteSellShort", args,
        });
        expectedOut = credits;
        dust = { long: longDust, short: shortDust };
      }
    } catch {
      throw new Error(BOUNDARY_MESSAGE);
    }

    const ownDust = dust ? (side === "LONG" ? dust.long : dust.short) : 0n;
    const tokens = action === "buy" ? Number(formatUnits(expectedOut, 18)) : Number(formatUnits(amountIn - ownDust, 18));
    const credits = action === "buy" ? Number(formatUnits(amountIn, 6)) : Number(formatUnits(expectedOut, 6));
    const averagePrice = tokens > 0 ? credits / tokens : null;
    const priceImpactPct = averagePrice !== null && reference
      ? (action === "buy" ? averagePrice / reference - 1 : 1 - averagePrice / reference) * 100
      : null;

    // pLong after the trade, previewed with the pool's own liquidity; the swap leg is the opposite token for buys.
    let pAfter: number | null = null;
    try {
      const pool = await readPoolState(proposal.poolKey);
      const inputToken = action === "buy" ? (side === "LONG" ? proposal.shortToken : proposal.longToken) : (side === "LONG" ? proposal.longToken : proposal.shortToken);
      const swapIn = action === "buy" ? amountIn * 10n ** 12n : amountIn - expectedOut * 10n ** 12n - ownDust;
      pAfter = probabilityAfterSwap({
        sqrtPriceX96: pool.sqrtPriceX96,
        liquidity: pool.liquidity,
        fee: proposal.poolKey.fee,
        zeroForOne: proposal.poolKey.currency0 === inputToken,
        amountIn: swapIn > 0n ? swapIn : 0n,
        longIsCurrency0: proposal.poolKey.currency0 === proposal.longToken,
      });
    } catch {
      pAfter = null;
    }
    return {
      action,
      side,
      amountIn,
      expectedOut,
      minOut: (expectedOut * (10_000n - SLIPPAGE_BPS)) / 10_000n,
      averagePrice,
      priceImpactPct,
      pAfter,
      hitsBoundary: outsideBounds(pAfter),
      dust,
    };
  }, []);

  const trade = useCallback(async (
    roundId: bigint,
    proposal: LiveProposal,
    side: TradeSide,
    amount: string,
    action: TradeAction,
  ) => {
    const { address: account, walletClient: client } = ensureWallet();
    const quote = await quoteTrade(roundId, proposal, side, action, amount);
    if (quote.hitsBoundary) throw new Error(BOUNDARY_MESSAGE);
    if (action === "buy" && quote.amountIn > proposal.creditBalance) {
      throw new Error("Buy amount exceeds your available proposal credits. Claim more credits first.");
    }
    const held = side === "LONG" ? proposal.longBalance : proposal.shortBalance;
    if (action === "sell" && quote.amountIn > held) throw new Error(`Sell amount exceeds your ${side} balance.`);
    // Sells burn tokens directly through the round, so no ERC-20 approval is needed.
    const functionName = action === "buy"
      ? (side === "LONG" ? "buyLong" : "buyShort")
      : (side === "LONG" ? "sellLong" : "sellShort");
    return submit(() => client.writeContract({
      account, chain: arcTestnet, address: addresses.quantumRound, abi: quantumRoundAbi, functionName,
      args: [roundId, BigInt(proposal.id), quote.amountIn, quote.minOut],
    }));
  }, [ensureWallet, quoteTrade, submit]);

  const collapse = useCallback(async (roundId: bigint) => {
    const { address: account, walletClient: client } = ensureWallet();
    return submit(() => client.writeContract({
      account, chain: arcTestnet, address: addresses.quantumRound, abi: quantumRoundAbi, functionName: "collapse", args: [roundId],
    }));
  }, [ensureWallet, submit]);

  const redeem = useCallback(async (roundId: bigint) => {
    const { address: account, walletClient: client } = ensureWallet();
    return submit(() => client.writeContract({
      account, chain: arcTestnet, address: addresses.quantumRound, abi: quantumRoundAbi, functionName: "redeem", args: [roundId],
    }));
  }, [ensureWallet, submit]);

  const depositToVault = useCallback(async (amount: string) => {
    const { address: account, walletClient: client } = ensureWallet();
    const units = parseCredits(amount);
    await approveIfNeeded(addresses.vault, units);
    return submit(() => client.writeContract({
      account, chain: arcTestnet, address: addresses.vault, abi: vaultAbi, functionName: "requestDeposit", args: [units],
    }));
  }, [approveIfNeeded, ensureWallet, submit]);

  const withdrawFromVault = useCallback(async (shares: string) => {
    const { address: account, walletClient: client } = ensureWallet();
    return submit(() => client.writeContract({
      account, chain: arcTestnet, address: addresses.vault, abi: vaultAbi, functionName: "requestWithdraw", args: [parseToken(shares)],
    }));
  }, [ensureWallet, submit]);

  const cancelVaultDeposit = useCallback(async () => {
    const { address: account, walletClient: client } = ensureWallet();
    return submit(() => client.writeContract({
      account, chain: arcTestnet, address: addresses.vault, abi: vaultAbi, functionName: "cancelDepositRequest",
    }));
  }, [ensureWallet, submit]);

  const cancelVaultWithdrawal = useCallback(async () => {
    const { address: account, walletClient: client } = ensureWallet();
    return submit(() => client.writeContract({
      account, chain: arcTestnet, address: addresses.vault, abi: vaultAbi, functionName: "cancelWithdrawRequest",
    }));
  }, [ensureWallet, submit]);

  return {
    snapshot,
    loading,
    error,
    stale,
    refresh: () => { forceRef.current = true; setRefreshIndex((index) => index + 1); },
    deposit,
    claimCredits,
    quoteTrade,
    trade,
    collapse,
    redeem,
    depositToVault,
    withdrawFromVault,
    cancelVaultDeposit,
    cancelVaultWithdrawal,
  };
}

export function toUsdc(value: bigint) {
  return Number(formatUnits(value, 6));
}

export function toTokenAmount(value: bigint) {
  return Number(formatUnits(value, 18));
}

export function toShareAmount(value: bigint) {
  return Number(formatUnits(value, 18));
}

export { fmtToken };
