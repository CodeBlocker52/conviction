"use client";

import { useCallback, useEffect, useState } from "react";
import {
  formatUnits,
  parseUnits,
  type Address,
  type Hash,
} from "viem";
import {
  addresses,
  arcTestnet,
  erc20Abi,
  proposalMarketAbi,
  proposalTokensAbi,
  publicClient,
  quantumRoundAbi,
  vaultAbi,
} from "../lib/contracts";
import { useWallet } from "./useWallet";

export type LiveProposal = {
  id: number;
  proposer: Address;
  rationale: string;
  tEthBps: number;
  longPrice: number;
  creditReserve: bigint;
  longReserve: bigint;
  claimedCredits: bigint;
  creditBalance: bigint;
  longBalance: bigint;
  shortBalance: bigint;
};

export type LiveRound = {
  id: bigint;
  tradingEnd: bigint;
  evaluationEnd: bigint;
  proposalCount: number;
  winnerProposalId: number | null;
  collapsed: boolean;
  settled: boolean;
  cancelled: boolean;
  totalDeposited: bigint;
  realisedReturn: bigint;
  phase: "trading" | "evaluation" | "settled";
  deposit: bigint;
  remainingCredits: bigint;
  proposals: LiveProposal[];
};

export type VaultHistoryItem = {
  roundId: bigint;
  timestamp: bigint;
  navUsdc: bigint;
  realisedReturn: bigint | null;
  allocationBps: number | null;
  status: string;
};

export type LiveSnapshot = {
  roundCount: bigint;
  round: LiveRound | null;
  usdcBalance: bigint | null;
  vault: {
    navUsdc: bigint;
    usdcBalance: bigint;
    tEthBalance: bigint;
    oraclePriceUsdc: bigint;
    spotPriceUsdc: bigint;
    tEthAllocationBps: number;
  };
  history: VaultHistoryItem[];
};

const asMessage = (error: unknown) => error instanceof Error ? error.message : "On-chain request failed.";

function decimalUnits(value: string) {
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(value)) throw new Error("Enter a valid positive amount.");
  const amount = parseUnits(value, 6);
  if (amount <= 0n) throw new Error("Amount must be greater than zero.");
  return amount;
}

export function useQuantumRound(enabled: boolean) {
  const { address, chainId, walletClient } = useWallet();
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshIndex, setRefreshIndex] = useState(0);

  const refresh = useCallback(async () => {
    const [roundCount, usdcBalance, vaultUsdc, vaultTEth, oraclePrice, spotPrice] = await Promise.all([
      publicClient.readContract({ address: addresses.quantumRound, abi: quantumRoundAbi, functionName: "roundCount" }),
      address
        ? publicClient.readContract({ address: addresses.usdc, abi: erc20Abi, functionName: "balanceOf", args: [address] })
        : Promise.resolve(null),
      publicClient.readContract({ address: addresses.vault, abi: vaultAbi, functionName: "totalVaultUsdc" }),
      publicClient.readContract({ address: addresses.vault, abi: vaultAbi, functionName: "totalVaultTEth" }),
      publicClient.readContract({ address: addresses.vault, abi: vaultAbi, functionName: "oraclePriceTEthInUsdc" }),
      publicClient.readContract({ address: addresses.vault, abi: vaultAbi, functionName: "spotPriceTEthInUsdc" }),
    ]);
    const navUsdc = vaultUsdc + (vaultTEth * oraclePrice) / 10n ** 18n;
    const tEthValue = (vaultTEth * oraclePrice) / 10n ** 18n;
    const tEthAllocationBps = navUsdc === 0n ? 0 : Number((tEthValue * 10_000n) / navUsdc);
    const marketAddress = await publicClient.readContract({
      address: addresses.quantumRound,
      abi: quantumRoundAbi,
      functionName: "market",
    });
    const proposalTokensAddress = await publicClient.readContract({
      address: addresses.quantumRound,
      abi: quantumRoundAbi,
      functionName: "proposalTokens",
    });

    let round: LiveRound | null = null;
    if (roundCount > 0n) {
      const baseValues = await publicClient.readContract({
        address: addresses.quantumRound,
        abi: quantumRoundAbi,
        functionName: "rounds",
        args: [roundCount],
      });
      const base = {
        id: baseValues[0],
        tradingEnd: baseValues[1],
        evaluationEnd: baseValues[2],
        proposalCount: baseValues[7],
        winnerProposalId: baseValues[8],
        collapsed: baseValues[9],
        settled: baseValues[10],
        realisedReturn: baseValues[11],
        totalDeposited: baseValues[12],
        cancelled: baseValues[13],
      };
      const [deposit, totalCreditsClaimed, proposals] = await Promise.all([
        address
          ? publicClient.readContract({
            address: addresses.quantumRound,
            abi: quantumRoundAbi,
            functionName: "deposits",
            args: [roundCount, address],
          })
          : Promise.resolve(0n),
        address
          ? publicClient.readContract({
            address: addresses.quantumRound,
            abi: quantumRoundAbi,
            functionName: "totalCreditsClaimed",
            args: [roundCount, address],
          })
          : Promise.resolve(0n),
        Promise.all(Array.from({ length: Number(base.proposalCount) }, async (_, id) => {
          const [proposal, market, longPrice, creditToken, longToken, shortToken, claimedCredits] = await Promise.all([
            publicClient.readContract({
              address: addresses.quantumRound,
              abi: quantumRoundAbi,
              functionName: "proposals",
              args: [roundCount, BigInt(id)],
            }),
            publicClient.readContract({
              address: marketAddress,
              abi: proposalMarketAbi,
              functionName: "markets",
              args: [roundCount, BigInt(id)],
            }),
            publicClient.readContract({
              address: marketAddress,
              abi: proposalMarketAbi,
              functionName: "spotPrice",
              args: [roundCount, BigInt(id)],
            }),
            publicClient.readContract({
              address: proposalTokensAddress,
              abi: proposalTokensAbi,
              functionName: "creditToken",
              args: [roundCount, BigInt(id)],
            }),
            publicClient.readContract({
              address: proposalTokensAddress,
              abi: proposalTokensAbi,
              functionName: "longToken",
              args: [roundCount, BigInt(id)],
            }),
            publicClient.readContract({
              address: proposalTokensAddress,
              abi: proposalTokensAbi,
              functionName: "shortToken",
              args: [roundCount, BigInt(id)],
            }),
            address
              ? publicClient.readContract({
                address: addresses.quantumRound,
                abi: quantumRoundAbi,
                functionName: "creditsClaimed",
                args: [roundCount, BigInt(id), address],
              })
              : Promise.resolve(0n),
          ]);
          const [creditBalance, longBalance, shortBalance] = address
            ? await Promise.all([
              publicClient.readContract({ address: creditToken, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
              publicClient.readContract({ address: longToken, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
              publicClient.readContract({ address: shortToken, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
            ])
            : [0n, 0n, 0n];
          return {
            id,
            proposer: proposal[1],
            rationale: proposal[3],
            tEthBps: Number(proposal[2]),
            longPrice: Number(longPrice) / 1e18,
            creditReserve: market[0],
            longReserve: market[1],
            claimedCredits,
            creditBalance,
            longBalance,
            shortBalance,
          } satisfies LiveProposal;
        })),
      ]);
      const now = BigInt(Math.floor(Date.now() / 1000));
      const phase = base.settled || base.cancelled
        ? "settled"
        : base.collapsed || now >= base.tradingEnd
          ? "evaluation"
          : "trading";
      round = {
        id: base.id,
        tradingEnd: base.tradingEnd,
        evaluationEnd: base.evaluationEnd,
        proposalCount: Number(base.proposalCount),
        winnerProposalId: base.collapsed ? Number(base.winnerProposalId) : null,
        collapsed: base.collapsed,
        settled: base.settled,
        cancelled: base.cancelled,
        totalDeposited: base.totalDeposited,
        realisedReturn: base.realisedReturn,
        phase,
        deposit,
        remainingCredits: deposit > totalCreditsClaimed ? deposit - totalCreditsClaimed : 0n,
        proposals,
      };
    }

    const firstHistoryRound = roundCount > 20n ? roundCount - 19n : 1n;
    const history = roundCount === 0n
      ? []
      : await Promise.all(Array.from(
        { length: Number(roundCount - firstHistoryRound + 1n) },
        async (_, index) => {
          const id = firstHistoryRound + BigInt(index);
          const [pastRoundValues, state] = await Promise.all([
            publicClient.readContract({
              address: addresses.quantumRound,
              abi: quantumRoundAbi,
              functionName: "rounds",
              args: [id],
            }),
            publicClient.readContract({
              address: addresses.vault,
              abi: vaultAbi,
              functionName: "roundState",
              args: [id],
            }),
          ]);
          const pastRound = {
            collapsed: pastRoundValues[9],
            settled: pastRoundValues[10],
            realisedReturn: pastRoundValues[11],
            cancelled: pastRoundValues[13],
            winnerProposalId: pastRoundValues[8],
          };
          let allocationBps: number | null = null;
          if (pastRound.collapsed) {
            const winner = await publicClient.readContract({
              address: addresses.quantumRound,
              abi: quantumRoundAbi,
              functionName: "proposals",
              args: [id, pastRound.winnerProposalId],
            });
            allocationBps = Number(winner[2]);
          }
          return {
            roundId: id,
            timestamp: state[4],
            navUsdc: state[0],
            realisedReturn: pastRound.settled ? pastRound.realisedReturn : null,
            allocationBps,
            status: pastRound.cancelled ? "Cancelled" : pastRound.settled ? "Settled" : pastRound.collapsed ? "Evaluating" : "Trading",
          } satisfies VaultHistoryItem;
        },
      )).then((items) => items.filter((item) => item.timestamp > 0n));

    setSnapshot({
      roundCount,
      round,
      usdcBalance,
      vault: {
        navUsdc,
        usdcBalance: vaultUsdc,
        tEthBalance: vaultTEth,
        oraclePriceUsdc: oraclePrice,
        spotPriceUsdc: spotPrice,
        tEthAllocationBps,
      },
      history,
    });
  }, [address]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const refreshIfActive = () => {
      setLoading(true);
      refresh()
        .then(() => {
          if (active) setError("");
        })
        .catch((readError: unknown) => {
          if (active) setError(asMessage(readError));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    };
    refreshIfActive();
    const timer = window.setInterval(refreshIfActive, 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
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
    setRefreshIndex((index) => index + 1);
    return hash;
  }, [ensureWallet]);

  const deposit = useCallback(async (roundId: bigint, amount: string) => {
    const { address: account, walletClient: client } = ensureWallet();
    const amountUnits = decimalUnits(amount);
    const allowance = await publicClient.readContract({
      address: addresses.usdc,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account, addresses.quantumRound],
    });
    if (allowance < amountUnits) {
      await submit(() => client.writeContract({
        account,
        chain: arcTestnet,
        address: addresses.usdc,
        abi: erc20Abi,
        functionName: "approve",
        args: [addresses.quantumRound, amountUnits],
      }));
    }
    return submit(() => client.writeContract({
      account,
      chain: arcTestnet,
      address: addresses.quantumRound,
      abi: quantumRoundAbi,
      functionName: "deposit",
      args: [roundId, amountUnits],
    }));
  }, [ensureWallet, submit]);

  const claimCredits = useCallback(async (roundId: bigint, proposalId: number, amount: string) => {
    const { address: account, walletClient: client } = ensureWallet();
    return submit(() => client.writeContract({
      account,
      chain: arcTestnet,
      address: addresses.quantumRound,
      abi: quantumRoundAbi,
      functionName: "claimCredits",
      args: [roundId, BigInt(proposalId), decimalUnits(amount)],
    }));
  }, [ensureWallet, submit]);

  const trade = useCallback(async (
    roundId: bigint,
    proposal: LiveProposal,
    side: "LONG" | "SHORT",
    amount: string,
    action: "buy" | "sell",
  ) => {
    const { address: account, walletClient: client } = ensureWallet();
    const amountUnits = decimalUnits(amount);
    const marketState = await publicClient.readContract({
      address: addresses.market,
      abi: proposalMarketAbi,
      functionName: "markets",
      args: [roundId, BigInt(proposal.id)],
    });
    const feeBps = await publicClient.readContract({
      address: addresses.market,
      abi: proposalMarketAbi,
      functionName: "feeBps",
    });
    const feeFactor = 10_000n - BigInt(feeBps);
    if (action === "buy" && side === "LONG") {
      const estimate = (marketState[1] * amountUnits * feeFactor)
        / (marketState[0] * 10_000n + amountUnits * feeFactor);
      const minimum = (estimate * 9_950n) / 10_000n;
      return submit(() => client.writeContract({
        account,
        chain: arcTestnet,
        address: addresses.quantumRound,
        abi: quantumRoundAbi,
        functionName: "buyLong",
        args: [roundId, BigInt(proposal.id), amountUnits, minimum],
      }));
    }
    if (action === "buy" && side === "SHORT") {
      return submit(() => client.writeContract({
        account,
        chain: arcTestnet,
        address: addresses.quantumRound,
        abi: quantumRoundAbi,
        functionName: "buyShort",
        args: [roundId, BigInt(proposal.id), amountUnits, amountUnits],
      }));
    }
    if (action === "sell" && side === "LONG") {
      const estimate = (marketState[0] * amountUnits * feeFactor)
        / (marketState[1] * 10_000n + amountUnits * feeFactor);
      const minimum = (estimate * 9_950n) / 10_000n;
      return submit(() => client.writeContract({
        account,
        chain: arcTestnet,
        address: addresses.quantumRound,
        abi: quantumRoundAbi,
        functionName: "sellLong",
        args: [roundId, BigInt(proposal.id), amountUnits, minimum],
      }));
    }
    return submit(() => client.writeContract({
      account,
      chain: arcTestnet,
      address: addresses.quantumRound,
      abi: quantumRoundAbi,
      functionName: "sellShort",
      args: [roundId, BigInt(proposal.id), amountUnits, amountUnits],
    }));
  }, [ensureWallet, submit]);

  const collapse = useCallback(async (roundId: bigint) => {
    const { address: account, walletClient: client } = ensureWallet();
    return submit(() => client.writeContract({
      account,
      chain: arcTestnet,
      address: addresses.quantumRound,
      abi: quantumRoundAbi,
      functionName: "collapse",
      args: [roundId],
    }));
  }, [ensureWallet, submit]);

  const redeem = useCallback(async (roundId: bigint) => {
    const { address: account, walletClient: client } = ensureWallet();
    return submit(() => client.writeContract({
      account,
      chain: arcTestnet,
      address: addresses.quantumRound,
      abi: quantumRoundAbi,
      functionName: "redeem",
      args: [roundId],
    }));
  }, [ensureWallet, submit]);

  return {
    snapshot,
    loading,
    error,
    refresh: () => setRefreshIndex((index) => index + 1),
    deposit,
    claimCredits,
    trade,
    collapse,
    redeem,
  };
}

export function toUsdc(value: bigint) {
  return Number(formatUnits(value, 6));
}

export function toTokenAmount(value: bigint) {
  return Number(formatUnits(value, 6));
}
